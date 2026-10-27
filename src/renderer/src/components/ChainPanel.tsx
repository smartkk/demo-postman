import { useState, useCallback, useEffect } from 'react';
import { useFolderCrud } from '../hooks/useFolderCrud';
import { X, Play, Plus, Trash2, Save, FolderOpen, ArrowUp, ArrowDown, Download, Search } from 'lucide-react';
import { api } from '../api/client';
import { Select } from './ui/Select';
import { KVEditorInline } from './KVEditorInline';
import { ExtractEditor } from './ExtractEditor';
import { ChainResultSection } from './ChainResultSection';
import type {
  ChainProject,
  ChainRunResult,
  ChainStep,
  InterfaceSummary,
} from '../../../shared/types';
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

interface Props {
  activeId: string | null;
  onSelect: (id: string | null) => void;
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

export function ChainPanel({ activeId, onSelect, onClose }: Props) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [extract, setExtract] = useState<Record<string, string>>({});

  const [steps, setSteps] = useState<ChainStep[]>([emptyStep()]);
  const [activeStep, setActiveStep] = useState(0);

  // 本地已记录的接口，供「引入到链式步骤」
  const [localRecords, setLocalRecords] = useState<InterfaceSummary[]>([]);
  const [showLocal, setShowLocal] = useState(false);
  const [localKw, setLocalKw] = useState('');

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ChainRunResult[] | null>(null);
  const [error, setError] = useState('');
  const [viewResult, setViewResult] = useState<ChainRunResult | null>(null);

  // ── 持久化：文件夹分组 ──
  const { folders, setFolders } = useFolderCrud({
    listFolders: api.listChainFolders,
    createFolder: api.createChainFolder,
  });
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('未命名链式任务');
  const [folder, setFolder] = useState('');

  const refreshList = useCallback(async () => {
    const f = await api.listChainFolders();
    setFolders(f);
    // setFolders 来自 useState，引用稳定，无需作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshList();
    const off = api.onChains((_list, f) => {
      setFolders(f);
    });
    return off;
    // setFolders 引用稳定；refreshList 已覆盖文件夹刷新路径
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshList]);

  // 根据左侧栏选中的任务加载编辑区
  useEffect(() => {
    let cancelled = false;
    if (activeId) {
      api.listChains().then((list) => {
        if (cancelled) return;
        const p = list.find((x) => x.id === activeId);
        if (p) loadProject(p);
      });
    } else {
      newProject();
    }
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // 加载本地已记录的接口列表
  useEffect(() => {
    api.getList().then(setLocalRecords).catch(() => setLocalRecords([]));
  }, []);

  /* ── 步骤编辑 ── */
  const updateStep = (idx: number, patch: Partial<ChainStep>) =>
    setSteps((ss) => ss.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const addStep = (preset?: Partial<ChainStep>) => {
    const s = { ...emptyStep(), ...preset };
    setSteps((ss) => [...ss, s]);
    setActiveStep(steps.length);
  };

  // 将本地记录的接口引入为新的链式步骤（自动重建完整 URL，含 query）
  const importFromLocal = (rec: InterfaceSummary) => {
    const qs = Object.entries(rec.query || {})
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const fullUrl = qs ? `${rec.url}?${qs}` : rec.url;
    const preset: Partial<ChainStep> = {
      name: (rec.name || rec.path || rec.url).slice(0, 24),
      method: (rec.method || 'GET') as ChainStep['method'],
      url: fullUrl,
      headers: { ...(rec.headers || {}) },
      body: rec.body ?? null,
    };
    addStep(preset);
    setShowLocal(false);
    setLocalKw('');
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
  // 故意只依赖编辑区字段：activeStep/steps 变化本身就会走 selectStep 的加载逻辑，
  // 若纳入依赖，切换步骤时会把上一步的编辑内容回写到新选中的步骤上。
  useEffect(() => {
    if (steps[activeStep]) {
      updateStep(activeStep, { method, url, headers, body: body.trim() ? body : null, extract });
    }
    // 见上方注释：activeStep/steps 刻意不入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, url, headers, body, extract]);

  const buildProject = (): Omit<ChainProject, 'id' | 'createdAt' | 'updatedAt'> => ({
    name: projectName.trim() || '未命名链式任务',
    steps: steps.map((s, i) => ({
      ...s,
      // 空名步骤自动填充 step1/step2…，便于用 {{step1.字段}} 手动引用
      name: s.name.trim() || `step${i + 1}`,
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
        id: loadedId ?? '',
        createdAt: '',
        updatedAt: '',
      } as ChainProject);
      setLoadedId(saved.id);
      setError('');
      onSelect(saved.id);
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  };

  const loadProject = (p: ChainProject) => {
    setLoadedId(p.id);
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
    if (useSaved && loadedId) {
      setRunning(true);
      setError('');
      try {
        const res = await api.runChain(loadedId);
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
    // 步骤名称是变量引用键（{{步骤名.字段}}），重名会导致提取结果互相覆盖
    const names = steps
      .map((s) => (s.name.trim() || s.id))
      .filter(Boolean);
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) dups.add(n);
      seen.add(n);
    }
    if (dups.size > 0) {
      setError(
        `步骤名称重复：${[...dups].join('、')}。后续步骤用 {{名称.字段}} 引用时会互相覆盖，请先重命名。`
      );
      return;
    }
    setError('');
    setRunning(true);
    setResults(null);
    try {
      // 先保存再运行，确保 steps 已落盘（runChain 读取持久化数据）
      const saved = await api.saveChain({
        ...buildProject(),
        id: loadedId ?? '',
        createdAt: '',
        updatedAt: '',
      } as ChainProject);
      setLoadedId(saved.id);
      onSelect(saved.id);
      const res = await api.runChain(saved.id);
      setResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const newProject = () => {
    setLoadedId(null);
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

  const cur = steps[activeStep];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col" data-select-scope>
      {/* 编辑区 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-[55%] rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold text-slate-100 outline-none hover:border-slate-700/50 focus:border-brand/60"
            />
            <div className="flex items-center gap-2">
              <Select
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                wrapperClassName="relative shrink-0"
                className="py-1.5 text-[12px]"
              >
                <option value="">未分组</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
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
          <div className="relative mb-4 flex items-center justify-between">
            <span className="text-[12px] font-medium text-slate-400">步骤（按顺序排列 = 调用顺序）</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowLocal((v) => !v)}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition cursor-pointer ${
                  showLocal
                    ? 'bg-brand/30 text-brand-light'
                    : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700/60'
                }`}
              >
                <Download size={12} /> 引入本地请求
              </button>
              <button
                onClick={() => addStep()}
                className="flex items-center gap-1 rounded-md bg-brand/20 px-2 py-0.5 text-[11px] text-brand-light transition hover:bg-brand/30 cursor-pointer"
              >
                <Plus size={12} /> 步骤
              </button>
            </div>

            {/* 本地请求选择浮层 */}
            {showLocal && (
              <div className="absolute right-0 top-9 z-20 max-h-[300px] w-[360px] overflow-hidden rounded-xl border border-slate-700/50 bg-slate-900/95 shadow-2xl backdrop-blur">
                <div className="flex items-center gap-2 border-b border-slate-700/50 px-2.5 py-2">
                  <Search size={13} className="shrink-0 text-slate-500" />
                  <input
                    value={localKw}
                    onChange={(e) => setLocalKw(e.target.value)}
                    placeholder="搜索本地接口（名称/URL/方法）"
                    className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
                  />
                  <button
                    onClick={() => setShowLocal(false)}
                    className="rounded p-0.5 text-slate-500 transition hover:text-slate-200 cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="max-h-[250px] overflow-y-auto">
                  {localRecords.length === 0 && (
                    <div className="px-3 py-6 text-center text-[11.5px] text-slate-500">
                      暂无本地接口记录
                    </div>
                  )}
                  {localRecords
                    .filter((r) => {
                      const kw = localKw.trim().toLowerCase();
                      if (!kw) return true;
                      return [r.method, r.url, r.name || '', r.path || '']
                        .join(' ')
                        .toLowerCase()
                        .includes(kw);
                    })
                    .map((r) => (
                      <button
                        key={r.id}
                        onClick={() => importFromLocal(r)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-700/40 cursor-pointer"
                      >
                        <span className="shrink-0 rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-brand-light">
                          {r.method}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-200">
                          {r.name || r.path || r.url}
                        </span>
                        <Download size={12} className="shrink-0 text-slate-500" />
                      </button>
                    ))}
                </div>
              </div>
            )}
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
                <Select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  wrapperClassName="relative shrink-0"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
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
                  <code className="text-brand-light">data.token</code>，或数组项{' '}
                  <code className="text-brand-light">firstId</code> →{' '}
                  <code className="text-brand-light">page.data.records[0].id</code>）
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
            {loadedId && (
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
            <ChainResultSection
              results={results}
              totalSteps={steps.length}
              viewResult={viewResult}
              onViewResult={setViewResult}
            />
          )}
          </div>
      </div>
  );
}
