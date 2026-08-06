import { ipcMain, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import crypto from 'node:crypto';
import type { InterfaceStore } from '../storage/interfaceStore';
import type { BatchStore } from '../storage/batchStore';
import type { ChainStore } from '../storage/chainStore';
import type { CaptureProxy } from '../proxy/captureProxy';
import type { ExtensionReceiver } from '../extension/extensionReceiver';
import type { Settings } from '../settings';
import type { ScheduleManager } from '../scheduler/scheduleManager';
import type {
  BatchCallInput,
  BatchCallResult,
  BatchProject,
  CaptureInput,
  CaptureSettings,
  ChainProject,
  ChainRunResult,
  ChainStep,
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

/**
 * 内置动态变量：在模板或参数行单元格值中以 {{$name}} 形式书写，运行时自动解析。
 * 支持：
 *   $timestamp      当前 Unix 秒级时间戳
 *   $timestamp_ms   毫秒级时间戳
 *   $datetime       ISO 本地时间 2026-08-05T14:30:00+08:00
 *   $date           2026-08:05（YYYY-MM-DD）
 *   $time           HH:mm:ss
 *   $uuid           随机 UUID（每次调用生成不同值）
 *   $random(a,b)    a~b 之间的随机整数（含端点）
 * 未匹配的动态变量保持原样返回。
 */
function resolveDynamic(s: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const offMin = -now.getTimezoneOffset();
  const off = `${offMin >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offMin) / 60))}:${pad(Math.abs(offMin) % 60)}`;
  return s.replace(/\{\{\s*\$([\w.-]+)(?:\(([^)]*)\))?\s*\}\}/g, (_m, name: string, args?: string) => {
    switch (name) {
      case 'timestamp':
        return String(Math.floor(now.getTime() / 1000));
      case 'timestamp_ms':
        return String(now.getTime());
      case 'datetime':
        return `${dateStr}T${timeStr}${off}`;
      case 'date':
        return dateStr;
      case 'time':
        return timeStr;
      case 'uuid':
        return crypto.randomUUID();
      case 'random': {
        if (args != null) {
          const parts = args.split(',').map((x) => parseInt(x.trim(), 10));
          if (parts.length === 2 && !parts.some(Number.isNaN)) {
            const [a, b] = parts;
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
          }
        }
        return _m;
      }
      default:
        return _m;
    }
  });
}

/** 用键值对替换 {{var}} 占位符（URL / Header 值 / Body）。未提供的变量尝试解析为动态变量，否则保持原样。 */
function resolvePlaceholders(input: CaptureInput, vars: Record<string, string>): CaptureInput {
  const sub = (s: string) =>
    s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k: string) =>
      k in vars ? vars[k] : resolveDynamic(`{{${k}}}`)
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

/** 用环境变量替换 {{var}} 占位符（URL / Header 值 / Body）。 */
function resolveEnv(
  input: CaptureInput,
  env?: Record<string, string>
): CaptureInput {
  if (!env) return input;
  return resolvePlaceholders(input, env);
}

/** 批量调用：同一基础请求，按每行变量值替换后逐个/并发发送，返回每行的发送时间 + 结果。 */
async function runBatchCall(
  input: BatchCallInput,
  settings: Settings
): Promise<BatchCallResult[]> {
  const env = settings.get().environments?.[settings.get().activeEnv || ''];
  // 先对环境变量做一次性替换（基础模板可引用环境），再对每行做行变量替换
  const base: CaptureInput = {
    method: input.method,
    url: input.url,
    headers: input.headers,
    body: input.body,
    contentType: input.headers['content-type'] || null,
  };
  const baseResolved = env ? resolveEnv(base, env) : base;

  const runOne = async (row: Record<string, string>, index: number): Promise<BatchCallResult> => {
    const sentAt = new Date().toISOString();
    // 先解析参数行单元格值里的动态变量（如 {{$uuid}}、{{$timestamp}}），每行独立生成
    const resolvedRow: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) resolvedRow[k] = resolveDynamic(v);
    const request = resolvePlaceholders(baseResolved, resolvedRow);
    try {
      const resp = await sendRequest(request, 0);
      return {
        index,
        vars: resolvedRow,
        status: resp.status,
        statusText: resp.statusText,
        durationMs: resp.durationMs,
        body: resp.body,
        request,
        sentAt,
        at: resp.at,
      };
    } catch (err) {
      return {
        index,
        vars: resolvedRow,
        status: 0,
        statusText: '',
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
        body: '',
        request,
        sentAt,
        at: new Date().toISOString(),
      };
    }
  };

  const rows = input.rows || [];
  if (input.sequential) {
    const out: BatchCallResult[] = [];
    for (let i = 0; i < rows.length; i++) out.push(await runOne(rows[i], i));
    return out;
  }
  return Promise.all(rows.map((row, i) => runOne(row, i)));
}

/**
 * 链式请求运行：按步骤顺序逐个发送 HTTP 请求，
 * 每一步可声明从响应中提取的字段（点路径），提取后成为「该步骤名.字段名」变量，
 * 供后续步骤的 URL / Header / Body 中的 {{步骤名.字段名}} 占位符引用。
 * 同时支持全局动态变量（{{$timestamp}} 等）与 {{变量名}} 行变量（此处无行变量，仅动态变量）。
 */
async function runChain(
  project: ChainProject,
  settings: Settings
): Promise<ChainRunResult[]> {
  const env = settings.get().environments?.[settings.get().activeEnv || ''];
  // 步骤 name -> 提取结果（变量名 -> 值）
  const stepVars: Record<string, Record<string, string>> = {};
  const results: ChainRunResult[] = [];

  const getPath = (obj: unknown, path: string): string | undefined => {
    const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
    let cur: any = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    if (cur == null) return undefined;
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
  };

  for (let i = 0; i < project.steps.length; i++) {
    const step: ChainStep = project.steps[i];
    const sentAt = new Date().toISOString();
    // 组装当前步骤可用变量池：动态变量 + 各已执行步骤提取的变量
    const vars: Record<string, string> = {};
    for (const [stepName, extracted] of Object.entries(stepVars)) {
      for (const [k, v] of Object.entries(extracted)) vars[`${stepName}.${k}`] = v;
    }
    const sub = (s: string): string =>
      s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, k: string) =>
        k in vars ? vars[k] : resolveDynamic(`{{${k}}}`)
      );
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(step.headers || {})) headers[k] = sub(v);
    const request: CaptureInput = {
      method: step.method,
      url: sub(step.url),
      headers,
      body: step.body ? sub(step.body) : step.body,
    };
    const resolved = env ? resolveEnv(request, env) : request;
    try {
      const resp = await sendRequest(resolved, 0);
      // 提取声明字段
      const extracted: Record<string, string> = {};
      if (step.extract && resp.body) {
        let parsed: unknown = undefined;
        try {
          parsed = JSON.parse(resp.body);
        } catch {
          parsed = undefined;
        }
        if (parsed !== undefined) {
          for (const [outKey, jsonPath] of Object.entries(step.extract)) {
            const val = getPath(parsed, jsonPath);
            if (val !== undefined) extracted[outKey] = val;
          }
        }
      }
      stepVars[step.name || step.id] = extracted;
      results.push({
        stepId: step.id,
        name: step.name,
        index: i,
        status: resp.status,
        statusText: resp.statusText,
        durationMs: resp.durationMs,
        request: resolved,
        extracted,
        body: resp.body,
        sentAt,
        at: resp.at,
      });
    } catch (err) {
      results.push({
        stepId: step.id,
        name: step.name,
        index: i,
        status: 0,
        statusText: '',
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
        request: resolved,
        extracted: {},
        body: '',
        sentAt,
        at: new Date().toISOString(),
      });
      // 链式请求任一步失败即中断后续步骤（参数依赖已断裂）
      break;
    }
  }
  return results;
}

export function registerIpc(
  store: InterfaceStore,
  proxy: CaptureProxy,
  extension: ExtensionReceiver,
  settings: Settings,
  getWin: () => BrowserWindow | null,
  scheduleManager?: ScheduleManager,
  batchStore?: BatchStore,
  chainStore?: ChainStore
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
      const sentAt = new Date().toISOString();
      // 记录本次请求的实际发送时间（无论成功失败均算一次发送尝试）
      store.setLastSent(id, sentAt);
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
  ipcMain.handle(
    'request:batchSend',
    (_e, input: BatchCallInput): Promise<BatchCallResult[]> =>
      runBatchCall(input, settings)
  );

  // ── 批量调用任务（可持久化保存，按文件夹分组） ──
  if (batchStore) {
    ipcMain.handle('batch:list', (): BatchProject[] => batchStore!.list());
    ipcMain.handle(
      'batch:save',
      (_e, project: BatchProject): BatchProject => batchStore!.save(project)
    );
    ipcMain.handle('batch:delete', (_e, id: string): boolean =>
      batchStore!.delete(id)
    );
    ipcMain.handle(
      'batch:rename',
      (_e, id: string, name: string): void => batchStore!.rename(id, name)
    );
    ipcMain.handle(
      'batch:moveFolder',
      (_e, id: string, folder: string): void => batchStore!.moveFolder(id, folder)
    );
    ipcMain.handle(
      'batch:run',
      async (_e, id: string): Promise<BatchCallResult[]> => {
        const p = batchStore!.get(id);
        if (!p) throw new Error('批量任务不存在');
        const results = await runBatchCall(
          {
            method: p.method,
            url: p.url,
            headers: p.headers,
            body: p.body,
            variables: p.variables,
            rows: p.rows,
            sequential: p.sequential,
          },
          settings
        );
        batchStore!.recordRun(id, results, new Date().toISOString());
        return results;
      }
    );
    ipcMain.handle('batch:folders', (): string[] => batchStore!.listFolders());
    ipcMain.handle('batch:createFolder', (_e, name: string): void =>
      batchStore!.createFolder(name)
    );
    ipcMain.handle('batch:deleteFolder', (_e, name: string): void =>
      batchStore!.deleteFolder(name)
    );
    batchStore.onChange(() => {
      getWin()?.webContents.send(
        'batch:updated',
        batchStore!.list(),
        batchStore!.listFolders()
      );
    });
  }

  // ── 链式请求（多步骤串联，响应结果作为参数） ──
  if (chainStore) {
    ipcMain.handle('chain:list', (): ChainProject[] => chainStore!.list());
    ipcMain.handle(
      'chain:save',
      (_e, project: ChainProject): ChainProject => chainStore!.save(project)
    );
    ipcMain.handle('chain:delete', (_e, id: string): boolean =>
      chainStore!.delete(id)
    );
    ipcMain.handle(
      'chain:rename',
      (_e, id: string, name: string): void => chainStore!.rename(id, name)
    );
    ipcMain.handle(
      'chain:moveFolder',
      (_e, id: string, folder: string): void => chainStore!.moveFolder(id, folder)
    );
    ipcMain.handle(
      'chain:run',
      async (_e, id: string): Promise<ChainRunResult[]> => {
        const p = chainStore!.get(id);
        if (!p) throw new Error('链式任务不存在');
        const results = await runChain(p, settings);
        chainStore!.recordRun(id, results, new Date().toISOString());
        return results;
      }
    );
    ipcMain.handle('chain:folders', (): string[] => chainStore!.listFolders());
    ipcMain.handle('chain:createFolder', (_e, name: string): void =>
      chainStore!.createFolder(name)
    );
    ipcMain.handle('chain:deleteFolder', (_e, name: string): void =>
      chainStore!.deleteFolder(name)
    );
    chainStore.onChange(() => {
      getWin()?.webContents.send(
        'chain:updated',
        chainStore!.list(),
        chainStore!.listFolders()
      );
    });
  }
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
