import type {
  AiPreprocessResult,
  BatchCallInput,
  BatchCallResult,
  BatchProgress,
  BatchProgressState,
  BatchProject,
  CaptureInput,
  CaptureSettings,
  ChainProject,
  ChainRunResult,
  ExtensionStatus,
  FolderFile,
  InterfaceRecord,
  ProxyStatus,
  RecordSource,
  ResponseRecord,
  ScheduleConfig,
  ScheduleRunResult,
} from '../../../shared/types';

export const api = {
  getList: (): Promise<InterfaceRecord[]> => window.api.getList(),
  getDetail: (id: string): Promise<InterfaceRecord | null> =>
    window.api.getDetail(id),
  addManual: (input: CaptureInput): Promise<InterfaceRecord | null> =>
    window.api.addManual(input),
  update: (id: string, input: CaptureInput): Promise<InterfaceRecord | null> =>
    window.api.update(id, input),
  duplicate: (id: string): Promise<InterfaceRecord | null> =>
    window.api.duplicate(id),
  deleteOne: (id: string): Promise<boolean> => window.api.deleteOne(id),
  deleteBySource: (source: RecordSource): Promise<number> =>
    window.api.deleteBySource(source),
  rename: (id: string, name: string): Promise<void> =>
    window.api.rename(id, name),
  moveFolder: (id: string, folder: string): Promise<void> =>
    window.api.moveFolder(id, folder),
  listFolders: (): Promise<string[]> => window.api.listFolders(),
  createFolder: (name: string): Promise<void> => window.api.createFolder(name),
  deleteFolder: (name: string): Promise<void> => window.api.deleteFolder(name),
  togglePin: (id: string): Promise<void> => window.api.togglePin(id),
  sendRequest: (id: string, input: CaptureInput): Promise<ResponseRecord | null> =>
    window.api.sendRequest(id, input),
  cancelRequest: (id: string): Promise<void> => window.api.cancelRequest(id),
  batchSend: (input: BatchCallInput, runId: string): Promise<BatchCallResult[]> =>
    window.api.batchSend(input, runId),
  listBatches: (): Promise<BatchProject[]> => window.api.listBatches(),
  saveBatch: (project: BatchProject): Promise<BatchProject> =>
    window.api.saveBatch(project),
  deleteBatch: (id: string): Promise<boolean> => window.api.deleteBatch(id),
  renameBatch: (id: string, name: string): Promise<void> =>
    window.api.renameBatch(id, name),
  moveBatchFolder: (id: string, folder: string): Promise<void> =>
    window.api.moveBatchFolder(id, folder),
  runBatch: (id: string, runId: string, skipIndexes?: number[]): Promise<BatchCallResult[]> =>
    window.api.runBatch(id, runId, skipIndexes),
  /** 中断一次批量执行（暂停）。 */
  cancelBatch: (runId: string): Promise<boolean> => window.api.cancelBatch(runId),
  /** 保存/清除断点续跑进度。 */
  saveBatchProgress: (id: string, progress: BatchProgressState | null): Promise<void> =>
    window.api.saveBatchProgress(id, progress),
  listBatchFolders: (): Promise<string[]> => window.api.listBatchFolders(),
  createBatchFolder: (name: string): Promise<void> =>
    window.api.createBatchFolder(name),
  deleteBatchFolder: (name: string): Promise<void> =>
    window.api.deleteBatchFolder(name),
  listChains: (): Promise<ChainProject[]> => window.api.listChains(),
  saveChain: (project: ChainProject): Promise<ChainProject> =>
    window.api.saveChain(project),
  deleteChain: (id: string): Promise<boolean> => window.api.deleteChain(id),
  renameChain: (id: string, name: string): Promise<void> =>
    window.api.renameChain(id, name),
  moveChainFolder: (id: string, folder: string): Promise<void> =>
    window.api.moveChainFolder(id, folder),
  runChain: (id: string): Promise<ChainRunResult[]> => window.api.runChain(id),
  listChainFolders: (): Promise<string[]> => window.api.listChainFolders(),
  createChainFolder: (name: string): Promise<void> =>
    window.api.createChainFolder(name),
  deleteChainFolder: (name: string): Promise<void> =>
    window.api.deleteChainFolder(name),
  exportCollection: (): Promise<unknown> => window.api.exportCollection(),
  importCollection: (data: unknown): Promise<boolean> =>
    window.api.importCollection(data),
  clearAll: (): Promise<boolean> => window.api.clearAll(),
  getProxyStatus: (): Promise<ProxyStatus> => window.api.getProxyStatus(),
  toggleProxy: (): Promise<ProxyStatus> => window.api.toggleProxy(),
  getCaPath: (): Promise<string | null> => window.api.getCaPath(),
  openCaDir: (): Promise<void> => window.api.openCaDir(),
  openExternal: (url: string): Promise<void> => window.api.openExternal(url),
  getExtensionStatus: (): Promise<ExtensionStatus> =>
    window.api.getExtensionStatus(),
  toggleExtension: (): Promise<ExtensionStatus> =>
    window.api.toggleExtension(),
  getSettings: (): Promise<CaptureSettings> => window.api.getSettings(),
  setSettings: (patch: Partial<CaptureSettings>) => window.api.setSettings(patch),
  /* ── AI 预处理 & 文件夹参数 ── */
  aiPreprocess: (req: { data: string; instruction?: string }): Promise<AiPreprocessResult> =>
    window.api.aiPreprocess(req),
  pickFolder: (): Promise<string | null> => window.api.pickFolder(),
  readFolderFiles: (
    folder: string
  ): Promise<{ files: FolderFile[]; skipped: string[] }> =>
    window.api.readFolderFiles(folder),
  writeParamFolder: (
    rows: Record<string, string>[]
  ): Promise<{ folder: string; count: number }> =>
    window.api.writeParamFolder(rows),
  /* ── 文件保存位置 ── */
  getDataDir: (): Promise<string> => window.api.getDataDir(),
  chooseDataDir: (): Promise<string | null> => window.api.chooseDataDir(),
  setDataDir: (dir: string): Promise<boolean> => window.api.setDataDir(dir),
  relaunch: (): Promise<void> => window.api.relaunch(),
  onUpdated: (cb: (list: InterfaceRecord[], folders: string[]) => void) =>
    window.api.onUpdated(cb),
  onProxyStatus: (cb: (s: ProxyStatus) => void) => window.api.onProxyStatus(cb),
  onExtensionStatus: (cb: (s: ExtensionStatus) => void) =>
    window.api.onExtensionStatus(cb),
  onSettings: (cb: (s: CaptureSettings) => void) => window.api.onSettings(cb),
  /* ── 定时调度 ── */
  listSchedules: (): Promise<ScheduleConfig[]> => window.api.listSchedules(),
  saveSchedule: (config: ScheduleConfig): Promise<ScheduleConfig[]> =>
    window.api.saveSchedule(config),
  deleteSchedule: (id: string): Promise<boolean> =>
    window.api.deleteSchedule(id),
  toggleSchedule: (id: string): Promise<ScheduleConfig | undefined> =>
    window.api.toggleSchedule(id),
  getScheduleHistory: (id: string): Promise<ScheduleConfig['history']> =>
    window.api.getScheduleHistory(id),
  runSchedule: (id: string): Promise<ScheduleRunResult | null> =>
    window.api.runSchedule(id),
  onSchedules: (cb: (list: ScheduleConfig[]) => void) =>
    window.api.onSchedules(cb),
  onBatches: (
    cb: (list: BatchProject[], folders: string[]) => void
  ) => window.api.onBatches(cb),
  /** 订阅批量执行进度（每完成一条推送一次）。 */
  onBatchProgress: (cb: (p: BatchProgress) => void) => window.api.onBatchProgress(cb),
  onChains: (
    cb: (list: ChainProject[], folders: string[]) => void
  ) => window.api.onChains(cb),
};

declare global {
  interface Window {
    api: {
      getList: () => Promise<InterfaceRecord[]>;
      getDetail: (id: string) => Promise<InterfaceRecord | null>;
      addManual: (input: CaptureInput) => Promise<InterfaceRecord | null>;
      update: (id: string, input: CaptureInput) => Promise<InterfaceRecord | null>;
      duplicate: (id: string) => Promise<InterfaceRecord | null>;
      deleteOne: (id: string) => Promise<boolean>;
      deleteBySource: (source: RecordSource) => Promise<number>;
      rename: (id: string, name: string) => Promise<void>;
      moveFolder: (id: string, folder: string) => Promise<void>;
      togglePin: (id: string) => Promise<void>;
      listFolders: () => Promise<string[]>;
      createFolder: (name: string) => Promise<void>;
      deleteFolder: (name: string) => Promise<void>;
      sendRequest: (id: string, input: CaptureInput) => Promise<ResponseRecord | null>;
      cancelRequest: (id: string) => Promise<void>;
      batchSend: (input: BatchCallInput, runId: string) => Promise<BatchCallResult[]>;
      listBatches: () => Promise<BatchProject[]>;
      saveBatch: (project: BatchProject) => Promise<BatchProject>;
      deleteBatch: (id: string) => Promise<boolean>;
      renameBatch: (id: string, name: string) => Promise<void>;
      moveBatchFolder: (id: string, folder: string) => Promise<void>;
      runBatch: (id: string, runId: string, skipIndexes?: number[]) => Promise<BatchCallResult[]>;
      cancelBatch: (runId: string) => Promise<boolean>;
      saveBatchProgress: (id: string, progress: BatchProgressState | null) => Promise<void>;
      listBatchFolders: () => Promise<string[]>;
      createBatchFolder: (name: string) => Promise<void>;
      deleteBatchFolder: (name: string) => Promise<void>;
      exportCollection: () => Promise<unknown>;
      importCollection: (data: unknown) => Promise<boolean>;
      clearAll: () => Promise<boolean>;
      getProxyStatus: () => Promise<ProxyStatus>;
      toggleProxy: () => Promise<ProxyStatus>;
      getCaPath: () => Promise<string | null>;
      openCaDir: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      getExtensionStatus: () => Promise<ExtensionStatus>;
      toggleExtension: () => Promise<ExtensionStatus>;
      getSettings: () => Promise<CaptureSettings>;
      setSettings: (patch: Partial<CaptureSettings>) => Promise<CaptureSettings>;
      aiPreprocess: (req: { data: string; instruction?: string }) => Promise<AiPreprocessResult>;
      pickFolder: () => Promise<string | null>;
      readFolderFiles: (folder: string) => Promise<{ files: FolderFile[]; skipped: string[] }>;
      writeParamFolder: (
        rows: Record<string, string>[]
      ) => Promise<{ folder: string; count: number }>;
      getDataDir: () => Promise<string>;
      chooseDataDir: () => Promise<string | null>;
      setDataDir: (dir: string) => Promise<boolean>;
      relaunch: () => Promise<void>;
      onUpdated: (cb: (list: InterfaceRecord[], folders: string[]) => void) => () => void;
      onProxyStatus: (cb: (s: ProxyStatus) => void) => () => void;
      onExtensionStatus: (cb: (s: ExtensionStatus) => void) => () => void;
      onSettings: (cb: (s: CaptureSettings) => void) => () => void;
      /* ── 定时调度 ── */
      listSchedules: () => Promise<ScheduleConfig[]>;
      saveSchedule: (config: ScheduleConfig) => Promise<ScheduleConfig[]>;
      deleteSchedule: (id: string) => Promise<boolean>;
      toggleSchedule: (id: string) => Promise<ScheduleConfig | undefined>;
      getScheduleHistory: (id: string) => Promise<ScheduleConfig['history']>;
      runSchedule: (id: string) => Promise<ScheduleRunResult | null>;
      onSchedules: (cb: (list: ScheduleConfig[]) => void) => () => void;
      onBatches: (cb: (list: BatchProject[], folders: string[]) => void) => () => void;
      onBatchProgress: (cb: (p: BatchProgress) => void) => () => void;
      /* ── 链式请求 ── */
      listChains: () => Promise<ChainProject[]>;
      saveChain: (project: ChainProject) => Promise<ChainProject>;
      deleteChain: (id: string) => Promise<boolean>;
      renameChain: (id: string, name: string) => Promise<void>;
      moveChainFolder: (id: string, folder: string) => Promise<void>;
      runChain: (id: string) => Promise<ChainRunResult[]>;
      listChainFolders: () => Promise<string[]>;
      createChainFolder: (name: string) => Promise<void>;
      deleteChainFolder: (name: string) => Promise<void>;
      onChains: (cb: (list: ChainProject[], folders: string[]) => void) => () => void;
    };
  }
}
