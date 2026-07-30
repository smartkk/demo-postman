import { useEffect, useState } from 'react';
import { Server, Plus, ShieldAlert, Puzzle, Settings, X, FolderOpen, Clipboard, Network, Sun, Moon, Clock } from 'lucide-react';
import type { ExtensionStatus, ProxyStatus } from '../../../shared/types';
import { api } from '../api/client';

interface Props {
  status: ProxyStatus;
  extStatus: ExtensionStatus;
  onToggle: () => void;
  onToggleExt: () => void;
  onManual: () => void;
  onSchedules: () => void;
  onSettings: () => void;
}

export function ProxyBar({
  status,
  extStatus,
  onToggle,
  onToggleExt,
  onManual,
  onSchedules,
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
    <header className="glass flex h-12 shrink-0 items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-light shadow-lg shadow-brand/30">
          <Server size={16} className="text-white" />
        </div>
        <span className="text-[15px] font-semibold tracking-wide text-slate-100">
          Demo Postman
        </span>
        <span className="ml-1 rounded-md bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-400">
          接口记录工具
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all cursor-pointer ${
            status.running
              ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
              : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700/60'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              status.running
                ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400'
                : 'bg-slate-500'
            }`}
          />
          {status.running ? `代理运行中 · :${status.port}` : '代理已停止'}
        </button>

        <button
          onClick={onToggleExt}
          title="浏览器插件接收端点：开启后，配合 Chrome 扩展可自动记录页面发出的请求"
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all cursor-pointer ${
            extStatus.running
              ? 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
              : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700/60'
          }`}
        >
          <Puzzle size={14} />
          {extStatus.running ? `插件端点 · :${extStatus.port}` : '插件端点已停'}
        </button>

        {status.running && (
          <button
            onClick={configureSystemProxy}
            title="复制代理地址并打开系统代理设置"
            className="flex items-center gap-1.5 rounded-lg bg-slate-700/40 px-3 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer"
          >
            <Network size={14} /> 配置系统代理
          </button>
        )}

        {status.running && status.caPath && (
          <button
            onClick={() => setCaOpen(true)}
            title={`HTTPS 抓包需信任 CA：${status.caPath}`}
            className="flex items-center gap-1 text-[11px] text-amber-400/80 transition hover:text-amber-300 cursor-pointer"
          >
            <ShieldAlert size={13} /> HTTPS 需装 CA
          </button>
        )}

        <button
          onClick={onManual}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand to-brand-light px-3 py-1.5 text-[13px] font-medium text-white shadow-lg shadow-brand/30 transition-all hover:brightness-110 cursor-pointer"
        >
          <Plus size={15} /> 手动录入
        </button>

        <button
          onClick={() => setLight((v) => !v)}
          title={light ? '切换到深色主题' : '切换到浅色主题'}
          className="flex items-center gap-1.5 rounded-lg bg-slate-700/40 px-3 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer"
        >
          {light ? <Moon size={15} /> : <Sun size={15} />}
        </button>

        <button
          onClick={onSchedules}
          title="定时调度：以固定间隔自动调用接口"
          className="flex items-center gap-1.5 rounded-lg bg-slate-700/40 px-3 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer"
        >
          <Clock size={15} /> 定时
        </button>

        <button
          onClick={onSettings}
          title="抓取设置（白名单 / 自动分组）"
          className="flex items-center gap-1.5 rounded-lg bg-slate-700/40 px-3 py-1.5 text-[13px] font-medium text-slate-300 transition-all hover:bg-slate-700/60 cursor-pointer"
        >
          <Settings size={15} /> 设置
        </button>
      </div>

      {caOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
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
