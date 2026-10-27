import { contextBridge, ipcRenderer } from 'electron';
import type {
  BatchProgress,
  BatchProject,
  CaptureSettings,
  ChainProject,
  ExtensionStatus,
  InterfaceSummary,
  ProxyStatus,
  RendererApi,
  ScheduleConfig,
} from '../shared/types';

/**
 * 主进程 API 实现：方法签名统一由 shared/types.ts 的 RendererApi 约束，
 * 新增 IPC 只需在该接口维护一份，避免 preload 与渲染进程双份手写不一致。
 */
const api: RendererApi = {
  // 列表走摘要（响应体截断），完整记录经 getDetail 按需拉取
  getList: () => ipcRenderer.invoke('store:list'),
  getDetail: (id) => ipcRenderer.invoke('store:detail', id),
  addManual: (input) => ipcRenderer.invoke('store:add', input),
  update: (id, input) => ipcRenderer.invoke('store:update', id, input),
  duplicate: (id) => ipcRenderer.invoke('store:duplicate', id),
  deleteOne: (id) => ipcRenderer.invoke('store:delete', id),
  deleteBySource: (source) => ipcRenderer.invoke('store:deleteBySource', source),
  rename: (id, name) => ipcRenderer.invoke('store:rename', id, name),
  moveFolder: (id, folder) => ipcRenderer.invoke('store:moveFolder', id, folder),
  moveMany: (ids, folder) => ipcRenderer.invoke('store:moveMany', ids, folder),
  listFolders: () => ipcRenderer.invoke('store:folders'),
  createFolder: (name) => ipcRenderer.invoke('store:createFolder', name),
  deleteFolder: (name) => ipcRenderer.invoke('store:deleteFolder', name),
  togglePin: (id) => ipcRenderer.invoke('store:togglePin', id),
  sendRequest: (id, input) => ipcRenderer.invoke('request:send', id, input),
  cancelRequest: (id) => ipcRenderer.invoke('request:cancel', id),
  batchSend: (input, runId) => ipcRenderer.invoke('request:batchSend', input, runId),
  listBatches: () => ipcRenderer.invoke('batch:list'),
  saveBatch: (project) => ipcRenderer.invoke('batch:save', project),
  deleteBatch: (id) => ipcRenderer.invoke('batch:delete', id),
  renameBatch: (id, name) => ipcRenderer.invoke('batch:rename', id, name),
  moveBatchFolder: (id, folder) => ipcRenderer.invoke('batch:moveFolder', id, folder),
  runBatch: (id, runId, skipIndexes) =>
    ipcRenderer.invoke('batch:run', id, runId, skipIndexes),
  // 中断一次批量执行（暂停）：返回是否命中正在执行的批次
  cancelBatch: (runId) => ipcRenderer.invoke('batch:cancel', runId),
  // 保存/清除断点续跑进度（progress 传 null 表示清除）
  saveBatchProgress: (id, progress) =>
    ipcRenderer.invoke('batch:progress', id, progress),
  listBatchFolders: () => ipcRenderer.invoke('batch:folders'),
  createBatchFolder: (name) => ipcRenderer.invoke('batch:createFolder', name),
  deleteBatchFolder: (name) => ipcRenderer.invoke('batch:deleteFolder', name),
  listChains: () => ipcRenderer.invoke('chain:list'),
  saveChain: (project) => ipcRenderer.invoke('chain:save', project),
  deleteChain: (id) => ipcRenderer.invoke('chain:delete', id),
  renameChain: (id, name) => ipcRenderer.invoke('chain:rename', id, name),
  moveChainFolder: (id, folder) => ipcRenderer.invoke('chain:moveFolder', id, folder),
  runChain: (id) => ipcRenderer.invoke('chain:run', id),
  listChainFolders: () => ipcRenderer.invoke('chain:folders'),
  createChainFolder: (name) => ipcRenderer.invoke('chain:createFolder', name),
  deleteChainFolder: (name) => ipcRenderer.invoke('chain:deleteFolder', name),
  onChains: (cb) => {
    const handler = (_e: unknown, list: ChainProject[], folders: string[]) =>
      cb(list, folders);
    ipcRenderer.on('chain:updated', handler);
    return () => ipcRenderer.removeListener('chain:updated', handler);
  },
  onBatches: (cb) => {
    const handler = (_e: unknown, list: BatchProject[], folders: string[]) =>
      cb(list, folders);
    ipcRenderer.on('batch:updated', handler);
    return () => ipcRenderer.removeListener('batch:updated', handler);
  },
  // 订阅批量执行进度：每完成一条请求推送一次
  onBatchProgress: (cb) => {
    const handler = (_e: unknown, p: BatchProgress) => cb(p);
    ipcRenderer.on('batch:progress', handler);
    return () => ipcRenderer.removeListener('batch:progress', handler);
  },
  exportCollection: () => ipcRenderer.invoke('collection:export'),
  importCollection: (data) => ipcRenderer.invoke('collection:import', data),
  clearAll: () => ipcRenderer.invoke('store:clear'),
  getProxyStatus: () => ipcRenderer.invoke('proxy:status'),
  toggleProxy: () => ipcRenderer.invoke('proxy:toggle'),
  getCaPath: () => ipcRenderer.invoke('proxy:caPath'),
  openCaDir: () => ipcRenderer.invoke('proxy:openCaDir'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getExtensionStatus: () => ipcRenderer.invoke('extension:status'),
  toggleExtension: () => ipcRenderer.invoke('extension:toggle'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  /* ── AI 预处理 & 文件夹参数 ── */
  aiPreprocess: (req) => ipcRenderer.invoke('ai:preprocess', req),
  pickFolder: () => ipcRenderer.invoke('fs:pickFolder'),
  readFolderFiles: (folder) => ipcRenderer.invoke('fs:readFolderFiles', folder),
  writeParamFolder: (rows) => ipcRenderer.invoke('fs:writeParamFolder', rows),
  getDataDir: () => ipcRenderer.invoke('app:getDataDir'),
  chooseDataDir: () => ipcRenderer.invoke('app:chooseDataDir'),
  setDataDir: (dir) => ipcRenderer.invoke('app:setDataDir', dir),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  onUpdated: (cb) => {
    const handler = (_e: unknown, list: InterfaceSummary[], folders: string[]) =>
      cb(list, folders);
    ipcRenderer.on('store:updated', handler);
    return () => ipcRenderer.removeListener('store:updated', handler);
  },
  onProxyStatus: (cb) => {
    const handler = (_e: unknown, s: ProxyStatus) => cb(s);
    ipcRenderer.on('proxy:status', handler);
    return () => ipcRenderer.removeListener('proxy:status', handler);
  },
  onExtensionStatus: (cb) => {
    const handler = (_e: unknown, s: ExtensionStatus) => cb(s);
    ipcRenderer.on('extension:status', handler);
    return () => ipcRenderer.removeListener('extension:status', handler);
  },
  onSettings: (cb) => {
    const handler = (_e: unknown, s: CaptureSettings) => cb(s);
    ipcRenderer.on('settings:updated', handler);
    return () => ipcRenderer.removeListener('settings:updated', handler);
  },
  /* ── 定时调度 ── */
  listSchedules: () => ipcRenderer.invoke('schedule:list'),
  saveSchedule: (config) => ipcRenderer.invoke('schedule:save', config),
  deleteSchedule: (id) => ipcRenderer.invoke('schedule:delete', id),
  toggleSchedule: (id) => ipcRenderer.invoke('schedule:toggle', id),
  getScheduleHistory: (id) => ipcRenderer.invoke('schedule:history', id),
  runSchedule: (id) => ipcRenderer.invoke('schedule:runNow', id),
  onSchedules: (cb) => {
    const handler = (_e: unknown, list: ScheduleConfig[]) => cb(list);
    ipcRenderer.on('schedule:updated', handler);
    return () => ipcRenderer.removeListener('schedule:updated', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
