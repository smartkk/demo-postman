import { Fragment, useState, useEffect } from 'react';
import { History, Calendar, Plus, Save, RotateCcw, Send } from 'lucide-react';
import { DateTimeField } from './DateTimeField';
import { Select } from './ui/Select';
import { BodyView } from './BodyView';
import { api } from '../api/client';
import { showToast } from './ui/Toast';
import type {
  ScheduleConfig,
  ScheduleRunResult,
  CaptureInput,
  InterfaceRecord,
  ChainProject,
} from '../../../shared/types';

/**
 * 定时调度管理面板：
 * - 从已有接口中选取请求目标
 * - 设置调用间隔（秒/分钟/小时）
 * - 启用/停用任务、查看执行历史
 */

interface Props {
  records: InterfaceRecord[];
  activeId: string | null;
  /** 新建完成后同步左侧栏选中态（App 的 activeIds.schedules） */
  onSelect?: (id: string) => void;
}

const DEFAULT_INTERVALS = [
  { label: '30 秒', value: 30 },
  { label: '1 分钟', value: 60 },
  { label: '5 分钟', value: 300 },
  { label: '10 分钟', value: 600 },
  { label: '30 分钟', value: 1800 },
  { label: '1 小时', value: 3600 },
  { label: '5 小时', value: 18000 },
  { label: '24 小时', value: 86400 },
];

function genId(): string {
  return `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function recordToInput(r: InterfaceRecord): CaptureInput {
  return {
    method: r.method,
    url: r.url + (r.query && Object.keys(r.query).length
      ? '?' + new URLSearchParams(r.query).toString()
      : ''),
    headers: r.headers,
    body: r.body,
    contentType: r.contentType,
  };
}

export function SchedulePanel({ records, activeId, onSelect }: Props) {
  const [schedules, setSchedules] = useState<ScheduleConfig[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selectedRecId, setSelectedRecId] = useState('');
  const [intervalSec, setIntervalSec] = useState(60);
  const [startAt, setStartAt] = useState('');
  const [historyMap, setHistoryMap] = useState<Record<string, ScheduleRunResult[]>>({});
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const [mode, setMode] = useState<'single' | 'chain'>('single');
  const [chainId, setChainId] = useState('');
  const [chains, setChains] = useState<ChainProject[]>([]);
  const [savedTip, setSavedTip] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    api.listSchedules().then(setSchedules);
    api.onSchedules(setSchedules);
    api.listChains().then(setChains);
  }, []);

  // 根据左侧栏选中的定时任务加载编辑区；activeId 为 null 表示「新建」
  useEffect(() => {
    if (activeId) {
      editSchedule(activeId);
    } else {
      // 新建模式：直接展开空白表单，保持与其它面板一致的「左侧 + 新建」交互
      setEditingId(null);
      setShowAdd(true);
      setName('');
      setSelectedRecId('');
      setStartAt('');
      setMode('single');
      setChainId('');
      setIntervalSec(60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const addSchedule = async () => {
    if (!name.trim()) return;
    const isChain = mode === 'chain';
    if (isChain) {
      if (!chainId) return;
    } else {
      const record = records.find((r) => r.id === selectedRecId);
      if (!record) return;
    }
    // 编辑模式：复用原 id、保留 createdAt/runCount；否则新建
    // 直接读取最新列表，避免依赖本组件内可能滞后的 schedules 状态
    const latest = await api.listSchedules();
    setSchedules(latest);
    const existing = editingId
      ? latest.find((s) => s.id === editingId)
      : undefined;
    const config: ScheduleConfig = {
      id: existing ? existing.id : genId(),
      name: name.trim(),
      input: isChain ? { method: '', url: '', headers: {}, body: null, contentType: null } : recordToInput(records.find((r) => r.id === selectedRecId)!),
      chainId: isChain ? chainId : undefined,
      intervalSeconds: intervalSec,
      enabled: existing ? existing.enabled : true,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      runCount: existing ? existing.runCount : 0,
    };
    if (startAt) {
      const iso = new Date(startAt).toISOString();
      if (!Number.isNaN(new Date(iso).getTime())) config.startAt = iso;
    }
    const updated = await api.saveSchedule(config);
    setSchedules(updated);
    setSavedTip(true);
    window.setTimeout(() => setSavedTip(false), 1800);
    if (existing) {
      // 编辑模式：保留表单，便于继续微调
      setShowAdd(true);
    } else {
      // 新建完成：直接选中该任务，让用户立即看到概要与执行历史，
      // 不再收起表单后留下空白主区。onSelect 同步左侧栏高亮；
      // activeId 变化会再次触发 editSchedule（幂等，仅重复读一次列表）
      onSelect?.(config.id);
      await editSchedule(config.id);
    }
  };

  const handleRunNow = async (id: string) => {
    if (sendingId) return;
    setSendingId(id);
    try {
      const result = await api.runSchedule(id);
      if (result) {
        // 立即刷新该任务执行历史与概要
        api.getScheduleHistory(id).then((h) =>
          setHistoryMap((m) => ({ ...m, [id]: h ?? [] })),
        );
        if (result.status >= 200 && result.status < 400) {
          showToast(`「立即发送」成功，状态码 ${result.status}`, 'success');
        } else if (result.error) {
          showToast(`发送失败：${result.error}`, 'error');
        } else {
          showToast(`请求返回 ${result.status} ${result.statusText}`, 'info');
        }
      }
    } catch (err) {
      console.error('[SchedulePanel] 立即发送失败：', err);
      showToast('立即发送失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setSendingId(null);
    }
  };

  const editSchedule = async (id: string) => {
    // 直接读取最新数据，避免依赖本组件内可能尚未加载完成的 schedules 状态
    const latest = await api.listSchedules();
    setSchedules(latest);
    const s = latest.find((x) => x.id === id);
    if (!s) return;
    // 回填表单：尝试找到对应的本地接口记录
    const rec = records.find(
      (r) => r.method === s.input.method && r.url === s.input.url,
    );
    setName(s.name);
    setSelectedRecId(rec ? rec.id : '');
    setIntervalSec(s.intervalSeconds);
    // 回填执行类型：链式 or 单接口
    if (s.chainId) {
      setMode('chain');
      setChainId(s.chainId);
    } else {
      setMode('single');
      setChainId('');
    }
    // startAt(ISO, UTC) 转回 datetime-local(本地) 回填
    if (s.startAt) {
      const d = new Date(s.startAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setStartAt(local);
    } else {
      setStartAt('');
    }
    setEditingId(id);
    setShowAdd(true);
    // 进入编辑即加载该任务执行历史，保证历史区有数据
    api.getScheduleHistory(id).then((h) =>
      setHistoryMap((m) => ({ ...m, [id]: h ?? [] })),
    );
  };

  const formatInterval = (sec: number): string => {
    if (sec < 60) return `${sec} 秒`;
    if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)} 小时`;
    return `${Math.round(sec / 86400)} 天`;
  };

  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const resultStatusBadge = (r: ScheduleRunResult): { text: string; cls: string } => {
    if (r.error) return { text: '错误', cls: 'bg-red-500/20 text-red-400' };
    if (r.status >= 200 && r.status < 400)
      return { text: `${r.status}`, cls: 'bg-emerald-500/20 text-emerald-400' };
    if (r.status >= 400)
      return { text: `${r.status}`, cls: 'bg-yellow-500/20 text-yellow-400' };
    return { text: `${r.status}`, cls: 'bg-slate-700 text-slate-400' };
  };

  const lastResultBadge = (s: ScheduleConfig): { text: string; cls: string } => {
    if (!s.lastResult) return { text: '暂无', cls: 'bg-slate-700 text-slate-400' };
    if (s.lastResult.error)
      return { text: `错误: ${s.lastResult.error.slice(0, 24)}`, cls: 'bg-red-500/20 text-red-400' };
    const ok = s.lastResult.status >= 200 && s.lastResult.status < 400;
    return {
      text: `${s.lastResult.status} ${s.lastResult.durationMs}ms`,
      cls: ok
        ? 'bg-emerald-500/20 text-emerald-400'
        : 'bg-yellow-500/20 text-yellow-400',
    };
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">

        {/* 新建/编辑表单（由左侧栏 + 触发 activeId=null 进入新建） */}
        {showAdd && (
          <div className={`space-y-3 rounded-xl border border-slate-700/40 bg-slate-800/30 p-4 ${editingId ? 'shrink-0' : 'flex min-h-0 flex-1 flex-col'}`}>
            <div className="flex items-center gap-2 text-[13px] font-medium text-slate-200">
              {editingId ? <><Calendar size={14} className="text-brand-light" /> 编辑定时任务</>
                : <><Plus size={14} className="text-brand-light" /> 新建定时任务</>}
            </div>

            {/* 任务名称 */}
            <div>
              <label className="mb-1 block text-[12px] text-slate-400">任务名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：健康检查 / 每小时同步"
                className="w-full rounded-lg border border-slate-700/50 bg-slate-800/60 p-2 text-[13px] text-slate-200 outline-none transition focus:border-brand/60"
              />
            </div>

            {/* 执行类型 */}
            <div>
              <label className="mb-1 block text-[12px] text-slate-400">执行类型</label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setMode('single')}
                  className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                    mode === 'single'
                      ? 'bg-brand/25 text-brand-light'
                      : 'bg-slate-800/60 text-slate-400 hover:bg-slate-700/50'
                  }`}
                >
                  单接口
                </button>
                <button
                  type="button"
                  onClick={() => setMode('chain')}
                  className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                    mode === 'chain'
                      ? 'bg-brand/25 text-brand-light'
                      : 'bg-slate-800/60 text-slate-400 hover:bg-slate-700/50'
                  }`}
                >
                  链式任务
                </button>
              </div>
            </div>

            {/* 目标选择 */}
            <div>
              <label className="mb-1 block text-[12px] text-slate-400">
                {mode === 'single' ? '调用接口' : '链式任务'}
              </label>
              {mode === 'single' ? (
                <Select
                  value={selectedRecId}
                  onChange={(e) => setSelectedRecId(e.target.value)}
                >
                  <option value="">选择要调用的接口…</option>
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.method} {r.name || r.path || r.url}
                    </option>
                  ))}
                </Select>
              ) : (
                <Select
                  value={chainId}
                  onChange={(e) => setChainId(e.target.value)}
                >
                  <option value="">选择要执行的链式任务…</option>
                  {chains.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}（{c.steps.length} 步）
                    </option>
                  ))}
                </Select>
              )}
            </div>

            {/* 间隔 + 开始时间，两列并排，信息更紧凑 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[12px] text-slate-400">调用间隔</label>
                <div className="flex flex-wrap gap-1">
                  {DEFAULT_INTERVALS.map((it) => (
                    <button
                      key={it.value}
                      onClick={() => setIntervalSec(it.value)}
                      className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        intervalSec === it.value
                          ? 'bg-brand/25 text-brand-light'
                          : 'bg-slate-800/60 text-slate-400 hover:bg-slate-700/50'
                      }`}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="flex items-center gap-1 text-[12px] text-slate-400">
                    <Calendar size={12} /> 开始时间
                  </label>
                  {startAt && (
                    <button
                      onClick={() => setStartAt('')}
                      className="text-[11px] text-slate-500 transition hover:text-slate-300"
                    >
                      清除
                    </button>
                  )}
                </div>
                <DateTimeField value={startAt} onChange={setStartAt} />
                <p className="mt-1 text-[10.5px] leading-tight text-slate-400">
                  留空则保存后立即调度
                </p>
              </div>
            </div>

            {/* 操作 */}
            <div className="mt-auto flex justify-end gap-2 pt-1">
              <button
                onClick={addSchedule}
                disabled={!name.trim() || (mode === 'chain' ? !chainId : !selectedRecId)}
                className="group relative flex shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-gradient-to-r from-brand to-brand-light px-4 py-2 text-[13px] font-semibold text-white shadow-lg shadow-brand/20 transition-all duration-150 hover:shadow-xl hover:shadow-brand/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
                <Save size={14} className="relative" />
                <span className="relative">{savedTip ? '已保存 ✓' : editingId ? '保存修改' : '添加任务'}</span>
              </button>
              {editingId && (
                <button
                  onClick={() => handleRunNow(editingId)}
                  disabled={!!sendingId}
                  title="立即发送一次请求"
                  className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/90 px-3 py-2 text-[13px] font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
                >
                  {sendingId === editingId ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <Send size={13} />
                  )}
                  立即发送
                </button>
              )}
              <button
                onClick={() => {
                  setName('');
                  setSelectedRecId('');
                  setStartAt('');
                  setEditingId(null);
                  setMode('single');
                  setChainId('');
                  setIntervalSec(60);
                }}
                className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-600/60 bg-slate-700/40 px-3 py-2 text-[13px] font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700/60 active:scale-[0.98]"
              >
                <RotateCcw size={13} /> 清空
              </button>
            </div>
          </div>
        )}

        {/* 选中任务：概要 + 执行历史（列表已移至左侧栏） */}
        {editingId && (() => {
          const s = schedules.find((x) => x.id === editingId);
          if (!s) return null;
          const history = historyMap[s.id] ?? [];
          const displayHistory = [...history].reverse();
          const badge = lastResultBadge(s);
          return (
            <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-xl border border-slate-700/40 bg-slate-800/30">
              {/* 概要头部 */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-700/40 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  {s.chainId ? (
                    <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-300">
                      链式
                    </span>
                  ) : (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        s.enabled ? 'text-brand-light' : 'text-slate-400'
                      }`}
                    >
                      {s.input.method}
                    </span>
                  )}
                  <span className="truncate text-[13px] font-medium text-slate-200">{s.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => handleRunNow(s.id)}
                    disabled={!!sendingId}
                    title="立即发送一次请求"
                    className="flex items-center gap-1 rounded-md bg-emerald-500/90 px-2 py-1 text-[11px] font-semibold text-white shadow transition hover:bg-emerald-500 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60"
                  >
                    {sendingId === s.id ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    ) : (
                      <Send size={11} />
                    )}
                    立即发送
                  </button>
                  <span className={`rounded-full px-1.5 py-px text-[10px] ${badge.cls}`}>
                    {badge.text}
                  </span>
                </div>
              </div>
              {/* 元信息 */}
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-slate-700/40 px-3 py-1.5 text-[11px] text-slate-400">
                <span>每 {formatInterval(s.intervalSeconds)}</span>
                <span>已执行 {s.runCount} 次</span>
                <span>状态 {s.enabled ? '运行中' : '已停用'}</span>
              </div>

              {/* 历史区：占满剩余空间，内部滚动 */}
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[11px] text-slate-400">
                  <History size={12} />
                  {displayHistory.length === 0 ? '执行记录' : `最近 ${displayHistory.length} 次执行`}
                </div>
                {displayHistory.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center py-4 text-[11.5px] text-slate-400">
                    暂无执行记录，保存后开始调度
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-slate-800/95 text-slate-400">
                        <tr className="border-b border-slate-700/50">
                          <th className="px-2 py-1.5 text-left font-medium">#</th>
                          <th className="px-2 py-1.5 text-left font-medium">执行时间</th>
                          <th className="px-2 py-1.5 text-left font-medium">状态</th>
                          <th className="px-2 py-1.5 text-right font-medium">耗时</th>
                          <th className="px-2 py-1.5 text-left font-medium">详情</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayHistory.map((r, i) => {
                          const stBadge = resultStatusBadge(r);
                          // 用响应时间戳而非数组下标做身份：历史是往前插入的，
                          // 用下标会导致新记录进来时「展开的行」错位到别的记录上。
                          const rowKey = `${s.id}__${r.at || i}`;
                          const open = expandedResultId === rowKey;
                          return (
                            // key 必须落在 map 直接返回的最外层元素上。
                            // 原先放在内层 <tr>，Fragment 反而没有 key，于是触发 React 警告。
                            <Fragment key={rowKey}>
                              <tr
                                onClick={() =>
                                  setExpandedResultId(open ? null : rowKey)
                                }
                                className={`cursor-pointer border-b border-slate-800/60 text-slate-300 transition hover:bg-slate-700/20 ${
                                  open ? 'bg-slate-700/30' : ''
                                }`}
                              >
                                <td className="px-2 py-1.5 text-slate-300">{displayHistory.length - i}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-slate-400" title={`响应完成：${formatTime(r.at)}`}>
                                  {formatTime(r.firedAt || r.at)}
                                </td>
                                <td className="px-2 py-1.5">
                                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${stBadge.cls}`}>
                                    {stBadge.text}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-400">{r.durationMs}ms</td>
                                <td className="max-w-[200px] truncate px-2 py-1.5 text-slate-400" title={r.error ?? r.statusText ?? ''}>
                                  {r.error ?? r.statusText ?? '-'}
                                </td>
                              </tr>
                              {open && (
                                <tr key={`${i}__d`} className="border-b border-slate-800/60 bg-slate-900/40">
                                  <td colSpan={5} className="px-3 py-2">
                                    <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px]">
                                      <span className={`rounded-full px-2 py-0.5 ${stBadge.cls}`}>
                                        {stBadge.text}
                                      </span>
                                      <span className="text-slate-400">耗时 {r.durationMs}ms</span>
                                      <span className="text-slate-400">触发 {formatTime(r.firedAt)}</span>
                                      {r.error && <span className="text-rose-400">错误：{r.error}</span>}
                                    </div>
                                    {r.body ? (
                                      <BodyView body={r.body} contentType={undefined} emptyHint="无响应体" />
                                    ) : (
                                      <div className="py-2 text-center text-[11.5px] text-slate-600">
                                        本次响应无返回内容
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        </div>
    </div>
  );
}
