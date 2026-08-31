import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Play, Plus, Trash2, Copy, FileJson, Upload, Save, FolderOpen } from 'lucide-react';
import { api } from '../api/client';
import { Select } from './ui/Select';
import type {
  BatchCallInput,
  BatchCallResult,
  BatchProject,
  BatchRow,
} from '../../../shared/types';
import { relTime } from './method';

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
  const [sequential, setSequential] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchCallResult[] | null>(null);
  const [error, setError] = useState('');

  // ── 持久化：已保存的批量项目 & 文件夹 ──
  const [projects, setProjects] = useState<BatchProject[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('未命名批量任务');
  const [folder, setFolder] = useState('');

  const refreshList = useCallback(async () => {
    const [list, f] = await Promise.all([api.listBatches(), api.listBatchFolders()]);
    setProjects(list);
    setFolders(f);
  }, []);

  useEffect(() => {
    refreshList();
    const off = api.onBatches((list, f) => {
      setProjects(list);
      setFolders(f);
    });
    return off;
  }, [refreshList]);

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

  /* ── 行编辑 ── */
  const setCell = (rowIdx: number, key: string, val: string) =>
    setRows((rs) => rs.map((r, i) => (i === rowIdx ? { ...r, [key]: val } : r)));
  const addRow = () => setRows((rs) => [...rs, {}]);
  const removeRow = (idx: number) =>
    setRows((rs) => rs.filter((_, i) => i !== idx));

  /* ── 从 CSV/JSON 导入行 ── */
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
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

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      applyCsv(String(reader.result ?? ''));
    };
    reader.onerror = () => setError('文件读取失败');
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

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
    setResults(p.results ?? null);
    setError('');
  };

  /* ── 运行：当前编辑区 或 已保存项目 ── */
  const run = useCallback(
    async (useSaved: boolean) => {
      if (useSaved && activeId) {
        setRunning(true);
        setError('');
        try {
          const res = await api.runBatch(activeId);
          setResults(res);
          await refreshList();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setRunning(false);
        }
        return;
      }
      if (!url.trim()) {
        setError('请填写请求地址');
        return;
      }
      if (rows.length === 0) {
        setError('请至少添加一行参数');
        return;
      }
      setError('');
      setRunning(true);
      setResults(null);
      try {
        const input: BatchCallInput = {
          method,
          url,
          headers,
          body: body.trim() ? body : null,
          variables,
          rows,
          sequential,
        };
        const res = await api.batchSend(input);
        setResults(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [url, rows, method, headers, body, variables, sequential, activeId, refreshList]
  );

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
    setResults(null);
    setError('');
  };

  const deleteProject = async (id: string) => {
    await api.deleteBatch(id);
    if (activeId === id) newProject();
    await refreshList();
  };

  const [newFolderName, setNewFolderName] = useState('');
  const addFolder = async () => {
    const n = newFolderName.trim();
    if (!n) return;
    await api.createBatchFolder(n);
    setFolder(n);
    setNewFolderName('');
    await refreshList();
  };

  const statusBadge = (r: BatchCallResult) => {
    if (r.error) return { text: '错误', cls: 'bg-red-500/20 text-red-400' };
    if (r.status >= 200 && r.status < 400)
      return { text: `${r.status}`, cls: 'bg-emerald-500/20 text-emerald-400' };
    if (r.status >= 400)
      return { text: `${r.status}`, cls: 'bg-yellow-500/20 text-yellow-400' };
    return { text: `${r.status}`, cls: 'bg-slate-700 text-slate-400' };
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
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
            占位符区分每次调用的参数。参数行单元格或模板里还可使用动态变量：
            <code className="text-brand-light">{'{{$timestamp}}'}</code>、<code className="text-brand-light">{'{{$datetime}}'}</code>、
            <code className="text-brand-light">{'{{$date}}'}</code>、<code className="text-brand-light">{'{{$time}}'}</code>、
            <code className="text-brand-light">{'{{$uuid}}'}</code>（每行不同）、
            <code className="text-brand-light">{'{{$random(1,100)}}'}</code>。保存后即使关闭本面板也不会丢失。
          </p>

          {/* 基础请求 */}
          <div className="space-y-3 rounded-xl bg-slate-800/30 p-3">
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
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-slate-400">
                参数行（每行 = 一次调用）
              </span>
              <div className="flex gap-2">
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

            {showImport && (
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

            <div className="overflow-x-auto rounded-lg border border-slate-700/40">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-slate-700/50 text-slate-400">
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
                  {rows.map((r, ri) => (
                    <tr
                      key={ri}
                      className="border-b border-slate-800/60 text-slate-300 transition hover:bg-slate-700/20"
                    >
                      <td className="px-2 py-1.5 text-slate-400">{ri + 1}</td>
                      {variables.map((v, i) => (
                        <td key={i} className="px-2 py-1.5">
                          <input
                            value={r[v] ?? ''}
                            onChange={(e) => setCell(ri, v, e.target.value)}
                            className="w-28 rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-brand/60"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => removeRow(ri)}
                          className="text-slate-500 transition hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={variables.length + 2} className="py-4 text-center text-slate-500">
                        暂无参数行，点击右上角「行」添加
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 选项 + 执行 */}
          {error && <div className="mt-3 text-[12px] text-rose-400">{error}</div>}
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
            <div className="flex gap-2">
              <button
                onClick={() => run(false)}
                disabled={running}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand to-brand-light px-4 py-2 text-[13px] font-medium text-white shadow-lg shadow-brand/30 transition hover:brightness-110 disabled:opacity-50 cursor-pointer"
              >
                <Play size={14} /> {running ? '执行中…' : `运行（${rows.length} 次）`}
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
          </div>

          {/* 结果 */}
          {results && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-slate-400">
                执行结果（{results.length} 次，
                {results.filter((r) => !r.error && r.status >= 200 && r.status < 400).length} 成功 /
                {results.filter((r) => r.error || r.status >= 400).length} 失败）
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-700/40">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="border-b border-slate-700/50 text-slate-400">
                      <th className="px-2 py-1.5 text-left font-medium">#</th>
                      <th className="px-2 py-1.5 text-left font-medium">发送时间</th>
                      <th className="px-2 py-1.5 text-left font-medium">状态</th>
                      <th className="px-2 py-1.5 text-right font-medium">耗时</th>
                      <th className="px-2 py-1.5 text-left font-medium">变量值</th>
                      <th className="px-2 py-1.5 text-left font-medium">响应</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => {
                      const b = statusBadge(r);
                      return (
                        <tr
                          key={r.index}
                          className="border-b border-slate-800/60 text-slate-300 transition hover:bg-slate-700/20"
                        >
                          <td className="px-2 py-1.5 text-slate-400">{r.index + 1}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-slate-400" title={new Date(r.sentAt).toLocaleString()}>
                            {relTime(r.sentAt)}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${b.cls}`}>
                              {b.text}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-400">{r.durationMs}ms</td>
                          <td className="max-w-[180px] truncate px-2 py-1.5 text-slate-400">
                            {variables.map((v) => `${v}=${r.vars[v] ?? ''}`).join(' ')}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-slate-400">{title}</div>
      {children}
    </div>
  );
}
