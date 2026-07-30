import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { InterfaceStore } from './storage/interfaceStore';
import { CaptureProxy } from './proxy/captureProxy';
import { ExtensionReceiver } from './extension/extensionReceiver';
import { Settings } from './settings';
import { ScheduleManager } from './scheduler/scheduleManager';
import { shouldCapture, hostnameOf } from './captureFilter';
import { registerIpc } from './ipc/handlers';

const PROXY_PORT = 8899;
const EXTENSION_PORT = 8891;

let mainWindow: BrowserWindow | null = null;
let store: InterfaceStore;
let proxy: CaptureProxy;
let extension: ExtensionReceiver;
let settings: Settings;
let scheduleManager: ScheduleManager | null = null;

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

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  store = new InterfaceStore(path.join(userData, 'interfaces.json'));
  settings = new Settings(path.join(userData, 'settings.json'));

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
    path.join(userData, 'mitm-ca'),
    (input) => onCapture(input)
  );
  extension = new ExtensionReceiver(
    EXTENSION_PORT,
    (input) => onCapture(input),
    (method, url, response) => onResponse(method, url, response)
  );
  scheduleManager = new ScheduleManager(
    path.join(userData, 'schedules.json')
  );
  registerIpc(store, proxy, extension, settings, () => mainWindow, scheduleManager);
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
  proxy?.stop();
  extension?.stop();
});
