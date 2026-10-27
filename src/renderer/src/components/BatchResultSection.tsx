import { memo, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { BatchCallResult } from '../../../shared/types';
import { relTime } from './method';

/* ── 结果状态徽章（模块级纯函数，无闭包依赖，便于 memo 表复用） ── */
function makeStatusBadge(r: BatchCallResult): { text: string; cls: string } {
  if (r.error) return { text: '错误', cls: 'bg-red-500/20 text-red-400' };
  if (r.status >= 200 && r.status < 400)
    return { text: `${r.status}`, cls: 'bg-emerald-500/20 text-emerald-400' };
  if (r.status >= 400)
    return { text: `${r.status}`, cls: 'bg-yellow-500/20 text-yellow-400' };
  return { text: `${r.status}`, cls: 'bg-slate-700 text-slate-400' };
}

/** 是否成功：2xx/3xx 且无错误（与统计口径一致）。 */
function isOkResult(r: BatchCallResult): boolean {
  return !r.error && r.status >= 200 && r.status < 400;
}

const ResultTable = memo(function ResultTable({
  results,
  variables,
}: {
  results: BatchCallResult[];
  variables: string[];
}) {
  return (
    <>
      {results.map((r) => {
        const b = makeStatusBadge(r);
        return (
          <tr
            key={r.index}
            className="border-b border-slate-800/60 text-slate-300 transition hover:bg-slate-700/20"
          >
            <td className="px-2 py-1.5 text-slate-400">{r.index + 1}</td>
            <td
              className="whitespace-nowrap px-2 py-1.5 text-slate-400"
              title={new Date(r.sentAt).toLocaleString()}
            >
              {relTime(r.sentAt)}
            </td>
            <td className="px-2 py-1.5">
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${b.cls}`}>{b.text}</span>
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
    </>
  );
});

/**
 * 批量执行结果区：统计 + 成功/失败过滤 + 结果搜索 + 结果表格。
 *
 * 从 BatchPanel 拆出（原 1580 行单文件的一部分）：折叠 / 过滤 / 搜索
 * 这些状态只服务于结果区自身，收回内部后父组件只需关心 results 本身。
 * runSeq 每次运行自增：用于在新一轮执行开始时自动展开结果区。
 */
export function BatchResultSection({
  results,
  variables,
  running,
  stopped,
  runSeq,
}: {
  results: BatchCallResult[] | null;
  variables: string[];
  running: boolean;
  stopped: boolean;
  /** 每轮运行递增一次；变化时重置为展开态 */
  runSeq: number;
}) {
  const [resultCollapsed, setResultCollapsed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'fail'>('all');
  const [resultKw, setResultKw] = useState('');

  // 新一轮运行开始：展开结果区，便于边执行边看流式返回的结果
  useEffect(() => {
    if (runSeq > 0) setResultCollapsed(false);
  }, [runSeq]);

  const resultKwLower = resultKw.trim().toLowerCase();
  const okCount = (results ?? []).filter(isOkResult).length;
  const failCount = (results ?? []).length - okCount;
  const visibleResults = useMemo(
    () =>
      (results ?? []).filter((r) => {
        if (statusFilter === 'ok' && !isOkResult(r)) return false;
        if (statusFilter === 'fail' && isOkResult(r)) return false;
        if (!resultKwLower) return true;
        return (
          variables.some((v) => `${v}=${r.vars?.[v] ?? ''}`.toLowerCase().includes(resultKwLower)) ||
          `${r.status} ${r.statusText ?? ''} ${r.error ?? ''} ${r.body ?? ''}`
            .toLowerCase()
            .includes(resultKwLower)
        );
      }),
    [results, resultKwLower, statusFilter, variables]
  );

  if (!results) return null;

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setResultCollapsed((v) => !v)}
            title={resultCollapsed ? '展开结果' : '折叠结果'}
            className="rounded p-0.5 text-slate-400 transition hover:bg-slate-700/60 hover:text-slate-200 cursor-pointer"
          >
            {resultCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <span className="text-[12px] font-medium text-slate-400">
            执行结果（{results.length} 次，{okCount} 成功 / {failCount} 失败
            {resultKw.trim() || statusFilter !== 'all'
              ? `，显示 ${visibleResults.length} 条`
              : ''}
            ）
          </span>
        </div>

        {!resultCollapsed && (
          <div className="flex flex-wrap items-center gap-2">
            {/* 成功/失败过滤 */}
            <div className="flex items-center gap-1 rounded-md bg-slate-700/40 p-0.5">
              {(
                [
                  ['all', `全部 ${results.length}`],
                  ['ok', `成功 ${okCount}`],
                  ['fail', `失败 ${failCount}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  title={`只看${label.split(' ')[0]}的请求`}
                  className={`rounded px-2 py-0.5 text-[11px] transition cursor-pointer ${
                    statusFilter === key
                      ? 'bg-brand/30 text-brand-light'
                      : 'text-slate-400 hover:bg-slate-700/60 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={resultKw}
                onChange={(e) => setResultKw(e.target.value)}
                placeholder="搜索结果（参数/状态码/响应）"
                className="w-48 rounded-md border border-slate-700/50 bg-slate-800/40 py-1 pl-7 pr-2 text-[11px] text-slate-200 outline-none focus:border-brand/60"
              />
            </div>
          </div>
        )}
      </div>

      {!resultCollapsed && (
        <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-700/40">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-slate-700/50 bg-slate-900/95 text-slate-400">
                <th className="px-2 py-1.5 text-left font-medium">#</th>
                <th className="px-2 py-1.5 text-left font-medium">发送时间</th>
                <th className="px-2 py-1.5 text-left font-medium">状态</th>
                <th className="px-2 py-1.5 text-right font-medium">耗时</th>
                <th className="px-2 py-1.5 text-left font-medium">变量值</th>
                <th className="px-2 py-1.5 text-left font-medium">响应</th>
              </tr>
            </thead>
            <tbody>
              <ResultTable results={visibleResults} variables={variables} />
              {visibleResults.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500">
                    {running && !stopped
                      ? '执行中，等待请求返回…'
                      : '没有符合当前筛选条件的结果'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
