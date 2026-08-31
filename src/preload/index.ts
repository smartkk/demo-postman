import { contextBridge, ipcRenderer } from 'electron';
import type {
  BatchCallInput,
  BatchCallResult,
  BatchProject,
  CaptureInput,
  CaptureSettings,
  ChainProject,
  ChainRunResult,
  ExtensionStatus,
  InterfaceRecord,
  ProxyStatus,
  RecordSource,
  ResponseRecord,
  ScheduleConfig,
  ScheduleRunResult,
} from '../shared/types';

const api = {
  getList: (): Promise<InterfaceRecord[]> => ipcRenderer.invoke('store:list'),
  getDetail: (id: string): Promise<InterfaceRecord | null> =>
    ipcRenderer.invoke('store:detail', id),
  addManual: (input: CaptureInput): Promise<InterfaceRecord | null> =>
    ipcRenderer.invoke('store:add', input),
  update: (id: string, input: CaptureInput): Promise<InterfaceRecord | null> =>
    ipcRenderer.invoke('store:update', id, input),
  duplicate: (id: string): Promise<InterfaceRecord | null> =>
    ipcRenderer.invoke('store:duplicate', id),
  deleteOne: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('store:delete', id),
  deleteBySource: (source: RecordSource): Promise<number> =>
    ipcRenderer.invoke('store:deleteBySource', source),
  rename: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke('store:rename', id, name),
  moveFolder: (id: string, folder: string): Promise<void> =>
    ipcRenderer.invoke('store:moveFolder', id, folder),
  listFolders: (): Promise<string[]> => ipcRenderer.invoke('store:folders'),
  createFolder: (name: string): Promise<void> =>
    ipcRenderer.invoke('store:createFolder', name),
  deleteFolder: (name: string): Promise<void> =>
    ipcRenderer.invoke('store:deleteFolder', name),
  togglePin: (id: string): Promise<void> =>
    ipcRenderer.invoke('store:togglePin', id),
  sendRequest: (id: string, input: CaptureInput): Promise<ResponseRecord | null> =>
    ipcRenderer.invoke('request:send', id, input),
  cancelRequest: (id: string): Promise<void> =>
    ipcRenderer.invoke('request:cancel', id),
  batchSend: (input: BatchCallInput): Promise<BatchCallResult[]> =>
    ipcRenderer.invoke('request:batchSend', input),
  listBatches: (): Promise<BatchProject[]> =>
    ipcRenderer.invoke('batch:list'),
  saveBatch: (project: BatchProject): Promise<BatchProject> =>
    ipcRenderer.invoke('batch:save', project),
  deleteBatch: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('batch:delete', id),
  renameBatch: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke('batch:rename', id, name),
  moveBatchFolder: (id: string, folder: string): Promise<void> =>
    ipcRenderer.invoke('batch:moveFolder', id, folder),
  runBatch: (id: string): Promise<BatchCallResult[]> =>
    ipcRenderer.invoke('batch:run', id),
  listBatchFolders: (): Promise<string[]> =>
    ipcRenderer.invoke('batch:folders'),
  createBatchFolder: (name: string): Promise<void> =>
    ipcRenderer.invoke('batch:createFolder', name),
  deleteBatchFolder: (name: string): Promise<void> =>
    ipcRenderer.invoke('batch:deleteFolder', name),
  listChains: (): Promise<ChainProject[]> =>
    ipcRenderer.invoke('chain:list'),
  saveChain: (project: ChainProject): Promise<ChainProject> =>
    ipcRenderer.invoke('chain:save', project),
  deleteChain: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('chain:delete', id),
  renameChain: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke('chain:rename', id, name),
  moveChainFolder: (id: string, folder: string): Promise<void> =>
    ipcRenderer.invoke('chain:moveFolder', id, folder),
  runChain: (id: string): Promise<ChainRunResult[]> =>
    ipcRenderer.invoke('chain:run', id),
  listChainFolders: (): Promise<string[]> =>
    ipcRenderer.invoke('chain:folders'),
  createChainFolder: (name: string): Promise<void> =>
    ipcRenderer.invoke('chain:createFolder', name),
  deleteChainFolder: (name: string): Promise<void> =>
    ipcRenderer.invoke('chain:deleteFolder', name),
  onChains: (
    cb: (list: ChainProject[], folders: string[]) => void
  ): (() => void) => {
    const handler = (_e: unknown, list: ChainProject[], folders: string[]) =>
      cb(list, folders);
    ipcRenderer.on('chain:updated', handler);
    return () => ipcRenderer.removeListener('chain:updated', handler);
  },
  onBatches: (
    cb: (list: BatchProject[], folders: string[]) => void
  ): (() => void) => {
    const handler = (_e: unknown, list: BatchProject[], folders: string[]) =>
      cb(list, folders);
    ipcRenderer.on('batch:updated', handler);
    return () => ipcRenderer.removeListener('batch:updated', handler);
  },
  exportCollection: (): Promise<unknown> =>
    ipcRenderer.invoke('collection:export'),
  importCollection: (data: unknown): Promise<boolean> =>
    ipcRenderer.invoke('collection:import', data),
  clearAll: (): Promise<boolean> => ipcRenderer.invoke('store:clear'),
  getProxyStatus: (): Promise<ProxyStatus> =>
    ipcRenderer.invoke('proxy:status'),
  toggleProxy: (): Promise<ProxyStatus> => ipcRenderer.invoke('proxy:toggle'),
  getCaPath: (): Promise<string | null> => ipcRenderer.invoke('proxy:caPath'),
  openCaDir: (): Promise<void> => ipcRenderer.invoke('proxy:openCaDir'),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('app:openExternal', url),
  getExtensionStatus: (): Promise<ExtensionStatus> =>
    ipcRenderer.invoke('extension:status'),
  toggleExtension: (): Promise<ExtensionStatus> =>
    ipcRenderer.invoke('extension:toggle'),
  getSettings: (): Promise<CaptureSettings> =>
    ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<CaptureSettings>): Promise<CaptureSettings> =>
    ipcRenderer.invoke('settings:set', patch),
  getDataDir: (): Promise<string> => ipcRenderer.invoke('app:getDataDir'),
  chooseDataDir: (): Promise<string | null> =>
    ipcRenderer.invoke('app:chooseDataDir'),
  setDataDir: (dir: string): Promise<boolean> =>
    ipcRenderer.invoke('app:setDataDir', dir),
  relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
  onUpdated: (cb: (list: InterfaceRecord[], folders: string[]) => void): (() => void) => {
    const handler = (_e: unknown, list: InterfaceRecord[], folders: string[]) =>
      cb(list, folders);
    ipcRenderer.on('store:updated', handler);
    return () => ipcRenderer.removeListener('store:updated', handler);
  },
  onProxyStatus: (cb: (s: ProxyStatus) => void): (() => void) => {
    const handler = (_e: unknown, s: ProxyStatus) => cb(s);
    ipcRenderer.on('proxy:status', handler);
    return () => ipcRenderer.removeListener('proxy:status', handler);
  },
  onExtensionStatus: (cb: (s: ExtensionStatus) => void): (() => void) => {
    const handler = (_e: unknown, s: ExtensionStatus) => cb(s);
    ipcRenderer.on('extension:status', handler);
    return () => ipcRenderer.removeListener('extension:status', handler);
  },
  onSettings: (cb: (s: CaptureSettings) => void): (() => void) => {
    const handler = (_e: unknown, s: CaptureSettings) => cb(s);
    ipcRenderer.on('settings:updated', handler);
    return () => ipcRenderer.removeListener('settings:updated', handler);
  },
  /* ── 定时调度 ── */
  listSchedules: (): Promise<ScheduleConfig[]> =>
    ipcRenderer.invoke('schedule:list'),
  saveSchedule: (config: ScheduleConfig): Promise<ScheduleConfig[]> =>
    ipcRenderer.invoke('schedule:save', config),
  deleteSchedule: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('schedule:delete', id),
  toggleSchedule: (id: string): Promise<ScheduleConfig | undefined> =>
    ipcRenderer.invoke('schedule:toggle', id),
  getScheduleHistory: (id: string): Promise<ScheduleConfig['history']> =>
    ipcRenderer.invoke('schedule:history', id),
  runSchedule: (id: string): Promise<ScheduleRunResult | null> =>
    ipcRenderer.invoke('schedule:runNow', id),
  onSchedules: (cb: (list: ScheduleConfig[]) => void): (() => void) => {
    const handler = (_e: unknown, list: ScheduleConfig[]) => cb(list);
    ipcRenderer.on('schedule:updated', handler);
    return () => ipcRenderer.removeListener('schedule:updated', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
