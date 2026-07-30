import type {
  CaptureInput,
  CaptureSettings,
  ExtensionStatus,
  InterfaceRecord,
  ProxyStatus,
  RecordSource,
  ResponseRecord,
  ScheduleConfig,
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
  setSettings: (patch: Partial<CaptureSettings>): Promise<CaptureSettings> =>
    window.api.setSettings(patch),
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
  onSchedules: (cb: (list: ScheduleConfig[]) => void) =>
    window.api.onSchedules(cb),
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
      onUpdated: (cb: (list: InterfaceRecord[], folders: string[]) => void) => void;
      onProxyStatus: (cb: (s: ProxyStatus) => void) => void;
      onExtensionStatus: (cb: (s: ExtensionStatus) => void) => void;
      onSettings: (cb: (s: CaptureSettings) => void) => void;
      /* ── 定时调度 ── */
      listSchedules: () => Promise<ScheduleConfig[]>;
      saveSchedule: (config: ScheduleConfig) => Promise<ScheduleConfig[]>;
      deleteSchedule: (id: string) => Promise<boolean>;
      toggleSchedule: (id: string) => Promise<ScheduleConfig | undefined>;
      getScheduleHistory: (id: string) => Promise<ScheduleConfig['history']>;
      onSchedules: (cb: (list: ScheduleConfig[]) => void) => void;
    };
  }
}
