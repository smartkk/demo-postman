import { useState, useCallback, useEffect } from 'react';
import { X, Play, Plus, Trash2, Layers, Save, FolderOpen, FolderPlus, Folder, ArrowUp, ArrowDown, GitBranch } from 'lucide-react';
import { api } from '../api/client';
import type {
  ChainProject,
  ChainRunResult,
  ChainStep,
} from '../../../shared/types';
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

interface Props {
  onClose: () => void;
}

const genStepId = () =>
  Math.random().toString(36).slice(2, 10);

const emptyStep = (): ChainStep => ({
  id: genStepId(),
  name: '',
  method: 'GET',
  url: '',
  headers: {},
  body: null,
  extract: {},
});

export function ChainPanel({ onClose }: Props) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [extract, setExtract] = useState<Record<string, string>>({});

  const [steps, setSteps] = useState<ChainStep[]>([emptyStep()]);
  const [activeStep, setActiveStep] = useState(0);

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ChainRunResult[] | null>(null);
  const [error, setError] = useState('');

  // ── 持久化 ──
  const [projects, setProjects] = useState<ChainProject[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('未命名链式任务');
  const [folder, setFolder] = useState('');

  const refreshList = useCallback(async () => {
    const [list, f] = await Promise.all([api.listChains(), api.listChainFolders()]);
    setProjects(list);
    setFolders(f);
  }, []);

  useEffect(() => {
    refreshList();
    const off = api.onChains((list, f) => {
      setProjects(list);
      setFolders(f);
    });
    return off;
  }, [refreshList]);

  /* ── 步骤编辑 ── */
  const updateStep = (idx: number, patch: Partial<ChainStep>) =>
    setSteps((ss) => ss.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const addStep = () => {
    setSteps((ss) => [...ss, emptyStep()]);
    setActiveStep(steps.length);
  };
  const removeStep = (idx: number) => {
    if (steps.length <= 1) return;
    setSteps((ss) => ss.filter((_, i) => i !== idx));
    setActiveStep((a) => Math.max(0, Math.min(a, steps.length - 2)));
  };
  const moveStep = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    setSteps((ss) => {
      const next = [...ss];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    setActiveStep(target);
  };

  const selectStep = (idx: number) => {
    setActiveStep(idx);
    const s = steps[idx];
    setMethod(s.method);
    setUrl(s.url);
    setHeaders(s.headers || {});
    setBody(s.body ?? '');
    setExtract(s.extract || {});
  };

  // 当编辑区改动，同步回当前激活步骤
  useEffect(() => {
    if (steps[activeStep]) {
      updateStep(activeStep, { method, url, headers, body: body.trim() ? body : null, extract });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [method, url, headers, body, extract]);

  const buildProject = (): Omit<ChainProject, 'id' | 'createdAt' | 'updatedAt'> => ({
    name: projectName.trim() || '未命名链式任务',
    steps: steps.map((s) => ({
      ...s,
      name: s.name.trim() || s.id,
      extract: s.extract || {},
    })),
    folder,
  });

  const doSave = async () => {
    if (!steps.some((s) => s.url.trim())) {
      setError('请至少为一个步骤填写请求地址');
      return;
    }
    try {
      const saved = await api.saveChain({
        ...buildProject(),
        id: activeId ?? '',
        createdAt: '',
        updatedAt: '',
      } as ChainProject);
      setActiveId(saved.id);
      setError('');
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  };

  const loadProject = (p: ChainProject) => {
    setActiveId(p.id);
    setProjectName(p.name);
    setFolder(p.folder || '');
    setSteps(p.steps?.length ? p.steps.map((s) => ({ ...emptyStep(), ...s })) : [emptyStep()]);
    setActiveStep(0);
    setResults(p.results ?? null);
    setError('');
    const first = p.steps?.[0];
    if (first) {
      setMethod(first.method);
      setUrl(first.url);
      setHeaders(first.headers || {});
      setBody(first.body ?? '');
      setExtract(first.extract || {});
    }
  };

  const run = async (useSaved: boolean) => {
    if (useSaved && activeId) {
      setRunning(true);
      setError('');
      try {
        const res = await api.runChain(activeId);
        setResults(res);
        await refreshList();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
      return;
    }
    if (!steps.some((s) => s.url.trim())) {
      setError('请至少为一个步骤填写请求地址');
      return;
    }
    setError('');
    setRunning(true);
    setResults(null);
    try {
      // 先保存再运行，确保 steps 已落盘（runChain 读取持久化数据）
      const saved = await api.saveChain({
        ...buildProject(),
        id: activeId ?? '',
        createdAt: '',
        updatedAt: '',
      } as ChainProject);
      setActiveId(saved.id);
      const res = await api.runChain(saved.id);
      setResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const newProject = () => {
    setActiveId(null);
    setProjectName('未命名链式任务');
    setFolder('');
    setSteps([emptyStep()]);
    setActiveStep(0);
    setMethod('GET');
    setUrl('');
    setHeaders({});
    setBody('');
    setExtract({});
    setResults(null);
    setError('');
  };

  const deleteProject = async (id: string) => {
    await api.deleteChain(id);
    if (activeId === id) newProject();
    await refreshList();
  };

  const [newFolderName, setNewFolderName] = useState('');
  const addFolder = async () => {
    const n = newFolderName.trim();
    if (!n) return;
    await api.createChainFolder(n);
    setFolder(n);
    setNewFolderName('');
    await refreshList();
  };

  const statusBadge = (r: ChainRunResult) => {
    if (r.error) return { text: '错误', cls: 'bg-red-500/20 text-red-400' };
    if (r.status >= 200 && r.status < 400)
      return { text: `${r.status}`, cls: 'bg-emerald-500/20 text-emerald-400' };
    if (r.status >= 400)
      return { text: `${r.status}`, cls: 'bg-yellow-500/20 text-yellow-400' };
    return { text: `${r.status}`, cls: 'bg-slate-700 text-slate-400' };
  };

  const cur = steps[activeStep];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass flex max-h-[90vh] w-[1100px] max-w-[96vw] overflow-hidden rounded-2xl border border-slate-700/50 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧：已保存任务（按文件夹分组） */}
        <div className="flex w-[260px] shrink-0 flex-col border-r border-slate-700/50 bg-slate-900/40">
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-200">
              <GitBranch size={14} className="text-brand-light" /> 链式任务
            </span>
            <button
              onClick={newProject}
              title="新建空白任务"
              className="rounded-md bg-brand/20 px-1.5 py-0.5 text-[11px] text-brand-light transition hover:bg-brand/30 cursor-pointer"
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="px-3 pb-2">
            <div className="flex gap-1">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="新文件夹名"
                className="min-w-0 flex-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-2 py-1 text-[11px] outline-none focus:border-brand/60"
              />
              <button
                onClick={addFolder}
                title="新建文件夹"
                className="rounded-md bg-slate-700/50 px-1.5 py-1 text-slate-300 transition hover:bg-slate-700 cursor-pointer"
              >
                <FolderPlus size={13} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {projects.length === 0 && (
              <div className="px-2 py-6 text-center text-[11.5px] text-slate-500">
                暂无保存的任务
                <br /> 编辑后点「保存」即可持久化
              </div>
            )}
            {folders.map((f) => {
              const items = projects.filter((p) => p.folder === f);
              if (items.length === 0) return null;
              return (
                <div key={f} className="mb-1.5">
                  <div className="flex items-center gap-1 px-1 py-1 text-[10.5px] uppercase tracking-wide text-slate-500">
                    <Folder size={11} /> {f}
                  </div>
                  {items.map((p) => (
                    <ChainItem
                      key={p.id}
                      p={p}
                      active={p.id === activeId}
                      onOpen={() => loadProject(p)}
                      onDelete={() => deleteProject(p.id)}
                    />
                  ))}
                </div>
              );
            })}
            {projects
              .filter((p) => !p.folder)
              .map((p) => (
                <ChainItem
                  key={p.id}
                  p={p}
                  active={p.id === activeId}
                  onOpen={() => loadProject(p)}
                  onDelete={() => deleteProject(p.id)}
                />
              ))}
          </div>
        </div>

        {/* 右侧：步骤编辑 + 运行 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-[55%] rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold text-slate-100 outline-none hover:border-slate-700/50 focus:border-brand/60"
            />
            <div className="flex items-center gap-2">
              <select
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                className="rounded-md border border-slate-700/50 bg-slate-800/40 px-2 py-1.5 text-[12px] outline-none focus:border-brand/60"
              >
                <option value="">未分组</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <button
                onClick={doSave}
                className="flex items-center gap-1 rounded-lg bg-brand/25 px-3 py-1.5 text-[12.5px] font-medium text-brand-light transition hover:bg-brand/35 cursor-pointer"
              >
                <Save size={14} /> 保存
              </button>
              <button
                onClick={onClose}
                className="cursor-pointer rounded-md p-1 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <p className="mb-4 text-[12px] leading-relaxed text-slate-400">
            把多个接口按顺序串成一个工作流。每一步可从响应中
            <code className="text-brand-light">{'{提取}'}</code> 字段，供后续步骤以{' '}
            <code className="text-brand-light">{'{{步骤名.字段名}}'}</code>{' '}
            引用（例如 <code className="text-brand-light">{'{{login.token}}'}</code>）。
            也可使用动态变量 <code className="text-brand-light">{'{{$timestamp}}'}</code> 等。任一步失败即中断后续。
          </p>

          {/* 步骤列表（顺序 + 上下移） */}
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[12px] font-medium text-slate-400">步骤（按顺序排列 = 调用顺序）</span>
            <button
              onClick={addStep}
              className="flex items-center gap-1 rounded-md bg-brand/20 px-2 py-0.5 text-[11px] text-brand-light transition hover:bg-brand/30 cursor-pointer"
            >
              <Plus size={12} /> 步骤
            </button>
          </div>
          <div className="space-y-1.5">
            {steps.map((s, i) => (
              <div
                key={s.id}
                className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 transition cursor-pointer ${
                  i === activeStep
                    ? 'border-brand/50 bg-brand/10'
                    : 'border-slate-700/40 bg-slate-800/30 hover:bg-slate-700/30'
                }`}
                onClick={() => selectStep(i)}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-700/60 text-[10px] text-slate-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-slate-200">
                    {s.name?.trim() || s.id}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-slate-500">
                    {s.method} {s.url || '（未填写地址）'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); moveStep(i, -1); }}
                    disabled={i === 0}
                    title="上移"
                    className="rounded p-1 text-slate-400 transition hover:bg-slate-700/60 hover:text-slate-100 disabled:opacity-25 cursor-pointer"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveStep(i, 1); }}
                    disabled={i === steps.length - 1}
                    title="下移"
                    className="rounded p-1 text-slate-400 transition hover:bg-slate-700/60 hover:text-slate-100 disabled:opacity-25 cursor-pointer"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeStep(i); }}
                    disabled={steps.length <= 1}
                    title="删除步骤"
                    className="rounded p-1 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-400 disabled:opacity-25 cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 当前步骤编辑 */}
          {cur && (
            <div className="mt-4 space-y-3 rounded-xl bg-slate-800/30 p-3">
              <div className="flex gap-2">
                <input
                  value={cur.name}
                  onChange={(e) => updateStep(activeStep, { name: e.target.value })}
                  placeholder="步骤名（引用键，如 login）"
                  className="w-[200px] rounded-md border border-slate-700/50 bg-slate-800/40 px-2.5 py-2 text-[12px] outline-none focus:border-brand/60"
                />
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="rounded-md border border-slate-700/50 bg-slate-800/40 px-2.5 py-2 text-[13px] outline-none focus:border-brand/60"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.example.com/login"
                  className="min-w-0 flex-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-brand/60"
                />
              </div>
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-slate-400">
                  Headers（值可含 {'{{步骤名.字段}}'} / {'{{$var}}'}）
                </div>
                <KVEditorInline value={headers} onChange={setHeaders} />
              </div>
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-slate-400">Body（可含占位符）</div>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  placeholder={'{\n  "user": "{{$uuid}}"\n}'}
                  className="w-full resize-none rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-brand/60"
                />
              </div>
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-slate-400">
                  从响应提取（输出变量 → JSON 路径，如 <code className="text-brand-light">token</code> →{' '}
                  <code className="text-brand-light">data.token</code>）
                </div>
                <ExtractEditor value={extract} onChange={setExtract} stepName={cur.name} />
              </div>
            </div>
          )}

          {error && <div className="mt-3 text-[12px] text-rose-400">{error}</div>}

          {/* 执行 */}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => run(false)}
              disabled={running}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand to-brand-light px-4 py-2 text-[13px] font-medium text-white shadow-lg shadow-brand/30 transition hover:brightness-110 disabled:opacity-50 cursor-pointer"
            >
              <Play size={14} /> {running ? '执行中…' : `运行（${steps.length} 步）`}
            </button>
            {activeId && (
              <button
                onClick={() => run(true)}
                disabled={running}
                title="使用已保存的配置运行"
                className="flex items-center gap-1.5 rounded-lg border border-brand/40 px-4 py-2 text-[13px] font-medium text-brand-light transition hover:bg-brand/10 disabled:opacity-50 cursor-pointer"
              >
                <FolderOpen size={14} /> 运行已保存
              </button>
            )}
          </div>

          {/* 结果 */}
          {results && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-slate-400">
                执行结果（{results.length}/{steps.length} 步，
                {results.filter((r) => !r.error && r.status >= 200 && r.status < 400).length} 成功 /
                {results.filter((r) => r.error || r.status >= 400).length} 失败）
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-700/40">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="border-b border-slate-700/50 text-slate-400">
                      <th className="px-2 py-1.5 text-left font-medium">#</th>
                      <th className="px-2 py-1.5 text-left font-medium">步骤</th>
                      <th className="px-2 py-1.5 text-left font-medium">状态</th>
                      <th className="px-2 py-1.5 text-right font-medium">耗时</th>
                      <th className="px-2 py-1.5 text-left font-medium">提取</th>
                      <th className="px-2 py-1.5 text-left font-medium">响应</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => {
                      const b = statusBadge(r);
                      return (
                        <tr
                          key={r.stepId + '-' + r.index}
                          className="border-b border-slate-800/60 text-slate-300 transition hover:bg-slate-700/20"
                        >
                          <td className="px-2 py-1.5 text-slate-400">{r.index + 1}</td>
                          <td className="px-2 py-1.5 text-slate-300">{r.name || r.stepId}</td>
                          <td className="px-2 py-1.5">
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${b.cls}`}>
                              {b.text}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-400">{r.durationMs}ms</td>
                          <td className="max-w-[160px] truncate px-2 py-1.5 text-slate-400">
                            {Object.entries(r.extracted).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}
                          </td>
                          <td className="max-w-[200px] truncate px-2 py-1.5 text-slate-400">
                            {r.error ?? r.body?.slice(0, 120) ?? '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChainItem({
  p,
  active,
  onOpen,
  onDelete,
}: {
  p: ChainProject;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] transition cursor-pointer ${
        active ? 'bg-brand/20 text-brand-light' : 'text-slate-300 hover:bg-slate-700/40'
      }`}
      onClick={onOpen}
    >
      <span className="min-w-0 flex-1 truncate">{p.name || '未命名'}</span>
      <span className="shrink-0 text-[10px] text-slate-500">
        {p.steps?.length ?? 0} 步
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="删除"
        className="shrink-0 text-slate-500 opacity-0 transition hover:text-rose-400 group-hover:opacity-100 cursor-pointer"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function ExtractEditor({
  value,
  onChange,
  stepName,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  stepName: string;
}) {
  const entries = Object.entries(value);
  const setAt = (i: number, outKey: string, jsonPath: string) => {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], idx) => {
      if (idx === i) next[outKey] = jsonPath;
      else next[k] = v;
    });
    onChange(next);
  };
  const add = () => onChange({ ...value, '': '' });
  const remove = (k: string) => {
    const next = { ...value };
    delete next[k];
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={k}
            onChange={(e) => setAt(i, e.target.value, v)}
            placeholder="输出变量名"
            className="w-[35%] rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand/60"
          />
          <span className="text-slate-500">→</span>
          <input
            value={v}
            onChange={(e) => setAt(i, k, e.target.value)}
            placeholder="JSON 路径，如 data.token"
            className="flex-1 rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand/60"
          />
          <button
            onClick={() => remove(k)}
            className="text-slate-500 transition hover:text-rose-400 cursor-pointer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="text-[10.5px] text-slate-500">
        提取后在后续步骤用{' '}
        <code className="text-brand-light">
          {'{{' + (stepName?.trim() || '本步骤名') + '.变量名}}'}
        </code>{' '}
        引用
      </div>
      <button
        onClick={add}
        className="flex items-center gap-1 text-[11px] text-slate-400 transition hover:text-slate-200 cursor-pointer"
      >
        <Plus size={12} /> 添加提取
      </button>
    </div>
  );
}

function KVEditorInline({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const entries = Object.entries(value);
  const setAt = (i: number, k: string, v: string) => {
    const next: Record<string, string> = {};
    entries.forEach(([ek, ev], idx) => {
      if (idx === i) next[k] = v;
      else next[ek] = ev;
    });
    onChange(next);
  };
  const setVal = (i: number, v: string) => {
    const next: Record<string, string> = {};
    entries.forEach(([ek, ev], idx) => (next[ek] = idx === i ? v : ev));
    onChange(next);
  };
  const add = () => onChange({ ...value, '': '' });
  const remove = (k: string) => {
    const next = { ...value };
    delete next[k];
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <input
            value={k}
            onChange={(e) => setAt(i, e.target.value, v)}
            placeholder="Header"
            className="w-1/3 rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand/60"
          />
          <input
            value={v}
            onChange={(e) => setVal(i, e.target.value)}
            placeholder="值（可含 {{var}}）"
            className="flex-1 rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand/60"
          />
          <button
            onClick={() => remove(k)}
            className="text-slate-500 transition hover:text-rose-400 cursor-pointer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1 text-[11px] text-slate-400 transition hover:text-slate-200 cursor-pointer"
      >
        <Plus size={12} /> 添加 Header
      </button>
    </div>
  );
}
