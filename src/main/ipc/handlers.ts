import { app, ipcMain, BrowserWindow, shell, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { InterfaceStore } from '../storage/interfaceStore';
import type { BatchStore } from '../storage/batchStore';
import type { ChainStore } from '../storage/chainStore';
import type { CaptureProxy } from '../proxy/captureProxy';
import type { ExtensionReceiver } from '../extension/extensionReceiver';
import type { Settings } from '../settings';
import type { ScheduleManager } from '../scheduler/scheduleManager';
import type {
  AiPreprocessResult,
  BatchCallInput,
  BatchCallResult,
  BatchProgressState,
  BatchProject,
  BatchRow,
  CaptureInput,
  CaptureSettings,
  ChainProject,
  ChainRunResult,
  ChainStep,
  ExtensionStatus,
  FolderFile,
  InterfaceRecord,
  InterfaceSummary,
  ProxyStatus,
  RecordSource,
  ResponseRecord,
  ScheduleConfig,
  ScheduleRunResult,
} from '../../shared/types';
import { AUTO_TIMEOUT_MS, sendRequest } from '../request/sender';
import { resolveDynamic, resolveEnv, runBatchCall } from '../request/batchRunner';
import { preprocessWithAi } from '../ai/aiClient';
import { filesToRows, rowsToFiles } from '../../shared/params';

// 单文件读取上限 1MB、最多 200 个：参数文件远用不到这么大，
// 超限直接跳过并在结果中标注，避免把大日志/二进制整进内存。
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 200;

/** 读取文件夹中的文本文件（按文件名自然排序），供「预览 / 导入 / 执行时实时读取」共用。 */
function readFolderFilesFromDisk(
  folder: string
): { files: FolderFile[]; skipped: string[] } {
  const files: FolderFile[] = [];
  const skipped: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch (err) {
    // ES2020 target 不支持 ErrorOptions（cause），这里显式挂载 cause 保留原始错误
    const wrapped = new Error(
      '无法读取文件夹：' + (err instanceof Error ? err.message : String(err))
    );
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }
  const names = entries
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const name of names) {
    if (files.length >= MAX_FILES) {
      skipped.push(`${name}（超出数量上限 ${MAX_FILES}）`);
      continue;
    }
    const full = path.join(folder, name);
    try {
      const size = fs.statSync(full).size;
      if (size > MAX_FILE_BYTES) {
        skipped.push(`${name}（超过 1MB）`);
        continue;
      }
      files.push({ name, content: fs.readFileSync(full, 'utf8') });
    } catch {
      skipped.push(`${name}（读取失败）`);
    }
  }
  return { files, skipped };
}

/** 执行时把参数文件夹解析为变量与参数行（每次执行实时读取，文件增删即生效）。 */
export function resolveParamFolder(paramFolder: string): {
  variables: string[];
  rows: BatchRow[];
  skipped: string[];
} {
  const { files, skipped } = readFolderFilesFromDisk(paramFolder);
  const rows = filesToRows(files);
  const keys = new Set<string>();
  rows.forEach((o) => Object.keys(o).forEach((k) => keys.add(k)));
  return { variables: [...keys], rows, skipped };
}

/** 在途请求的中断控制器（按接口 id 索引），用于「取消发送」。 */
const inFlight = new Map<string, AbortController>();

/** 在途批量执行的中断控制器（按 runId 索引），用于「暂停」。 */
const batchRuns = new Map<string, AbortController>();

/**
 * 链式请求运行：按步骤顺序逐个发送 HTTP 请求，
 * 每一步可声明从响应中提取的字段（点路径），提取后成为「该步骤名.字段名」变量，
 * 供后续步骤的 URL / Header / Body 中的 {{步骤名.字段名}} 占位符引用。
 * 同时支持全局动态变量（{{$timestamp}} 等）与 {{变量名}} 行变量（此处无行变量，仅动态变量）。
 */
export async function runChain(
  project: ChainProject,
  settings: Settings
): Promise<ChainRunResult[]> {
  const env = settings.get().environments?.[settings.get().activeEnv || ''];
  // 步骤 name -> 提取结果（变量名 -> 值）
  const stepVars: Record<string, Record<string, string>> = {};
  const results: ChainRunResult[] = [];

  // 沿路径取值，支持点路径与数组下标：a.b[0].c.d[2]
  const getPath = (obj: unknown, path: string): string | undefined => {
    const tokens = path.match(/[^.[\]]+|\[\d+\]/g);
    if (!tokens) return undefined;
    let cur: unknown = obj;
    for (const raw of tokens) {
      if (cur == null) return undefined;
      if (raw.startsWith('[')) {
        const idx = parseInt(raw.slice(1, -1), 10);
        if (!Array.isArray(cur) || idx < 0 || idx >= cur.length) return undefined;
        cur = cur[idx];
      } else {
        cur = (cur as Record<string, unknown>)[raw];
      }
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
      s.replace(/\{\{\s*(\$?[\w.-]+)(?:\(([^)]*)\))?\s*\}\}/g, (m, k: string) =>
        // 变量池命中优先；否则把完整匹配交给动态变量解析（支持 {{$timestamp}}、{{$random(1,5)}}）
        k in vars ? vars[k] : resolveDynamic(m)
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
      // 链式调用会自动跑完所有步骤，属于无人值守场景，需要超时兜底
      const resp = await sendRequest(resolved, 0, undefined, AUTO_TIMEOUT_MS);
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
  chainStore?: ChainStore,
  dataDir = ''
): void {
  const status = (): ProxyStatus => ({
    running: proxy.running,
    port: proxy.portNumber,
    caPath: proxy.caPath,
  });
  const extensionStatus = (): ExtensionStatus => ({
    running: extension.running,
    port: extension.portNumber,
    token: extension.authToken,
  });

  // 列表只推摘要（响应体截断），详情页经 store:detail 按需拉取，避免全量记录高频序列化
  ipcMain.handle('store:list', (): InterfaceSummary[] => store.listSummaries());
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
  // 批量移动：一次落盘 + 一次推送，替代渲染层逐个调用 moveFolder
  ipcMain.handle(
    'store:moveMany',
    (_e, ids: string[], folder: string): number => store.moveMany(ids, folder)
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
    async (_e, input: BatchCallInput, runId: string): Promise<BatchCallResult[]> => {
      // 参数文件夹模式：执行时实时读取文件作为参数行
      const effective =
        input.paramFolder && input.paramFolder.trim()
          ? (() => {
              const resolved = resolveParamFolder(input.paramFolder);
              if (!resolved.rows.length) {
                throw new Error(`参数文件夹中没有可读取的文件：${input.paramFolder}`);
              }
              return { ...input, variables: resolved.variables, rows: resolved.rows };
            })()
          : input;
      const controller = new AbortController();
      if (runId) batchRuns.set(runId, controller);
      try {
        return await runBatchCall(
          effective,
          settings.get().environments?.[settings.get().activeEnv || ''],
          {
            signal: controller.signal,
            onResult: (result, done, total) =>
              getWin()?.webContents.send('batch:progress', { runId, result, done, total }),
          }
        );
      } finally {
        if (runId) batchRuns.delete(runId);
      }
    }
  );

  /** 中断一次批量执行：停止调度后续请求，并中断在途请求。 */
  ipcMain.handle('batch:cancel', (_e, runId: string): boolean => {
    const c = batchRuns.get(runId);
    if (!c) return false;
    c.abort();
    return true;
  });

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
      async (
        _e,
        id: string,
        runId: string,
        skipIndexes?: number[]
      ): Promise<BatchCallResult[]> => {
        const p = batchStore!.get(id);
        if (!p) throw new Error('批量任务不存在');
        // 绑定了参数文件夹时，执行时实时读取文件作为参数行
        let variables = p.variables;
        let rows = p.rows;
        if (p.paramFolder && p.paramFolder.trim()) {
          const resolved = resolveParamFolder(p.paramFolder);
          if (!resolved.rows.length) {
            throw new Error(`参数文件夹中没有可读取的文件：${p.paramFolder}`);
          }
          variables = resolved.variables;
          rows = resolved.rows;
        }
        const controller = new AbortController();
        if (runId) batchRuns.set(runId, controller);
        try {
          const results = await runBatchCall(
            {
              method: p.method,
              url: p.url,
              headers: p.headers,
              body: p.body,
              variables,
              rows,
              sequential: p.sequential,
              skipIndexes,
            },
            settings.get().environments?.[settings.get().activeEnv || ''],
            {
              signal: controller.signal,
              onResult: (result, done, total) =>
                getWin()?.webContents.send('batch:progress', { runId, result, done, total }),
            }
          );
          batchStore!.recordRun(id, results, new Date().toISOString());
          return results;
        } finally {
          if (runId) batchRuns.delete(runId);
        }
      }
    );
    /** 保存/清除断点续跑进度（progress 为 null 表示清除）。 */
    ipcMain.handle('batch:progress', (_e, id: string, progress: BatchProgressState | null): void => {
      batchStore!.recordProgress(id, progress);
    });

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
      // 导入会先清空现有数据：形状不合法时直接拒绝，避免脏 JSON 把整个集合清掉
      const isValid =
        Array.isArray(data) ||
        (!!data &&
          typeof data === 'object' &&
          Array.isArray((data as { records?: unknown }).records));
      if (!isValid) return false;
      store.importCollection(
        data as Parameters<InterfaceStore['importCollection']>[0]
      );
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
    ipcMain.handle(
      'schedule:runNow',
      async (_e, id: string): Promise<ScheduleRunResult | null> =>
        scheduleManager.runNow(id)
    );
    scheduleManager.onPush((list) => {
      getWin()?.webContents.send('schedule:updated', list);
    });
  }

  // 存储变更时主动推送最新列表与分组到渲染进程（摘要，响应体已截断）
  store.onChange(() => {
    getWin()?.webContents.send('store:updated', store.listSummaries(), store.listFolders());
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

  // ── AI 预处理：原始数据 -> 结构化请求参数（OpenAI 兼容接口） ──
  ipcMain.handle(
    'ai:preprocess',
    async (
      _e,
      req: { data: string; instruction?: string }
    ): Promise<AiPreprocessResult> => {
      const ai = settings.get().ai;
      if (!ai?.baseUrl?.trim() || !ai?.model?.trim()) {
        throw new Error(
          '尚未配置 AI 接口：请在「设置 → AI 预处理设置」中填写接口地址与模型'
        );
      }
      return preprocessWithAi(req.data, req.instruction ?? '', ai);
    }
  );

  // ── 文件夹参数（批量调用）：预览读取 / 预处理结果落盘 ──
  ipcMain.handle('fs:pickFolder', async (): Promise<string | null> => {
    const win = getWin();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: '选择参数文件夹（每个文件作为一行参数）',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle(
    'fs:readFolderFiles',
    (_e, folder: string): { files: FolderFile[]; skipped: string[] } =>
      readFolderFilesFromDisk(folder)
  );

  // AI 预处理结果落盘：每行参数写成一个 JSON 文件，返回新建的文件夹路径。
  // 目录固定在数据目录 batch-params/ 下，避免散落，也随「文件保存位置」一起迁移。
  ipcMain.handle(
    'fs:writeParamFolder',
    (_e, rows: BatchRow[]): { folder: string; count: number } => {
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('没有可写入的参数行');
      }
      const stamp = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const dirname = `pp-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(
        stamp.getDate()
      )}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(
        stamp.getSeconds()
      )}-${Math.random().toString(36).slice(2, 6)}`;
      const folder = path.join(dataDir || app.getPath('userData'), 'batch-params', dirname);
      fs.mkdirSync(folder, { recursive: true });
      for (const f of rowsToFiles(rows)) {
        fs.writeFileSync(path.join(folder, f.name), f.content, 'utf8');
      }
      return { folder, count: rows.length };
    }
  );
}
