import { useCallback, useEffect, useRef, useState } from 'react';
import { ProxyBar } from './components/ProxyBar';
import { Sidebar } from './components/Sidebar';
import { DetailPanel } from './components/DetailPanel';
import { ManualEntry } from './components/ManualEntry';
import { SettingsPanel } from './components/SettingsPanel';
import { SchedulePanel } from './components/SchedulePanel';
import { BatchPanel } from './components/BatchPanel';
import { ChainPanel } from './components/ChainPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { api } from './api/client';
import { useInterfaces } from './store/useInterfaces';
import type {
  CaptureSettings,
  ExtensionStatus,
  ProxyStatus,
} from '../../shared/types';

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 600;
const SIDEBAR_DEFAULT = 320;

export default function App() {
  const store = useInterfaces();
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>({
    running: false,
    port: 8899,
    caPath: null,
  });
  const [extStatus, setExtStatus] = useState<ExtensionStatus>({
    running: false,
    port: 8891,
  });
  const [manualOpen, setManualOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<CaptureSettings>({
    includeHosts: [],
    excludeHosts: [],
    autoGroup: true,
  });
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const dragging = useRef(false);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX;
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  useEffect(() => {
    api.getProxyStatus().then(setProxyStatus);
    api.onProxyStatus(setProxyStatus);
    api.getExtensionStatus().then(setExtStatus);
    api.onExtensionStatus(setExtStatus);
    api.getSettings().then(setSettings);
    api.onSettings(setSettings);
  }, []);

  // 全局快捷键：Ctrl/Cmd+K 聚焦搜索；Esc 清空搜索/取消选择
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      } else if (e.key === 'Escape') {
        const el = document.getElementById('search-input') as HTMLInputElement | null;
        if (el && el.value) {
          store.setKeyword('');
          el.blur();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 全局复制兜底：只读区域未选中任何文本、且焦点不在可编辑元素时，
  // 阻止 Ctrl/Cmd+C 的默认「复制整页文档」回退（表现为整页字符被选中高亮）。
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection();
      const hasSelection = !!sel && sel.toString().length > 0;
      if (hasSelection) return;
      const ae = document.activeElement as HTMLElement | null;
      const editable =
        ae &&
        (ae.tagName === 'INPUT' ||
          ae.tagName === 'TEXTAREA' ||
          ae.isContentEditable);
      if (editable) return;
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  const toggleProxy = async () => {
    const s = await api.toggleProxy();
    setProxyStatus(s);
  };

  const toggleExt = async () => {
    const s = await api.toggleExtension();
    setExtStatus(s);
  };

  const updateSettings = async (patch: Partial<CaptureSettings>) => {
    const next = await api.setSettings(patch);
    setSettings(next);
  };

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col bg-[#0F172A] text-slate-200">
      <ProxyBar
        status={proxyStatus}
        extStatus={extStatus}
        onToggle={toggleProxy}
        onToggleExt={toggleExt}
        onManual={() => setManualOpen(true)}
        onSchedules={() => setSchedulesOpen(true)}
        onBatch={() => setBatchOpen(true)}
        onChain={() => setChainOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <div style={{ width: sidebarWidth }} className="shrink-0">
          <Sidebar store={store} />
        </div>
        <div
          className="relative w-1.5 shrink-0 cursor-col-resize bg-slate-700/30 transition-colors hover:bg-brand/60 active:bg-brand"
          onMouseDown={onResizeStart}
        >
          <div className="absolute inset-y-0 -left-0.5 -right-0.5" />
        </div>
        <DetailPanel record={store.selected} store={store} />
      </div>
      {manualOpen && (
        <ManualEntry
          onClose={() => setManualOpen(false)}
          onSubmit={async (input) => {
            await store.addManual(input);
            setManualOpen(false);
          }}
        />
      )}
      {schedulesOpen && (
        <SchedulePanel
          records={store.list}
          onClose={() => setSchedulesOpen(false)}
        />
      )}
      {batchOpen && <BatchPanel onClose={() => setBatchOpen(false)} />}
      {chainOpen && <ChainPanel onClose={() => setChainOpen(false)} />}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      </div>
    </ErrorBoundary>
  );
}
