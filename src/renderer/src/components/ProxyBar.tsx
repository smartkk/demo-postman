import { useEffect, useState } from 'react';
import { Server, Plus, ShieldAlert, Puzzle, Settings, X, FolderOpen, Clipboard, Network, Sun, Moon, Clock, Layers, GitBranch } from 'lucide-react';
import type { ExtensionStatus, ProxyStatus } from '../../../shared/types';
import { api } from '../api/client';

interface Props {
  status: ProxyStatus;
  extStatus: ExtensionStatus;
  onToggle: () => void;
  onToggleExt: () => void;
  onManual: () => void;
  onSchedules: () => void;
  onBatch: () => void;
  onChain: () => void;
  onSettings: () => void;
}

export function ProxyBar({
  status,
  extStatus,
  onToggle,
  onToggleExt,
  onManual,
  onSchedules,
  onBatch,
  onChain,
  onSettings,
}: Props) {
  const [caOpen, setCaOpen] = useState(false);
  const [light, setLight] = useState(
    () => localStorage.getItem('theme') === 'light'
  );

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', light);
    localStorage.setItem('theme', light ? 'light' : 'dark');
  }, [light]);

  const configureSystemProxy = async () => {
    await navigator.clipboard?.writeText(`127.0.0.1:${status.port}`);
    await api.openExternal('ms-settings:network-proxy');
  };

  return (
    <header className="glass flex h-12 shrink-0 items-center gap-2 px-3 sm:px-4">
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-light shadow-lg shadow-brand/30">
          <Server size={16} className="text-white" />
        </div>
        <span className="hidden text-[15px] font-semibold tracking-wide text-slate-100 sm:inline">
          Demo Postman
        </span>
        <span className="ml-1 hidden rounded-md bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-400 lg:inline">
          接口记录工具
        </span>
      </div>

      {/* 右侧操作区：窗口变窄时文字隐藏、仅留图标；极窄时整体可横向滚动，杜绝堆叠 */}
      <div className="ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2 lg:gap-3 [&>button]:shrink-0">
        <button
          onClick={onToggle}
          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all cursor-pointer sm:px-3 ${
            status.running
              ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
              : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700/60'
          }`}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              status.running
                ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400'
                : 'bg-slate-500'
            }`}
          />
          <span className="hidden sm:inline">{status.running ? `代理运行中 · :${status.port}` : '代理已停止'}</span>
        </button>

        <button
          onClick={onToggleExt}
          title="浏览器插件接收端点：开启后，配合 Chrome 扩展可自动记录页面发出的请求"
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all cursor-pointer sm:px-3 ${
            extStatus.running
              ? 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
              : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700/60'
          }`}
        >
          <Puzzle size={14} className="shrink-0" />
          <span className="hidden sm:inline">{extStatus.running ? `插件端点 · :${extStatus.port}` : '插件端点已停'}</span>
        </button>

        {status.running && (
          <button
            onClick={configureSystemProxy}
            title="复制代理地址并打开系统代理设置"
            className="flex items-center gap-1.5 rounded-lg bg-slate-700/40 px-2.5 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer sm:px-3"
          >
            <Network size={14} className="shrink-0" />
            <span className="hidden md:inline">配置系统代理</span>
          </button>
        )}

        {status.running && status.caPath && (
          <button
            onClick={() => setCaOpen(true)}
            title={`HTTPS 抓包需信任 CA：${status.caPath}`}
            className="flex shrink-0 items-center gap-1 text-[11px] text-amber-400/80 transition hover:text-amber-300 cursor-pointer"
          >
            <ShieldAlert size={13} className="shrink-0" />
            <span className="hidden lg:inline">HTTPS 需装 CA</span>
          </button>
        )}

        <button
          onClick={onManual}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand to-brand-light px-2.5 py-1.5 text-[13px] font-medium text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110 cursor-pointer sm:px-3"
        >
          <Plus size={15} className="shrink-0" />
          <span className="hidden sm:inline">手动录入</span>
        </button>

        <button
          onClick={() => setLight((v) => !v)}
          title={light ? '切换到深色主题' : '切换到浅色主题'}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700/40 px-2.5 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer sm:px-3"
        >
          {light ? <Moon size={15} className="shrink-0" /> : <Sun size={15} className="shrink-0" />}
        </button>

        <button
          onClick={onSchedules}
          title="定时调度：以固定间隔自动调用接口"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700/40 px-2.5 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer sm:px-3"
        >
          <Clock size={15} className="shrink-0" />
          <span className="hidden lg:inline">定时</span>
        </button>

        <button
          onClick={onBatch}
          title="批量调用：同一接口用不同参数批量请求"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700/40 px-2.5 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer sm:px-3"
        >
          <Layers size={15} className="shrink-0" />
          <span className="hidden lg:inline">批量</span>
        </button>

        <button
          onClick={onChain}
          title="链式请求：多接口按顺序串联，上一步响应作为参数传给下一步"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700/40 px-2.5 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer sm:px-3"
        >
          <GitBranch size={15} className="shrink-0" />
          <span className="hidden lg:inline">链式</span>
        </button>

        <button
          onClick={onSettings}
          title="抓取设置（白名单 / 自动分组）"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700/40 px-2.5 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer sm:px-3"
        >
          <Settings size={15} className="shrink-0" />
          <span className="hidden lg:inline">设置</span>
        </button>
      </div>

      {caOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm"
          onClick={() => setCaOpen(false)}
        >
          <div
            className="glass w-[440px] max-w-[92vw] rounded-2xl border border-slate-700/50 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
                <ShieldAlert size={16} className="text-amber-400" /> 安装 CA 证书（HTTPS 抓包）
              </h2>
              <button
                onClick={() => setCaOpen(false)}
                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-[12.5px] leading-relaxed text-slate-300">
              <li>
                点击下方「打开 CA 目录」，在资源管理器中找到{' '}
                <code className="text-amber-300">ca-cert.pem</code> /{' '}
                <code className="text-amber-300">.crt</code> 文件。
              </li>
              <li>双击证书 → 安装证书 → 选择「受信任的根证书颁发机构」。</li>
              <li>
                浏览器（Chrome/Edge）在 <code>chrome://settings/certificates</code>{' '}
                的「受信任的根证书颁发机构」中也可导入。
              </li>
              <li>导入后重启浏览器，代理即可解密 HTTPS 流量。</li>
            </ol>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => api.openCaDir()}
                className="flex items-center gap-1.5 rounded-lg bg-slate-700/50 px-3 py-1.5 text-[12.5px] text-slate-200 transition hover:bg-slate-700 cursor-pointer"
              >
                <FolderOpen size={13} /> 打开 CA 目录
              </button>
              <button
                onClick={() => navigator.clipboard?.writeText(status.caPath || '')}
                className="flex items-center gap-1.5 rounded-lg bg-slate-700/50 px-3 py-1.5 text-[12.5px] text-slate-200 transition hover:bg-slate-700 cursor-pointer"
              >
                <Clipboard size={13} /> 复制路径
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
