import { useState, useEffect, useCallback } from 'react';
import { X, Clock, Plus, Play, Pause, Trash2, ChevronDown, ChevronRight, History } from 'lucide-react';
import { api } from '../api/client';
import type {
  ScheduleConfig,
  ScheduleRunResult,
  CaptureInput,
  InterfaceRecord,
} from '../../../shared/types';

/**
 * 定时调度管理面板：
 * - 从已有接口中选取请求目标
 * - 设置调用间隔（秒/分钟/小时）
 * - 启用/停用任务、查看执行历史
 */

interface Props {
  records: InterfaceRecord[];
  onClose: () => void;
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

export function SchedulePanel({ records, onClose }: Props) {
  const [schedules, setSchedules] = useState<ScheduleConfig[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [selectedRecId, setSelectedRecId] = useState('');
  const [intervalSec, setIntervalSec] = useState(60);
  const [startAt, setStartAt] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, ScheduleRunResult[]>>({});

  useEffect(() => {
    api.listSchedules().then(setSchedules);
    api.onSchedules(setSchedules);
  }, []);

  const addSchedule = async () => {
    const record = records.find((r) => r.id === selectedRecId);
    if (!record || !name.trim()) return;
    const config: ScheduleConfig = {
      id: genId(),
      name: name.trim(),
      input: recordToInput(record),
      intervalSeconds: intervalSec,
      enabled: true,
      createdAt: new Date().toISOString(),
      runCount: 0,
    };
    if (startAt) {
      const iso = new Date(startAt).toISOString();
      if (!Number.isNaN(new Date(iso).getTime())) config.startAt = iso;
    }
    const updated = await api.saveSchedule(config);
    setSchedules(updated);
    setName('');
    setSelectedRecId('');
    setIntervalSec(60);
    setStartAt('');
    setShowAdd(false);
  };

  const toggleSchedule = async (id: string) => {
    await api.toggleSchedule(id);
  };

  const deleteSchedule = async (id: string) => {
    await api.deleteSchedule(id);
    if (expandedId === id) setExpandedId(null);
  };

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    // 按需加载历史（避免每次刷新都拉取）
    if (!historyMap[id]) {
      const hist = (await api.getScheduleHistory(id)) ?? [];
      setHistoryMap((m) => ({ ...m, [id]: hist }));
    }
  }, [expandedId, historyMap]);

  const formatInterval = (sec: number): string => {
    if (sec < 60) return `${sec} 秒`;
    if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)} 小时`;
    return `${Math.round(sec / 86400)} 天`;
  };

  const nextRuns = (s: ScheduleConfig, n: number): Date[] => {
    if (!s.enabled) return [];
    const now = Date.now();
    // 容错：间隔缺失或非数字时按 1 秒兜底，避免产生 Invalid Date 导致渲染崩溃
    const interval = (Number.isFinite(s.intervalSeconds) ? s.intervalSeconds : 1) * 1000;
    const out: Date[] = [];

    // 基准时间：设置了未来开始时间 → 用 startAt；否则统一以创建时间 createdAt 为基准
    let anchor = Number.NaN;
    let useStart = false;
    if (s.startAt) {
      const start = new Date(s.startAt).getTime();
      if (!Number.isNaN(start) && start > now) {
        anchor = start;
        useStart = true;
      }
    }
    if (!useStart) {
      const created = new Date(s.createdAt).getTime();
      anchor = Number.isNaN(created) ? now : created;
    }

    // 基于基准时间按间隔推算后续执行时刻，并对齐到当前时刻之后的首个
    let next = useStart ? anchor : anchor + interval;
    while (next <= now) next += interval;
    for (let i = 0; i < n; i++) out.push(new Date(next + i * interval));
    return out;
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass max-h-[88vh] w-[520px] max-w-[92vw] overflow-y-auto rounded-2xl border border-slate-700/50 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
            <Clock size={16} className="text-brand-light" /> 定时调度
          </h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
          >
            <X size={16} />
          </button>
        </div>

        {/* 添加按钮 */}
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="mb-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-600 py-2 text-[13px] text-slate-400 transition hover:border-slate-500 hover:text-slate-300"
          >
            <Plus size={14} /> 新建定时任务
          </button>
        )}

        {/* 新建表单 */}
        {showAdd && (
          <div className="mb-3 space-y-3 rounded-xl bg-slate-800/40 p-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="任务名称（如：健康检查）"
              className="w-full rounded-lg border border-slate-700/50 bg-slate-800/60 p-2 text-[13px] text-slate-200 outline-none transition focus:border-brand/60"
            />
            <select
              value={selectedRecId}
              onChange={(e) => setSelectedRecId(e.target.value)}
              className="w-full rounded-lg border border-slate-700/50 bg-slate-800/60 p-2 text-[13px] text-slate-200 outline-none transition focus:border-brand/60"
            >
              <option value="">选择要调用的接口…</option>
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.method} {r.name || r.path || r.url}
                </option>
              ))}
            </select>
            <div>
              <label className="mb-1 block text-[12px] text-slate-400">调用间隔</label>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_INTERVALS.map((it) => (
                  <button
                    key={it.value}
                    onClick={() => setIntervalSec(it.value)}
                    className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
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
              <label className="mb-1 block text-[12px] text-slate-400">
                开始执行时间（可选）
              </label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full rounded-lg border border-slate-700/50 bg-slate-800/60 p-2 text-[13px] text-slate-200 outline-none transition focus:border-brand/60"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                留空则保存后立即按间隔调度；设置未来时间则等待到该时刻首次执行。
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={addSchedule}
                disabled={!name.trim() || !selectedRecId}
                className="flex-1 cursor-pointer rounded-lg bg-brand/80 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-brand disabled:opacity-40"
              >
                添加
              </button>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setName('');
                  setSelectedRecId('');
                  setStartAt('');
                }}
                className="cursor-pointer rounded-lg bg-slate-700/50 px-3 py-2 text-[13px] text-slate-300 transition hover:bg-slate-700"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 任务列表 */}
        {schedules.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-slate-400">
            暂无定时任务，点击上方按钮新建
          </div>
        ) : (
          <div className="space-y-2">
            {schedules.map((s) => {
              const badge = lastResultBadge(s);
              const isExpanded = expandedId === s.id;
              const history = historyMap[s.id] ?? [];
              // 倒序展示（最新在前）
              const displayHistory = [...history].reverse();
              return (
                <div
                  key={s.id}
                  className={`rounded-xl border transition ${
                    s.enabled
                      ? 'border-slate-700/50 bg-slate-800/30'
                      : 'border-slate-800 bg-slate-800/20 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between p-3">
                    {/* 左侧：名称 + 请求摘要 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            s.enabled ? 'text-brand-light' : 'text-slate-400'
                          }`}
                        >
                          {s.input.method}
                        </span>
                        <span className="truncate text-[13px] font-medium text-slate-200">
                          {s.name}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate pl-1 text-[11px] text-slate-400">
                        {s.input.url}
                      </p>
                      {/* 运行信息 */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-1 text-[11px]">
                        <span className="text-slate-400">
                          每 {formatInterval(s.intervalSeconds)}
                        </span>
                        {(() => {
                          const runs = nextRuns(s, 2);
                          if (!s.enabled)
                            return <span className="text-slate-300">已暂停</span>;
                          if (runs.length === 0)
                            return <span className="text-slate-300">排队中…</span>;
                          return (
                            <>
                              <span className="text-slate-300">
                                下次 {formatTime(runs[0].toISOString())}
                              </span>
                              {runs[1] && (
                                <span className="text-slate-300">
                                  再 {formatTime(runs[1].toISOString())}
                                </span>
                              )}
                            </>
                          );
                        })()}
                        <span className="text-slate-300">
                          已执行 {s.runCount} 次
                        </span>
                        {s.startAt && new Date(s.startAt).getTime() > Date.now() && (
                          <span className="text-amber-400/80">
                            始于 {formatTime(s.startAt)}
                          </span>
                        )}
                        <span className={`rounded-full px-1.5 py-px text-[10px] ${badge.cls}`}>
                          {badge.text}
                        </span>
                      </div>
                    </div>

                    {/* 右侧：操作按钮 */}
                    <div className="ml-3 flex items-center gap-1">
                      <button
                        onClick={() => toggleSchedule(s.id)}
                        title={s.enabled ? '暂停' : '启用'}
                        className={`cursor-pointer rounded-md p-1.5 transition ${
                          s.enabled
                            ? 'text-brand-light hover:bg-brand/10'
                            : 'text-slate-400 hover:bg-slate-700/50'
                        }`}
                      >
                        {s.enabled ? <Pause size={15} /> : <Play size={15} />}
                      </button>
                      <button
                        onClick={() => deleteSchedule(s.id)}
                        className="cursor-pointer rounded-md p-1.5 text-slate-400 transition hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 size={15} />
                      </button>
                      {/* 展开历史 */}
                      <button
                        onClick={() => toggleExpand(s.id)}
                        className="cursor-pointer rounded-md p-1.5 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-300"
                        title={isExpanded ? '收起历史' : '查看执行历史'}
                      >
                        {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                    </div>
                  </div>

                  {/* ── 历史记录表格 ── */}
                  {isExpanded && (
                    <div className="border-t border-slate-700/40 px-3 pb-3 pt-2">
                      {displayHistory.length === 0 ? (
                        <div className="py-3 text-center text-[11.5px] text-slate-400">
                          暂无执行记录
                        </div>
                      ) : (
                        <>
                          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                            <History size={12} />
                            最近 {displayHistory.length} 次执行
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="border-b border-slate-700/50 text-slate-400">
                                  <th className="py-1.5 pr-2 text-left font-medium">#</th>
                                  <th className="py-1.5 pr-3 text-left font-medium">时间</th>
                                  <th className="py-1.5 pr-3 text-left font-medium">状态</th>
                                  <th className="py-1.5 pr-3 text-right font-medium">耗时</th>
                                  <th className="py-1.5 text-left font-medium">详情</th>
                                </tr>
                              </thead>
                              <tbody>
                                {displayHistory.map((r, i) => {
                                  const stBadge = resultStatusBadge(r);
                                  return (
                                    <tr
                                      key={i}
                                      className="border-b border-slate-800/60 text-slate-300 transition hover:bg-slate-700/20"
                                    >
                                      <td className="py-1.5 pr-2 text-slate-300">
                                        {displayHistory.length - i}
                                      </td>
                                      <td className="whitespace-nowrap py-1.5 pr-3 text-slate-400">
                                        {formatTime(r.at)}
                                      </td>
                                      <td className="py-1.5 pr-3">
                                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${stBadge.cls}`}>
                                          {stBadge.text}
                                        </span>
                                      </td>
                                      <td className="py-1.5 pr-3 text-right text-slate-400">
                                        {r.durationMs}ms
                                      </td>
                                      <td className="max-w-[160px] truncate py-1.5 text-slate-400">
                                        {r.error ?? r.statusText ?? '-'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
