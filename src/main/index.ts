import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { InterfaceStore } from './storage/interfaceStore';
import { BatchStore } from './storage/batchStore';
import { ChainStore } from './storage/chainStore';
import { CaptureProxy } from './proxy/captureProxy';
import { ExtensionReceiver } from './extension/extensionReceiver';
import { Settings, bindSettingsInstance } from './settings';
import { ScheduleManager } from './scheduler/scheduleManager';
import { shouldCapture, hostnameOf } from './captureFilter';
import { registerIpc, runChain } from './ipc/handlers';

const PROXY_PORT = 8899;
const EXTENSION_PORT = 8891;

/**
 * 解析数据目录：默认使用 userData；若 userData/location.json 指定了有效目录，则改用该目录。
 * location.json 始终存于 userData（固定不可移动），用于记录用户所选的可移动数据目录。
 */
function resolveDataDir(userData: string): string {
  try {
    const locFile = path.join(userData, 'location.json');
    if (fs.existsSync(locFile)) {
      const raw = JSON.parse(fs.readFileSync(locFile, 'utf8'));
      const d = raw?.dataDir;
      if (
        typeof d === 'string' &&
        d &&
        fs.existsSync(d) &&
        fs.statSync(d).isDirectory()
      ) {
        return d;
      }
    }
  } catch {
    /* 忽略，回退默认 */
  }
  return userData;
}

let mainWindow: BrowserWindow | null = null;
let store: InterfaceStore;
let proxy: CaptureProxy;
let extension: ExtensionReceiver;
let settings: Settings;
let scheduleManager: ScheduleManager | null = null;
let batchStore: BatchStore;
let chainStore: ChainStore;
let userDataDir: string;

// ── 无 GPU 环境降级 ──
// 虚拟机 / 远程桌面 / CI 等无 GPU 环境下，Chromium 的 GPU 进程会反复崩溃，
// 达到阈值后触发 FATAL「GPU process isn't usable」直接终止应用。
// 设置 DISABLE_GPU=1 可关闭硬件加速改用软件渲染（必须在 app ready 前调用）。
if (process.env.DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  // 某些受限环境（容器 / 沙箱）连 GPU 子进程都无法 fork，
  // 此时把 GPU 相关逻辑收进浏览器进程内执行。
  app.commandLine.appendSwitch('in-process-gpu');
  // 同一个受限环境下渲染进程同样会因沙箱初始化失败而被杀（exitCode=1），
  // 表现为窗口黑屏；关闭 Chromium 沙箱后渲染进程可正常启动。
  app.commandLine.appendSwitch('no-sandbox');
}

// ── 单实例锁 ──
// 防止应用被多次启动导致存在多个 ScheduleManager 实例：每个实例都会从
// schedules.json 恢复已启用任务并各自排定计时器，最终表现为定时任务「重复执行两次」。
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0F172A',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 诊断：把渲染进程的控制台（含报错）与加载生命周期写入日志，便于排查白屏/黑屏
  const logRender = (msg: string): void => {
    try {
      fs.appendFileSync(
        path.join(userDataDir, 'render_console.log'),
        `[${new Date().toISOString()}] ${msg}\n\n`,
        'utf8'
      );
    } catch {
      /* ignore */
    }
  };

  mainWindow.webContents.on('console-message', (_e, level, message, sourceId) => {
    logRender(`L${level} ${sourceId}\n${message}`);
  });
  mainWindow.webContents.on('did-start-loading', () => logRender('EVENT did-start-loading'));
  mainWindow.webContents.on('dom-ready', () => logRender('EVENT dom-ready'));
  mainWindow.webContents.on('did-finish-load', () => logRender('EVENT did-finish-load'));
  mainWindow.webContents.on(
    'did-fail-load',
    (_e, code, desc, url, isMainFrame) => {
      logRender(
        `EVENT did-fail-load code=${code} desc=${desc} url=${url} isMainFrame=${isMainFrame}`
      );
    }
  );
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    logRender(`EVENT preload-error path=${preloadPath} err=${error.message}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logRender(`EVENT render-process-gone ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on('unresponsive', () => logRender('EVENT unresponsive'));

  const target = process.env.ELECTRON_RENDERER_URL;
  logRender(
    `LOAD target=${target || '(file) ' + path.join(__dirname, '../renderer/index.html')}`
  );
  if (target) {
    mainWindow.loadURL(target);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  userDataDir = userData;
  const dataDir = resolveDataDir(userData);
  store = new InterfaceStore(path.join(dataDir, 'interfaces.json'));
  settings = new Settings(path.join(dataDir, 'settings.json'));
  bindSettingsInstance(settings);

  // 抓取统一入口：先过白名单过滤，再按域名自动分组（仅新建记录）
  const onCapture = (input: { url: string }) => {
    if (!shouldCapture(input.url, settings.get())) return;
    const folder = settings.get().autoGroup ? hostnameOf(input.url) : '';
    store.upsert(input as any, { folder });
  };
  const onResponse = (method: string, url: string, response: any) => {
    if (!shouldCapture(url, settings.get())) return;
    const folder = settings.get().autoGroup ? hostnameOf(url) : '';
    store.upsertResponse(method, url, response, { folder });
  };

  // 去重策略与抓取设置联动
  store.setDedupMode(!!settings.get().dedupByFullUrl);
  settings.onChange(() => {
    store.setDedupMode(!!settings.get().dedupByFullUrl);
  });

  proxy = new CaptureProxy(
    PROXY_PORT,
    path.join(dataDir, 'mitm-ca'),
    (input) => onCapture(input),
    // 代理此前只捕获请求不捕获响应，导致走系统代理抓的接口看不到响应内容
    (method, url, response) => onResponse(method, url, response)
  );
  extension = new ExtensionReceiver(
    EXTENSION_PORT,
    (input) => onCapture(input),
    (method, url, response) => onResponse(method, url, response)
  );
  scheduleManager = new ScheduleManager(path.join(dataDir, 'schedules.json'), {
    getChain: (id) => (chainStore ? chainStore.get(id) : null),
    runChain: (p) => runChain(p, settings),
  });
  batchStore = new BatchStore(path.join(dataDir, 'batch', 'batches.json'));
  chainStore = new ChainStore(path.join(dataDir, 'batch', 'chains.json'));
  registerIpc(
    store,
    proxy,
    extension,
    settings,
    () => mainWindow,
    scheduleManager,
    batchStore,
    chainStore
  );

  // ── 文件保存位置（可移动数据目录） ──
  ipcMain.handle('app:getDataDir', () => dataDir);
  ipcMain.handle('app:chooseDataDir', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择数据保存目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });
  ipcMain.handle('app:setDataDir', (_e, dir: string) => {
    const target = dir && dir.trim() ? dir.trim() : userData;
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch {
      return false;
    }
    // 迁移现有数据文件（仅当目标不存在时复制，避免覆盖已有数据）
    const files = ['interfaces.json', 'schedules.json', 'settings.json'];
    for (const f of files) {
      const src = path.join(dataDir, f);
      const dst = path.join(target, f);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
    const caSrc = path.join(dataDir, 'mitm-ca');
    const caDst = path.join(target, 'mitm-ca');
    if (fs.existsSync(caSrc) && !fs.existsSync(caDst)) {
      try {
        fs.cpSync(caSrc, caDst, { recursive: true });
      } catch {
        /* 忽略 CA 目录复制失败 */
      }
    }
    // 写入位置标记（始终存于 userData，固定不可移动）
    try {
      fs.writeFileSync(
        path.join(userData, 'location.json'),
        JSON.stringify({ dataDir: dir && dir.trim() ? dir.trim() : '' }, null, 2),
        'utf8'
      );
    } catch {
      return false;
    }
    return true;
  });
  ipcMain.handle('app:relaunch', () => {
    try {
      app.relaunch();
      app.exit(0);
    } catch {
      /* noop */
    }
  });
  createWindow();

  // 启动即作为常驻捕获服务：开启代理与插件接收端点，自动记录经过的接口
  proxy.start();
  extension.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  scheduleManager?.destroy();
  store?.save();
  batchStore?.persist();
  chainStore?.persist();
  proxy?.stop();
  extension?.stop();
});
