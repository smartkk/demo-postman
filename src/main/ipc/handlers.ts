import { ipcMain, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import type { InterfaceStore } from '../storage/interfaceStore';
import type { CaptureProxy } from '../proxy/captureProxy';
import type { ExtensionReceiver } from '../extension/extensionReceiver';
import type { Settings } from '../settings';
import type { ScheduleManager } from '../scheduler/scheduleManager';
import type {
  CaptureInput,
  CaptureSettings,
  ExtensionStatus,
  InterfaceRecord,
  ProxyStatus,
  RecordSource,
  ResponseRecord,
  ScheduleConfig,
} from '../../shared/types';
import { sendRequest } from '../request/sender';

/** 在途请求的中断控制器（按接口 id 索引），用于「取消发送」。 */
const inFlight = new Map<string, AbortController>();

/** 用环境变量替换 {{var}} 占位符（URL / Header 值 / Body）。 */
function resolveEnv(
  input: CaptureInput,
  env?: Record<string, string>
): CaptureInput {
  if (!env) return input;
  const sub = (s: string) =>
    s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k: string) =>
      k in env ? env[k] : `{{${k}}}`
    );
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers || {})) headers[k] = sub(v);
  return {
    ...input,
    url: sub(input.url),
    headers,
    body: input.body ? sub(input.body) : input.body,
  };
}

export function registerIpc(
  store: InterfaceStore,
  proxy: CaptureProxy,
  extension: ExtensionReceiver,
  settings: Settings,
  getWin: () => BrowserWindow | null,
  scheduleManager?: ScheduleManager
): void {
  const status = (): ProxyStatus => ({
    running: proxy.running,
    port: proxy.portNumber,
    caPath: proxy.caPath,
  });
  const extensionStatus = (): ExtensionStatus => ({
    running: extension.running,
    port: extension.portNumber,
  });

  ipcMain.handle('store:list', (): InterfaceRecord[] => store.list());
  ipcMain.handle('store:detail', (_e, id: string): InterfaceRecord | null =>
    store.get(id)
  );
  ipcMain.handle('store:add', (_e, input: CaptureInput): InterfaceRecord | null =>
    store.addManual(input)
  );
  ipcMain.handle(
    'store:update',
    (_e, id: string, input: CaptureInput): InterfaceRecord | null =>
      store.update(id, input)
  );
  ipcMain.handle('store:duplicate', (_e, id: string): InterfaceRecord | null =>
    store.duplicate(id)
  );
  ipcMain.handle('store:delete', (_e, id: string): boolean =>
    store.deleteOne(id)
  );
  ipcMain.handle(
    'store:deleteBySource',
    (_e, source: RecordSource): number => store.deleteBySource(source)
  );
  ipcMain.handle('store:rename', (_e, id: string, name: string): void =>
    store.rename(id, name)
  );
  ipcMain.handle('store:moveFolder', (_e, id: string, folder: string): void =>
    store.moveFolder(id, folder)
  );
  ipcMain.handle('store:folders', (): string[] => store.listFolders());
  ipcMain.handle('store:createFolder', (_e, name: string): void =>
    store.createFolder(name)
  );
  ipcMain.handle('store:deleteFolder', (_e, name: string): void =>
    store.deleteFolder(name)
  );

  ipcMain.handle(
    'request:send',
    async (_e, id: string, input: CaptureInput): Promise<ResponseRecord | null> => {
      const controller = new AbortController();
      inFlight.set(id, controller);
      try {
        const env = settings
          .get()
          .environments?.[settings.get().activeEnv || ''];
        const resolved = resolveEnv(input, env);
        const resp = await sendRequest(resolved, 0, controller.signal);
        store.saveResponse(id, resp);
        return resp;
      } catch (err) {
        const fail: ResponseRecord = {
          status: 0,
          statusText: err instanceof Error ? err.message : String(err),
          headers: {},
          body: '',
          durationMs: 0,
          at: new Date().toISOString(),
        };
        store.saveResponse(id, fail);
        return fail;
      } finally {
        inFlight.delete(id);
      }
    }
  );

  ipcMain.handle('request:cancel', (_e, id: string): void => {
    inFlight.get(id)?.abort();
  });
  ipcMain.handle('store:clear', (): boolean => {
    store.clearAll();
    return true;
  });

  ipcMain.handle('collection:export', (): unknown => store.exportCollection());
  ipcMain.handle(
    'collection:import',
    (_e, data: unknown): boolean => {
      store.importCollection(data as any);
      return true;
    }
  );
  ipcMain.handle('store:togglePin', (_e, id: string): void => {
    store.togglePin(id);
  });

  ipcMain.handle('proxy:status', (): ProxyStatus => status());
  ipcMain.handle('proxy:toggle', (): ProxyStatus => {
    if (proxy.running) proxy.stop();
    else proxy.start();
    getWin()?.webContents.send('proxy:status', status());
    return status();
  });
  ipcMain.handle('proxy:caPath', (): string | null => proxy.caPath);
  ipcMain.handle('proxy:openCaDir', (): void => {
    if (proxy.caPath) shell.openPath(path.dirname(proxy.caPath));
  });
  ipcMain.handle('app:openExternal', (_e, url: string): void => {
    shell.openExternal(url);
  });

  ipcMain.handle('extension:status', (): ExtensionStatus => extensionStatus());
  ipcMain.handle('extension:toggle', (): ExtensionStatus => {
    if (extension.running) extension.stop();
    else extension.start();
    getWin()?.webContents.send('extension:status', extensionStatus());
    return extensionStatus();
  });

  // ── 定时调度 ──
  if (scheduleManager) {
    ipcMain.handle('schedule:list', (): ScheduleConfig[] =>
      scheduleManager.list()
    );
    ipcMain.handle(
      'schedule:save',
      (_e, config: ScheduleConfig): ScheduleConfig[] => {
        scheduleManager.update(config);
        return scheduleManager.list();
      }
    );
    ipcMain.handle('schedule:delete', (_e, id: string): boolean =>
      scheduleManager.remove(id)
    );
    ipcMain.handle(
      'schedule:toggle',
      (_e, id: string): ScheduleConfig | undefined =>
        scheduleManager.toggle(id)
    );
    ipcMain.handle(
      'schedule:history',
      (_e, id: string): ScheduleConfig['history'] =>
        scheduleManager.getHistory(id)
    );
    scheduleManager.onPush((list) => {
      getWin()?.webContents.send('schedule:updated', list);
    });
  }

  // 存储变更时主动推送最新列表与分组到渲染进程
  store.onChange(() => {
    getWin()?.webContents.send('store:updated', store.list(), store.listFolders());
  });

  // 抓取设置（白名单 / 自动分组）
  ipcMain.handle('settings:get', (): CaptureSettings => settings.get());
  ipcMain.handle(
    'settings:set',
    (_e, patch: Partial<CaptureSettings>): CaptureSettings => settings.update(patch)
  );
  settings.onChange(() => {
    getWin()?.webContents.send('settings:updated', settings.get());
  });
}
