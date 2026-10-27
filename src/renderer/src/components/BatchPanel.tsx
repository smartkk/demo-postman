import { useState, useCallback, useRef, useEffect, memo, useMemo } from 'react';
import { useFolderCrud } from '../hooks/useFolderCrud';
import {
  X,
  Play,
  Plus,
  Trash2,
  FileJson,
  Upload,
  Save,
  FolderOpen,
  Sparkles,
  Search,
  Download,
  ChevronDown,
  ChevronRight,
  Pause,
  FileText,
} from 'lucide-react';
import { api } from '../api/client';
import { Select } from './ui/Select';
import { showToast } from './ui/Toast';
import { filesToRows } from '../../../shared/params';
import { BatchResultSection } from './BatchResultSection';
import { AiPreprocessDialog } from './AiPreprocessDialog';
import type {
  BatchCallResult,
  BatchProject,
  BatchRow,
  BatchProgressState,
  InterfaceSummary,
} from '../../../shared/types';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

interface Props {
  selectedId: string | null;
  onClose: () => void;
}

export function BatchPanel({ selectedId, onClose }: Props) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('https://api.example.com/users/{{id}}');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [variables, setVariables] = useState<string[]>(['id']);
  const [rows, setRows] = useState<BatchRow[]>([{ id: '1' }, { id: '2' }]);
  // 参数文件夹（与 rows 二选一，绑定后执行时实时读取文件夹下的文件）
  const [paramFolder, setParamFolder] = useState('');
  const [folderInfo, setFolderInfo] = useState<{
    count: number;
    variables: string[];
    skipped: string[];
  } | null>(null);
  const [sequential, setSequential] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchCallResult[] | null>(null);
  const [error, setError] = useState('');

  // 已记录的接口（历史接口）：可导入为基础请求，导入后仍可继续手动修改
  const [localRecords, setLocalRecords] = useState<InterfaceSummary[]>([]);
  const [showLocal, setShowLocal] = useState(false);
  const [localKw, setLocalKw] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);

  // 参数行区：折叠 + 关键字搜索
  const [rowsCollapsed, setRowsCollapsed] = useState(false);
  const [rowKw, setRowKw] = useState('');

  // 执行进度与暂停：结果流式返回，暂停可中断后续请求
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stopped, setStopped] = useState(false);
  /** 每轮运行自增：驱动结果区在新一轮执行时自动展开（见 BatchResultSection） */
  const [runSeq, setRunSeq] = useState(0);
  const runIdRef = useRef('');

  // 断点续跑：记录本轮已完成的原始行号（参数行内容变化则失效）
  const doneIdxRef = useRef<Set<number>>(new Set());
  const rowsSigRef = useRef('');
  /** 结果镜像：用于结束时把断点进度落盘（setState 是异步的） */
  const resultsRef = useRef<BatchCallResult[] | null>(results);
  const [resumeInfo, setResumeInfo] = useState<{ done: number; total: number } | null>(
    null
  );

  // ── 持久化：文件夹分组 ──
  const { folders, setFolders } = useFolderCrud({
    listFolders: api.listBatchFolders,
    createFolder: api.createBatchFolder,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('未命名批量任务');
  const [folder, setFolder] = useState('');

  const refreshList = useCallback(async () => {
    const f = await api.listBatchFolders();
    setFolders(f);
    // setFolders 来自 useState，引用稳定，无需作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshList();
    const off = api.onBatches((_list, f) => {
      setFolders(f);
    });
    return off;
    // setFolders 引用稳定；refreshList 已覆盖文件夹刷新路径
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshList]);

  // 加载已记录的接口，供「选择历史接口」
  useEffect(() => {
    api.getList().then(setLocalRecords).catch(() => setLocalRecords([]));
  }, []);

  // 根据左侧栏选中的项目加载编辑区
  useEffect(() => {
    let cancelled = false;
    if (selectedId) {
      api.listBatches().then((list) => {
        if (cancelled) return;
        const p = list.find((x) => x.id === selectedId);
        if (p) loadProject(p);
      });
    } else {
      newProject();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /* ── 变量名编辑 ── */
  const setVariableAt = (idx: number, val: string) => {
    const next = [...variables];
    next[idx] = val;
    setRows((rs) =>
      rs.map((r) => {
        const nr: BatchRow = {};
        variables.forEach((oldK, i) => {
          nr[next[i]] = r[oldK];
        });
        return nr;
      })
    );
    setVariables(next);
  };
  const addVariable = () => setVariables((v) => [...v, `var${v.length + 1}`]);
  const removeVariable = (idx: number) => {
    if (variables.length <= 1) return;
    const next = variables.filter((_, i) => i !== idx);
    setRows((rs) =>
      rs.map((r) => {
        const nr: BatchRow = {};
        variables.forEach((k, i) => {
          if (i !== idx) nr[k] = r[k];
        });
        return nr;
      })
    );
    setVariables(next);
  };

  /* ── 行编辑（用 useCallback 固定引用，避免破坏下游 memo） ── */
  const setCell = useCallback(
    (rowIdx: number, key: string, val: string) =>
      setRows((rs) => rs.map((r, i) => (i === rowIdx ? { ...r, [key]: val } : r))),
    []
  );
  const addRow = useCallback(() => setRows((rs) => [...rs, {}]), []);
  const removeRow = useCallback(
    (idx: number) => setRows((rs) => rs.filter((_, i) => i !== idx)),
    []
  );

  /* ── 从 CSV/JSON 导入行 ── */
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const parseCsv = (text: string): { headers: string[]; rows: BatchRow[] } => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };
    const splitCsvLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
          if (c === '"') {
            if (line[i + 1] === '"') {
              cur += '"';
              i++;
            } else inQ = false;
          } else cur += c;
        } else {
          if (c === '"') inQ = true;
          else if (c === ',') {
            out.push(cur);
            cur = '';
          } else cur += c;
        }
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const headers = splitCsvLine(lines[0]).filter((h) => h !== '');
    const rows: BatchRow[] = lines.slice(1).map((l) => {
      const cells = splitCsvLine(l);
      const r: BatchRow = {};
      headers.forEach((h, i) => (r[h] = cells[i] ?? ''));
      return r;
    });
    return { headers, rows };
  };

  const applyCsv = (text: string) => {
    const { headers, rows: parsed } = parseCsv(text);
    if (headers.length === 0) return;
    setVariables(headers);
    setRows(parsed);
    setShowImport(false);
    setImportText('');
  };

  const applyImport = () => {
    const text = importText.trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('JSON 需为对象数组');
      const keys = new Set<string>();
      parsed.forEach((o) => Object.keys(o).forEach((k) => keys.add(k)));
      setVariables([...keys]);
      setRows(parsed as BatchRow[]);
      setShowImport(false);
      setImportText('');
    } catch {
      applyCsv(text);
    }
  };

  const clearFile = () => {
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      applyCsv(String(reader.result ?? ''));
      // 清空 input 值，使重复上传同一文件也能再次触发 onChange
      e.target.value = '';
    };
    reader.onerror = () => setError('文件读取失败');
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  /* ── 从文件夹导入参数：按文件名顺序，每个文件生成一行（JSON 数组文件展开为多行） ── */
  const applyRows = (newRows: BatchRow[], prefix: string) => {
    if (!newRows.length) {
      showToast('没有解析出参数行', 'error');
      return;
    }
    const keys = new Set<string>();
    newRows.forEach((o) => Object.keys(o).forEach((k) => keys.add(k)));
    setVariables([...keys]);
    setRows(newRows);
    showToast(
      `${prefix}共生成 ${newRows.length} 行参数（自动附带 fileName / fileContent 变量，可在模板中引用）`,
      'success'
    );
  };

  /* ── 参数文件夹：绑定后执行时按文件名顺序实时读取，每个文件一行依次发送 ── */
  const loadFolderInfo = async (dir: string) => {
    const { files, skipped } = await api.readFolderFiles(dir);
    const parsed = filesToRows(files);
    const keys = new Set<string>();
    parsed.forEach((o) => Object.keys(o).forEach((k) => keys.add(k)));
    const info = { count: files.length, variables: [...keys], skipped };
    setFolderInfo(info);
    setVariables([...keys]);
    return info;
  };

  const bindFolder = async (dir?: string) => {
    try {
      const target = dir ?? (await api.pickFolder());
      if (!target) return;
      const info = await loadFolderInfo(target);
      if (!info.count) {
        showToast('文件夹中没有可读取的文本文件', 'error');
        return;
      }
      setParamFolder(target);
      showToast(
        `已绑定参数文件夹（${info.count} 个文件），执行时将按文件名顺序依次发送`,
        'success'
      );
    } catch (e) {
      showToast('读取文件夹失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };

  const unbindFolder = () => {
    setParamFolder('');
    setFolderInfo(null);
  };

  /* ── AI 预处理：弹窗与交互在 AiPreprocessDialog，这里只保留落地动作 ── */
  const [showAi, setShowAi] = useState(false);

  /** 填充到参数行：手动行模式下解除文件夹绑定，避免执行时仍走旧文件夹。 */
  const applyAiRows = (parsed: BatchRow[]) => {
    unbindFolder();
    applyRows(parsed, 'AI 预处理完成，');
  };

  /** 默认路径：AI 结果写入参数文件夹（每行一个文件）并绑定，执行时实时读取发送。 */
  const writeAiRowsToFolder = async (parsed: BatchRow[]) => {
    const { folder, count } = await api.writeParamFolder(parsed);
    await loadFolderInfo(folder);
    setParamFolder(folder);
    showToast(
      `AI 结果已写入参数文件夹（${count} 个文件）并绑定，执行时按顺序依次读取发送`,
      'success'
    );
  };

  /* ── 历史接口：导入为基础请求 ── */
  /** 把历史接口还原成完整 URL（base url + query）。 */
  const fullUrlOf = (rec: InterfaceSummary) => {
    const qs = Object.entries(rec.query || {})
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return qs ? `${rec.url}?${qs}` : rec.url;
  };

  /** 选中历史接口：填充 method/url/headers/body，之后仍可手动改成自定义请求。 */
  const importFromLocal = (rec: InterfaceSummary) => {
    setMethod((rec.method || 'GET').toUpperCase());
    setUrl(fullUrlOf(rec));
    setHeaders({ ...(rec.headers || {}) });
    setBody(rec.body ?? '');
    setSourceId(rec.id);
    setShowLocal(false);
    setLocalKw('');
    setError('');
  };

  /** 转为自定义请求：仅解绑来源，保留当前已填内容以便继续编辑。 */
  const detachSource = () => setSourceId(null);

  /* ── 保存当前配置为项目 ── */
  const buildProject = (): Omit<BatchProject, 'id' | 'createdAt' | 'updatedAt'> => ({
    name: projectName.trim() || '未命名批量任务',
    method,
    url,
    headers,
    body: body.trim() ? body : null,
    variables,
    rows,
    sequential,
    folder,
    ...(paramFolder ? { paramFolder } : {}),
    sourceInterfaceId: sourceId ?? undefined,
  });

  const doSave = async () => {
    if (!url.trim()) {
      setError('请填写请求地址后再保存');
      return;
    }
    try {
      const saved = await api.saveBatch({
        ...buildProject(),
        id: activeId ?? '',
        createdAt: '',
        updatedAt: '',
      } as BatchProject);
      setActiveId(saved.id);
      setError('');
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  };

  /* ── 从已保存项目加载到编辑区 ── */
  const loadProject = (p: BatchProject) => {
    setActiveId(p.id);
    setProjectName(p.name);
    setMethod(p.method);
    setUrl(p.url);
    setHeaders(p.headers || {});
    setBody(p.body ?? '');
    setVariables(p.variables || []);
    setRows(p.rows || []);
    setSequential(p.sequential);
    setFolder(p.folder || '');
    setSourceId(p.sourceInterfaceId ?? null);
    setError('');
    setFileName('');
    setStopped(false);
    setProgress(null);

    // 绑定参数文件夹的项目：恢复绑定并刷新预览
    if (p.paramFolder) {
      setParamFolder(p.paramFolder);
      loadFolderInfo(p.paramFolder).catch(() => setFolderInfo(null));
    } else {
      setParamFolder('');
      setFolderInfo(null);
    }

    // 断点续跑：签名一致才恢复，否则视为失效并清理掉持久化的断点
    const sig = JSON.stringify(p.rows || []);
    const total = p.rows?.length ?? 0;
    const prog = p.progress;
    const valid =
      !!prog && prog.rowsSignature === sig && (prog.doneIndexes?.length ?? 0) < total;
    if (valid && prog) {
      doneIdxRef.current = new Set(prog.doneIndexes);
      rowsSigRef.current = sig;
      setResumeInfo({ done: prog.doneIndexes.length, total });
      setResults(prog.results ?? p.results ?? null);
      resultsRef.current = prog.results ?? null;
    } else {
      doneIdxRef.current = new Set();
      rowsSigRef.current = sig;
      setResumeInfo(null);
      setResults(p.results ?? null);
      resultsRef.current = p.results ?? null;
      if (prog) api.saveBatchProgress(p.id, null).catch(() => {});
    }
  };

  /* ── 运行：当前编辑区 / 已保存项目（结果流式返回 + 可暂停 + 可断点续跑） ── */
  const run = async (mode: 'run' | 'saved' | 'resume') => {
    const useSaved = mode === 'saved';
    if (mode === 'run') {
      if (!url.trim()) {
        setError('请填写请求地址');
        return;
      }
      if (!paramFolder && rows.length === 0) {
        setError('请至少添加一行参数，或绑定一个参数文件夹');
        return;
      }
    }

    // 参数行内容变化 → 断点失效（避免用旧进度去跳新的行）
    const sig = JSON.stringify(rows);
    if (sig !== rowsSigRef.current) {
      rowsSigRef.current = sig;
      doneIdxRef.current = new Set();
      if (mode === 'resume') {
        setError('参数行已变化，断点已失效，请重新运行');
        setResumeInfo(null);
        return;
      }
    }

    const done = doneIdxRef.current;
    const all = rows.map((_, i) => i);
    // 续跑：把已完成的行号交给主进程跳过；全量运行：重置断点
    const skip = mode === 'resume' ? all.filter((i) => done.has(i)) : [];
    const pending = all.filter((i) => !skip.includes(i));
    // 绑定参数文件夹时行数由主进程执行时才能确定，此处不校验
    if (!paramFolder && pending.length === 0) {
      setError('没有待执行的请求');
      return;
    }

    const runId = `b${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    runIdRef.current = runId;
    setRunning(true);
    setStopped(false);
    setError('');
    if (mode !== 'resume') {
      setResults([]);
      resultsRef.current = [];
      doneIdxRef.current = new Set();
    }
    setProgress({ done: doneIdxRef.current.size, total: rows.length });
    setRunSeq((n) => n + 1);

    /** 合并一条结果：续跑时保留上一轮已完成的行（同时镜像到 ref 供结束时落盘） */
    const mergeResult = (list: BatchCallResult[], r: BatchCallResult) => {
      const map = new Map(list.map((x) => [x.index, x]));
      map.set(r.index, r);
      const next = [...map.values()].sort((a, b) => a.index - b.index);
      resultsRef.current = next;
      return next;
    };

    // 订阅本次执行的进度：每完成一条即插入结果，无需等待整批结束
    const off = api.onBatchProgress((p) => {
      if (p.runId !== runIdRef.current) return;
      doneIdxRef.current.add(p.result.index);
      setResults((prev) => mergeResult(prev ?? [], p.result));
      setProgress({ done: doneIdxRef.current.size, total: rows.length });
    });

    try {
      const res = useSaved
        ? await api.runBatch(activeId ?? '', runId, skip)
        : await api.batchSend(
            {
              method,
              url,
              headers,
              body: body.trim() ? body : null,
              variables,
              // 绑定文件夹时行数据由主进程执行时实时读取，rows 仅作回退
              rows: paramFolder ? [] : rows,
              sequential,
              skipIndexes: skip,
              ...(paramFolder ? { paramFolder } : {}),
            },
            runId
          );
      res.forEach((r) => doneIdxRef.current.add(r.index));
      setResults((prev) => res.reduce((acc, r) => mergeResult(acc, r), prev ?? []));
      setProgress({ done: doneIdxRef.current.size, total: rows.length });
      if (useSaved) await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      off();
      setRunning(false);
      // 还有未执行的行 → 允许断点续跑
      const finished = doneIdxRef.current.size;
      const total = rows.length;
      setResumeInfo(finished < total ? { done: finished, total } : null);

      // 已保存的任务：把断点进度落盘，重启应用后可继续
      const pid = activeId;
      if (pid) {
        const state: BatchProgressState | null =
          finished < total && finished > 0
            ? {
                doneIndexes: [...doneIdxRef.current].sort((a, b) => a - b),
                results: resultsRef.current ?? [],
                rowsSignature: sig,
                updatedAt: new Date().toISOString(),
              }
            : null;
        api.saveBatchProgress(pid, state).catch(() => {
          /* 落盘失败不影响本次执行结果 */
        });
      }
    }
  };

  /** 暂停：中断在途请求并停止调度后续请求，已返回的结果保留。 */
  const pause = async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    try {
      const hit = await api.cancelBatch(runId);
      setStopped(true);
      if (!hit) setError('未能中断：该批次可能已经结束');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const newProject = () => {
    setActiveId(null);
    setProjectName('未命名批量任务');
    setUrl('https://api.example.com/users/{{id}}');
    setHeaders({});
    setBody('');
    setVariables(['id']);
    setRows([{ id: '1' }, { id: '2' }]);
    setSequential(true);
    setFolder('');
    setSourceId(null);
    setResults(null);
    resultsRef.current = null;
    setError('');
    setParamFolder('');
    setFolderInfo(null);
    setFileName('');
    // 新建任务：重置断点信息
    doneIdxRef.current = new Set();
    rowsSigRef.current = '';
    setResumeInfo(null);
    setStopped(false);
    setProgress(null);
  };

  // 来源历史接口的展示名（记录列表加载完成后才能确定是否已删除）
  const sourceRec = localRecords.find((r) => r.id === sourceId);
  const sourceLabel = sourceRec
    ? sourceRec.name || sourceRec.path || sourceRec.url
    : localRecords.length > 0
      ? '（接口已删除）'
      : '';

  /* ── 参数行搜索：按「变量名=值」匹配，保留原始行下标以便继续编辑/删除 ── */
  const rowKwLower = rowKw.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      rows
        .map((r, ri) => ({ r, ri }))
        .filter(({ r }) => {
          if (!rowKwLower) return true;
          return variables.some((v) => `${v}=${r[v] ?? ''}`.toLowerCase().includes(rowKwLower));
        }),
    [rows, rowKwLower, variables]
  );

  return (
    <>
    <div className="flex h-full min-w-0 flex-1 flex-col" data-select-scope>
      {/* 编辑区 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-[60%] rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold text-slate-100 outline-none hover:border-slate-700/50 focus:border-brand/60"
            />
            <div className="flex items-center gap-2">
              <Select
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                wrapperClassName="relative shrink-0"
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
            用一个基础请求模板，通过 <code className="text-brand-light">{'{{变量名}}'}</code>{' '}
            占位符区分每次调用的参数。参数来源三选一：手动参数行（CSV/JSON 粘贴）、
            <code className="text-brand-light">绑定文件夹</code>（执行时按文件名顺序实时读取，每个文件一次调用）或
            <code className="text-brand-light">AI 预处理</code>（结果默认写入参数文件夹并绑定）。
            参数行单元格或模板里还可使用动态变量：
            <code className="text-brand-light">{'{{$timestamp}}'}</code>、<code className="text-brand-light">{'{{$datetime}}'}</code>、
            <code className="text-brand-light">{'{{$date}}'}</code>、<code className="text-brand-light">{'{{$time}}'}</code>、
            <code className="text-brand-light">{'{{$uuid}}'}</code>（每行不同）、
            <code className="text-brand-light">{'{{$random(1,100)}}'}</code>。保存后即使关闭本面板也不会丢失。
          </p>

          {/* 基础请求 */}
          <div className="space-y-3 rounded-xl bg-slate-800/30 p-3">
            <div className="relative flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-[12px] font-medium text-slate-400">
                  基础请求
                </span>
                {sourceId && sourceLabel && (
                  <span className="flex min-w-0 items-center gap-1 rounded bg-slate-700/50 px-1.5 py-0.5 text-[10.5px] text-slate-300">
                    <span className="shrink-0 text-slate-500">来源</span>
                    <span className="max-w-[180px] truncate">{sourceLabel}</span>
                    <button
                      onClick={detachSource}
                      title="转为自定义请求：仅解除来源标记，保留当前内容，可继续手动修改"
                      className="shrink-0 text-slate-500 transition hover:text-slate-200 cursor-pointer"
                    >
                      <X size={10} />
                    </button>
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowLocal((v) => !v)}
                className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition cursor-pointer ${
                  showLocal
                    ? 'bg-brand/30 text-brand-light'
                    : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700/60'
                }`}
              >
                <Download size={12} /> 选择历史接口
              </button>

              {/* 历史接口选择浮层 */}
              {showLocal && (
                <div className="absolute right-0 top-8 z-20 max-h-[300px] w-[380px] overflow-hidden rounded-xl border border-slate-700/50 bg-slate-900/95 shadow-2xl backdrop-blur">
                  <div className="flex items-center gap-2 border-b border-slate-700/50 px-2.5 py-2">
                    <Search size={13} className="shrink-0 text-slate-500" />
                    <input
                      value={localKw}
                      onChange={(e) => setLocalKw(e.target.value)}
                      placeholder="搜索历史接口（名称/URL/方法）"
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
                        暂无历史接口记录，可直接手动填写下方请求
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
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-700/40 cursor-pointer ${
                            r.id === sourceId ? 'bg-brand/10' : ''
                          }`}
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
            <div className="flex gap-2">
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
                placeholder="https://api.example.com/users/{{id}}"
                className="min-w-0 flex-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-brand/60"
              />
            </div>
            <Section title="Headers（值可含 {{var}}）">
              <KVEditorInline value={headers} onChange={setHeaders} />
            </Section>
            <Section title="Body（可含 {{var}}）">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder={'{\n  "id": "{{id}}"\n}'}
                className="w-full resize-none rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-brand/60"
              />
            </Section>
          </div>

          {/* 变量名 */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-slate-400">变量名（占位符）</span>
              <button
                onClick={addVariable}
                className="flex items-center gap-1 rounded-md bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-700 cursor-pointer"
              >
                <Plus size={12} /> 变量
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {variables.map((v, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-2 py-1"
                >
                  <span className="text-[11px] text-slate-500">{'{{'}</span>
                  <input
                    value={v}
                    onChange={(e) => setVariableAt(i, e.target.value)}
                    className="w-20 bg-transparent text-[12px] text-brand-light outline-none"
                  />
                  <span className="text-[11px] text-slate-500">{'}}'}</span>
                  <button
                    onClick={() => removeVariable(i)}
                    disabled={variables.length <= 1}
                    className="text-slate-500 transition hover:text-rose-400 disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 参数行 */}
          <div className="mt-4">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setRowsCollapsed((v) => !v)}
                  title={rowsCollapsed ? '展开参数行' : '折叠参数行'}
                  className="rounded p-0.5 text-slate-400 transition hover:bg-slate-700/60 hover:text-slate-200 cursor-pointer"
                >
                  {rowsCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <span className="text-[12px] font-medium text-slate-400">
                  {paramFolder
                    ? `参数来源：文件夹（${folderInfo?.count ?? '…'} 个文件，执行时实时读取）`
                    : '参数行（每行 = 一次调用）'}
                </span>
                <span className="text-[11px] text-slate-500">
                  {rowKwLower ? `${visibleRows.length}/${rows.length} 行` : `${rows.length} 行`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowAi(true)}
                  title="用 AI 把原始数据整理成参数行（需在设置中配置 AI 接口）"
                  className="flex items-center gap-1 rounded-md bg-brand/20 px-2 py-0.5 text-[11px] text-brand-light transition hover:bg-brand/30 cursor-pointer"
                >
                  <Sparkles size={12} /> AI 预处理
                </button>
                <button
                  onClick={() => bindFolder()}
                  title="绑定参数文件夹：执行时按文件名顺序实时读取，每个文件依次发送一次"
                  className="flex items-center gap-1 rounded-md bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-700 cursor-pointer"
                >
                  <FolderOpen size={12} /> 绑定文件夹
                </button>
                {!rowsCollapsed && (
                  <div className="relative">
                    <Search
                      size={12}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500"
                    />
                    <input
                      value={rowKw}
                      onChange={(e) => setRowKw(e.target.value)}
                      placeholder="搜索参数行（如 id=3）"
                      className="w-44 rounded-md border border-slate-700/50 bg-slate-800/40 py-1 pl-7 pr-2 text-[11px] text-slate-200 outline-none focus:border-brand/60"
                    />
                  </div>
                )}
                <label className="flex cursor-pointer items-center gap-1 rounded-md bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-700">
                  <Upload size={12} /> 上传 CSV
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFile}
                    className="hidden"
                  />
                </label>
                {fileName && (
                  <span
                    className="flex max-w-[200px] items-center gap-1 rounded-md bg-brand/15 px-2 py-0.5 text-[11px] text-brand-light"
                    title={fileName}
                  >
                    <FileText size={11} className="shrink-0" />
                    <span className="truncate">{fileName}</span>
                    <button
                      onClick={clearFile}
                      title="清除已选文件"
                      className="shrink-0 text-slate-400 transition hover:text-rose-400 cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  </span>
                )}
                <button
                  onClick={() => setShowImport((v) => !v)}
                  className="flex items-center gap-1 rounded-md bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-700 cursor-pointer"
                >
                  <FileJson size={12} /> 粘贴 JSON/CSV
                </button>
                <button
                  onClick={addRow}
                  className="flex items-center gap-1 rounded-md bg-brand/20 px-2 py-0.5 text-[11px] text-brand-light transition hover:bg-brand/30 cursor-pointer"
                >
                  <Plus size={12} /> 行
                </button>
              </div>
            </div>

            {!rowsCollapsed && showImport && (
              <div className="mb-2 space-y-1.5 rounded-lg border border-slate-700/40 bg-slate-800/30 p-2">
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={3}
                  placeholder={'[\n  {"id":"1"},\n  {"id":"2"}\n]\n或 CSV：首行表头自动映射为变量名（占位符）'}
                  className="w-full resize-none rounded-md border border-slate-700/50 bg-slate-900/60 px-2 py-1.5 font-mono text-[11.5px] outline-none focus:border-brand/60"
                />
                <div className="flex justify-end">
                  <button
                    onClick={applyImport}
                    className="rounded-md bg-brand/25 px-2.5 py-1 text-[11px] text-brand-light transition hover:bg-brand/35 cursor-pointer"
                  >
                    解析并填入
                  </button>
                </div>
              </div>
            )}

            {paramFolder && (
              <div className="mb-2 rounded-xl border border-brand/30 bg-brand/5 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-200">
                    <FolderOpen size={13} className="text-brand-light" /> 已绑定参数文件夹
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        loadFolderInfo(paramFolder)
                          .then((i) => {
                            if (i.count) {
                              showToast(
                                `已刷新：${i.count} 个文件${
                                  i.skipped.length ? `（跳过 ${i.skipped.length} 个）` : ''
                                }`,
                                'info'
                              );
                            } else {
                              showToast('文件夹中没有可读取的文本文件', 'error');
                            }
                          })
                          .catch(() => showToast('刷新失败：文件夹不可读', 'error'))
                      }
                      className="rounded-md bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-700 cursor-pointer"
                    >
                      刷新
                    </button>
                    <button
                      onClick={unbindFolder}
                      className="rounded-md bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-700 cursor-pointer"
                    >
                      解除绑定
                    </button>
                  </div>
                </div>
                <div className="mb-1.5 break-all rounded-lg border border-slate-700/50 bg-slate-800/60 p-2 font-mono text-[11px] text-slate-300">
                  {paramFolder}
                </div>
                {folderInfo && (
                  <p className="text-[11.5px] leading-relaxed text-slate-400">
                    {folderInfo.count} 个文件 · 变量：
                    {folderInfo.variables.map((v) => `{{${v}}}`).join(' ')}
                  </p>
                )}
                {folderInfo && folderInfo.skipped.length > 0 && (
                  <p className="mt-1 text-[11px] text-amber-400/90">
                    跳过 {folderInfo.skipped.length} 个：{folderInfo.skipped.join('、')}
                  </p>
                )}
                <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
                  按文件名顺序依次发送，每个文件一行参数（JSON 键值自动映射为变量，另附
                  fileName / fileContent）。执行时实时读取：文件夹内容增删后无需重新保存。
                </p>
              </div>
            )}

            {!paramFolder && !rowsCollapsed && (
              <div className="max-h-[320px] overflow-auto rounded-lg border border-slate-700/40">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b border-slate-700/50 bg-slate-900/95 text-slate-400">
                      <th className="px-2 py-1.5 text-left font-medium">#</th>
                      {variables.map((v, i) => (
                        <th key={i} className="px-2 py-1.5 text-left font-medium">
                          {v}
                        </th>
                      ))}
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  <ParamRows
                    rows={visibleRows}
                    variables={variables}
                    onChange={setCell}
                    onRemove={removeRow}
                  />
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={variables.length + 2} className="py-4 text-center text-slate-500">
                        {rows.length === 0
                          ? '暂无参数行，点击右上角「行」添加'
                          : `没有匹配「${rowKw.trim()}」的参数行`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
          </div>

          {/* 选项 + 执行 */}
          {error && <div className="mt-3 text-[12px] text-rose-400">{error}</div>}
          {stopped && !running && (
            <div className="mt-3 text-[12px] text-amber-400">
              已暂停：完成 {progress?.done ?? 0}/{progress?.total ?? rows.length} 次，其余请求未执行
              {resumeInfo ? '，可点「继续剩余」从断点接着跑。' : '。'}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-[12px] text-slate-400">
              <input
                type="checkbox"
                checked={sequential}
                onChange={(e) => setSequential(e.target.checked)}
                className="accent-brand"
              />
              串行执行
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => run('run')}
                disabled={running}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand to-brand-light px-4 py-2 text-[13px] font-medium text-white shadow-lg shadow-brand/30 transition hover:brightness-110 disabled:opacity-50 cursor-pointer"
              >
                <Play size={14} />
                {running
                  ? `执行中 ${progress?.done ?? 0}/${progress?.total ?? rows.length}`
                  : paramFolder
                    ? `运行（文件夹 ${folderInfo?.count ?? '?'} 文件）`
                    : `运行（${rows.length} 次）`}
              </button>
              {running && (
                <button
                  onClick={pause}
                  title="中断在途请求，并停止调度后续请求"
                  className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-[13px] font-medium text-amber-300 transition hover:bg-amber-500/20 cursor-pointer"
                >
                  <Pause size={14} /> 暂停
                </button>
              )}
              {!running && resumeInfo && (
                <button
                  onClick={() => run('resume')}
                  title="跳过已完成的行，从上次中断处继续执行剩余请求"
                  className="flex items-center gap-1.5 rounded-lg border border-brand/50 bg-brand/10 px-4 py-2 text-[13px] font-medium text-brand-light transition hover:bg-brand/20 cursor-pointer"
                >
                  <Play size={14} /> 继续剩余（{resumeInfo.total - resumeInfo.done}）
                </button>
              )}
              {activeId && (
                <button
                  onClick={() => run('saved')}
                  disabled={running}
                  title="使用已保存的配置运行"
                  className="flex items-center gap-1.5 rounded-lg border border-brand/40 px-4 py-2 text-[13px] font-medium text-brand-light transition hover:bg-brand/10 disabled:opacity-50 cursor-pointer"
                >
                  <FolderOpen size={14} /> 运行已保存
                </button>
              )}
            </div>
          </div>

          {/* 结果（统计 / 过滤 / 搜索 / 表格，见 BatchResultSection） */}
          <BatchResultSection
            results={results}
            variables={variables}
            running={running}
            stopped={stopped}
            runSeq={runSeq}
          />
          </div>
      </div>

      {/* AI 预处理弹窗：原始数据 -> 结构化参数行 */}
      <AiPreprocessDialog
        open={showAi}
        onClose={() => setShowAi(false)}
        onFillRows={applyAiRows}
        onWriteFolder={writeAiRowsToFolder}
      />
    </>
  );
}

/* ── 性能优化：参数行 / 结果表拆分为行级 memo 组件 ──
 * 每个单元格都是受控 input，输入一个字符原本会触发整页重渲染、几百个输入框全部 reconciliation，
 * 表现为输入卡顿。拆成行级 memo 后，只有被编辑的那一行会重渲染，其余行直接跳过；
 * 结果表独立 memo，改参数时（父组件重渲染）不再跟着重渲染。 */

interface ParamRowProps {
  ri: number;
  r: BatchRow;
  variables: string[];
  onChange: (ri: number, key: string, val: string) => void;
  onRemove: (ri: number) => void;
}

const ParamRow = memo(function ParamRow({ ri, r, variables, onChange, onRemove }: ParamRowProps) {
  return (
    <tr className="border-b border-slate-800/60 text-slate-300 transition hover:bg-slate-700/20">
      <td className="px-2 py-1.5 text-slate-400">{ri + 1}</td>
      {variables.map((v, i) => (
        <td key={i} className="px-2 py-1.5">
          <input
            value={r[v] ?? ''}
            onChange={(e) => onChange(ri, v, e.target.value)}
            className="w-28 rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-brand/60"
          />
        </td>
      ))}
      <td className="px-2 py-1.5">
        <button
          onClick={() => onRemove(ri)}
          className="text-slate-500 transition hover:text-rose-400 cursor-pointer"
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
});

const ParamRows = memo(function ParamRows({
  rows,
  variables,
  onChange,
  onRemove,
}: {
  rows: { r: BatchRow; ri: number }[];
  variables: string[];
  onChange: (ri: number, key: string, val: string) => void;
  onRemove: (ri: number) => void;
}) {
  return (
    <>
      {rows.map(({ r, ri }) => (
        <ParamRow
          key={ri}
          ri={ri}
          r={r}
          variables={variables}
          onChange={onChange}
          onRemove={onRemove}
        />
      ))}
    </>
  );
});


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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-slate-400">{title}</div>
      {children}
    </div>
  );
}
