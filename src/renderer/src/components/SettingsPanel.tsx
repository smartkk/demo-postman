import { useEffect, useState } from 'react';
import { X, Filter, FolderTree, Layers, Plus, Sparkles } from 'lucide-react';
import type { CaptureSettings } from '../../../shared/types';
import { api } from '../api/client';

/** 将逗号/换行分隔的字符串解析为过滤规则数组（与 main 端保持一致）。 */
function parseList(v: string): string[] {
  return v
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 将 KEY=VALUE 多行文本解析为变量对象。 */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    if (k) out[k] = line.slice(idx + 1).trim();
  }
  return out;
}

function stringifyEnv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

interface Props {
  settings: CaptureSettings;
  onChange: (patch: Partial<CaptureSettings>) => void;
  onClose: () => void;
}

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  const [includeText, setIncludeText] = useState(settings.includeHosts.join('\n'));
  const [excludeText, setExcludeText] = useState(settings.excludeHosts.join('\n'));

  const environments = settings.environments || { 默认: {} };
  const activeEnv = settings.activeEnv || '默认';
  const activeVars = environments[activeEnv] || {};

  const commitInclude = (v: string) => {
    setIncludeText(v);
    onChange({ includeHosts: parseList(v) });
  };
  const commitExclude = (v: string) => {
    setExcludeText(v);
    onChange({ excludeHosts: parseList(v) });
  };

  // ── AI 预处理设置（本地受控，输入即时生效） ──
  const ai = settings.ai || { baseUrl: '', apiKey: '', model: '' };
  const [aiBaseUrl, setAiBaseUrl] = useState(ai.baseUrl);
  const [aiApiKey, setAiApiKey] = useState(ai.apiKey);
  const [aiModel, setAiModel] = useState(ai.model);
  const commitAi = (patch: Partial<{ baseUrl: string; apiKey: string; model: string }>) => {
    if ('baseUrl' in patch) setAiBaseUrl(patch.baseUrl!);
    if ('apiKey' in patch) setAiApiKey(patch.apiKey!);
    if ('model' in patch) setAiModel(patch.model!);
    onChange({ ai: { ...ai, ...patch } });
  };

  // 环境变量文本用本地状态受控，避免「输入行缺少 = 时被 parseEnv 清空」导致无法编辑；
  // 仅在切换环境时从 props 重新同步。
  const [envText, setEnvText] = useState(stringifyEnv(activeVars));
  useEffect(() => {
    setEnvText(stringifyEnv(activeVars));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEnv]);
  const commitEnvText = (text: string) => {
    setEnvText(text);
    onChange({
      environments: { ...environments, [activeEnv]: parseEnv(text) },
    });
  };

  // ── 环境变量：内联新增（避免依赖被禁用的 window.prompt） ──
  const [addingEnv, setAddingEnv] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const addEnv = () => {
    setAddingEnv(true);
    setNewEnvName('');
  };
  const confirmAddEnv = () => {
    const name = newEnvName.trim();
    if (name && !environments[name]) {
      onChange({
        environments: { ...environments, [name]: {} },
        activeEnv: name,
      });
    }
    setAddingEnv(false);
    setNewEnvName('');
  };

  // ── 文件保存位置 ──
  const [dataDir, setDataDir] = useState('');
  const [dirMsg, setDirMsg] = useState('');
  useEffect(() => {
    // 防御：若运行的是旧构建（preload 未暴露 getDataDir），跳过而非崩溃
    if (typeof window.api?.getDataDir === 'function') {
      window.api.getDataDir().then(setDataDir).catch(() => {});
    }
  }, []);
  const chooseDataDir = async () => {
    try {
      const picked = await api.chooseDataDir();
      if (!picked) return;
      const ok = await api.setDataDir(picked);
      if (ok) {
        setDataDir(picked);
        setDirMsg('已设置，请点击「重启应用」使新位置生效（数据会自动迁移）。');
      } else {
        setDirMsg('该目录无效或无写入权限，请重新选择。');
      }
    } catch {
      setDirMsg('操作失败，请重试。');
    }
  };
  const resetDataDir = async () => {
    try {
      await api.setDataDir('');
      setDataDir('');
      setDirMsg('已恢复默认位置，请点击「重启应用」生效。');
    } catch {
      setDirMsg('操作失败，请重试。');
    }
  };
  const relaunchApp = async () => {
    try {
      await api.relaunch();
    } catch {
      /* noop */
    }
  };

  const Toggle = ({
    on,
    onClick,
  }: {
    on: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors cursor-pointer ${
        on ? 'bg-brand' : 'bg-slate-600'
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white transition-transform ${
          on ? 'translate-x-4' : ''
        }`}
      />
    </button>
  );

  return (
    <div
      data-select-scope
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass max-h-[88vh] w-[460px] max-w-[92vw] overflow-y-auto rounded-2xl border border-slate-700/50 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
            <Filter size={16} className="text-brand-light" /> 抓取设置
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <label className="flex items-start justify-between gap-3 rounded-xl bg-slate-800/40 p-3">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-200">
                <FolderTree size={13} className="text-brand-light" /> 按域名自动分组
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                浏览器抓取的请求自动归入以「域名」命名的分组（如 api.example.com）。
                仅作用于新抓取的记录，已存在的分组不受影响。
              </span>
            </span>
            <Toggle on={settings.autoGroup} onClick={() => onChange({ autoGroup: !settings.autoGroup })} />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-xl bg-slate-800/40 p-3">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-200">
                <Layers size={13} className="text-brand-light" /> 按完整 URL 去重
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                默认仅按 method+host+path 去重（忽略 query）。开启后，不同 query
                参数的同接口会被视为不同接口分别记录。
              </span>
            </span>
            <Toggle
              on={!!settings.dedupByFullUrl}
              onClick={() => onChange({ dedupByFullUrl: !settings.dedupByFullUrl })}
            />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-xl bg-slate-800/40 p-3">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-200">
                <Layers size={13} className="text-brand-light" /> 严格校验 TLS 证书
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                关闭时接受自签名 / 内网证书（默认，适合调试）；开启后会对 HTTPS 目标做证书校验，自签名证书会被拒绝。
              </span>
            </span>
            <Toggle on={!!settings.verifyTls} onClick={() => onChange({ verifyTls: !settings.verifyTls })} />
          </label>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-slate-300">
              仅捕获这些主机
            </label>
            <textarea
              value={includeText}
              onChange={(e) => commitInclude(e.target.value)}
              placeholder={'空 = 不过滤（全部捕获）\n例如：api.example.com\n*.myapp.com'}
              className="h-[68px] w-full resize-none rounded-lg border border-slate-700/50 bg-slate-800/40 p-2.5 text-[12px] text-slate-200 outline-none transition focus:border-brand/60"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-slate-300">
              排除这些主机
            </label>
            <textarea
              value={excludeText}
              onChange={(e) => commitExclude(e.target.value)}
              placeholder={'例如：analytics.google.com\n*.adservice.com'}
              className="h-[68px] w-full resize-none rounded-lg border border-slate-700/50 bg-slate-800/40 p-2.5 text-[12px] text-slate-200 outline-none transition focus:border-brand/60"
            />
          </div>

          <div className="rounded-xl bg-slate-800/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-200">
                <Layers size={13} className="text-brand-light" /> 环境变量
              </span>
              {addingEnv ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={newEnvName}
                    onChange={(e) => setNewEnvName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmAddEnv();
                      if (e.key === 'Escape') {
                        setAddingEnv(false);
                        setNewEnvName('');
                      }
                    }}
                    placeholder="环境名称"
                    className="w-28 rounded-md border border-slate-700/50 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-200 outline-none transition focus:border-brand/60"
                  />
                  <button
                    onClick={confirmAddEnv}
                    className="rounded-md bg-brand/80 px-2 py-1 text-[11px] text-white transition hover:bg-brand cursor-pointer"
                  >
                    确定
                  </button>
                  <button
                    onClick={() => {
                      setAddingEnv(false);
                      setNewEnvName('');
                    }}
                    className="rounded-md bg-slate-700/50 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-700 cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={addEnv}
                  className="flex items-center gap-1 rounded-md bg-slate-700/50 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-700 cursor-pointer"
                >
                  <Plus size={12} /> 新增环境
                </button>
              )}
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {Object.keys(environments).map((name) => (
                <button
                  key={name}
                  onClick={() => onChange({ activeEnv: name })}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    name === activeEnv
                      ? 'bg-brand/25 text-brand-light'
                      : 'bg-slate-800/60 text-slate-400 hover:bg-slate-700/50'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
            <p className="mb-1.5 text-[11px] text-slate-500">
              当前环境「{activeEnv}」变量（KEY=VALUE，可在 URL/Header/Body 中用{' '}
              <code className="text-slate-300">{'{{key}}'}</code> 引用）：
            </p>
            <textarea
              value={envText}
              onChange={(e) => commitEnvText(e.target.value)}
              placeholder={'baseUrl=https://api.example.com\ntoken=xxx'}
              className="h-[88px] w-full resize-none rounded-lg border border-slate-700/50 bg-slate-800/40 p-2.5 font-mono text-[12px] text-slate-200 outline-none transition focus:border-brand/60"
            />
          </div>

          <div className="rounded-xl bg-slate-800/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-slate-200">
              <Sparkles size={13} className="text-brand-light" /> AI 预处理设置
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
              配置任意 OpenAI 兼容接口（OpenAI / DeepSeek / Kimi / 通义 / 智谱 / Ollama
              等），批量调用里即可用 AI 把原始数据预处理成请求参数。
            </p>
            <div className="space-y-2">
              <input
                value={aiBaseUrl}
                onChange={(e) => commitAi({ baseUrl: e.target.value })}
                placeholder="接口地址，如 https://api.openai.com/v1 或 http://127.0.0.1:11434/v1"
                className="w-full rounded-lg border border-slate-700/50 bg-slate-800/60 px-2.5 py-1.5 text-[12px] text-slate-200 outline-none transition focus:border-brand/60"
              />
              <div className="flex gap-2">
                <input
                  value={aiApiKey}
                  type="password"
                  onChange={(e) => commitAi({ apiKey: e.target.value })}
                  placeholder="API Key（本地服务可留空）"
                  className="min-w-0 flex-1 rounded-lg border border-slate-700/50 bg-slate-800/60 px-2.5 py-1.5 text-[12px] text-slate-200 outline-none transition focus:border-brand/60"
                />
                <input
                  value={aiModel}
                  onChange={(e) => commitAi({ model: e.target.value })}
                  placeholder="模型名，如 gpt-4o-mini / glm-4-flash"
                  className="w-[46%] shrink-0 rounded-lg border border-slate-700/50 bg-slate-800/60 px-2.5 py-1.5 text-[12px] text-slate-200 outline-none transition focus:border-brand/60"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-slate-800/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-slate-200">
              <FolderTree size={13} className="text-brand-light" /> 文件保存位置
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
              接口记录、定时任务与设置将保存在此目录。修改后需重启应用，现有数据会自动迁移到新位置。
            </p>
            <div className="mb-2 break-all rounded-lg border border-slate-700/50 bg-slate-800/60 p-2 text-[11px] text-slate-300">
              {dataDir || '（默认：应用数据目录）'}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={chooseDataDir}
                className="rounded-md bg-slate-700/50 px-2.5 py-1 text-[11px] text-slate-200 transition hover:bg-slate-700 cursor-pointer"
              >
                选择文件夹
              </button>
              <button
                onClick={resetDataDir}
                className="rounded-md bg-slate-700/50 px-2.5 py-1 text-[11px] text-slate-200 transition hover:bg-slate-700 cursor-pointer"
              >
                恢复默认
              </button>
              <button
                onClick={relaunchApp}
                className="rounded-md bg-brand/80 px-2.5 py-1 text-[11px] text-white transition hover:bg-brand cursor-pointer"
              >
                重启应用
              </button>
            </div>
            {dirMsg && (
              <p className="mt-2 text-[11px] text-amber-400/90">{dirMsg}</p>
            )}
          </div>

          <p className="rounded-lg bg-slate-800/30 p-2.5 text-[11px] leading-relaxed text-slate-500">
            规则同时作用于「代理」与「浏览器插件」两条抓取路径，支持{' '}
            <code className="text-slate-300">*.example.com</code>{' '}
            通配（匹配任意子域）及精确/子域匹配。修改即时生效。
          </p>
        </div>
      </div>
    </div>
  );
}
