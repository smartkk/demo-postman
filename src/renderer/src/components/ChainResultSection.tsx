import { X } from 'lucide-react';
import { selectPreOnClick } from '../lib/select';
import type { ChainRunResult } from '../../../shared/types';

/** 结果状态徽章（模块级纯函数，无闭包依赖）。 */
function statusBadge(r: ChainRunResult) {
  if (r.error) return { text: '错误', cls: 'bg-red-500/20 text-red-400' };
  if (r.status >= 200 && r.status < 400)
    return { text: `${r.status}`, cls: 'bg-emerald-500/20 text-emerald-400' };
  if (r.status >= 400)
    return { text: `${r.status}`, cls: 'bg-yellow-500/20 text-yellow-400' };
  return { text: `${r.status}`, cls: 'bg-slate-700 text-slate-400' };
}

/** 美化 JSON 字符串，失败则原样返回。 */
function prettyJson(raw?: string | null) {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** 结果详情分节小组件 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-medium text-slate-400">{title}</div>
      {children}
    </div>
  );
}

/**
 * 链式执行结果区：结果汇总表 + 单步详情抽屉。
 * 从 ChainPanel 抽出的自洽展示组件，内部自带状态徽章 / JSON 美化等辅助函数。
 */
export function ChainResultSection({
  results,
  totalSteps,
  viewResult,
  onViewResult,
}: {
  results: ChainRunResult[];
  totalSteps: number;
  viewResult: ChainRunResult | null;
  onViewResult: (r: ChainRunResult | null) => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-slate-400">
        执行结果（{results.length}/{totalSteps} 步，
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
                  onClick={() => onViewResult(r)}
                  title="点击查看完整请求 / 响应"
                  className="cursor-pointer border-b border-slate-800/60 text-slate-300 transition hover:bg-slate-700/30"
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
                    <span className="ml-1 text-[10px] text-brand-light/70">查看 ›</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 单步结果详情抽屉 */}
      {viewResult && (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-700/50 bg-slate-800/40">
          <div className="flex items-center gap-2 border-b border-slate-700/50 px-3 py-2">
            <span className="text-[12px] font-medium text-slate-200">
              第 {viewResult.index + 1} 步 · {viewResult.name || viewResult.stepId}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                statusBadge(viewResult).cls
              }`}
            >
              {viewResult.error ? '错误' : viewResult.status || '-'}
            </span>
            <span className="text-[11px] text-slate-500">
              {viewResult.durationMs}ms · {viewResult.at}
            </span>
            <button
              onClick={() => onViewResult(null)}
              className="ml-auto rounded p-1 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-100 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          <div className="max-h-[340px] space-y-3 overflow-y-auto p-3">
            {/* 实际请求 */}
            <Section title="实际发送请求">
              <div className="mb-1 font-mono text-[11.5px] text-brand-light">
                {viewResult.request.method}{' '}
                <span className="text-slate-300">{viewResult.request.url}</span>
              </div>
              {viewResult.request.headers &&
                Object.keys(viewResult.request.headers).length > 0 && (
                  <div className="mb-1">
                    <div className="mb-0.5 text-[11px] text-slate-500">Headers</div>
                    <pre onClick={selectPreOnClick} className="whitespace-pre-wrap break-all rounded-md bg-slate-900/50 p-2 font-mono text-[11px] text-slate-300">
                      {Object.entries(viewResult.request.headers)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join('\n')}
                    </pre>
                  </div>
                )}
              {viewResult.request.body && (
                <div>
                  <div className="mb-0.5 text-[11px] text-slate-500">Body</div>
                  <pre onClick={selectPreOnClick} className="max-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-900/50 p-2 font-mono text-[11px] text-slate-300">
                    {prettyJson(viewResult.request.body)}
                  </pre>
                </div>
              )}
              {!viewResult.request.body && (
                <div className="text-[11px] text-slate-500">（无请求体）</div>
              )}
            </Section>

            {/* 提取变量 */}
            <Section title="提取的变量">
              {Object.entries(viewResult.extracted).length > 0 ? (
                <pre onClick={selectPreOnClick} className="whitespace-pre-wrap break-all rounded-md bg-slate-900/50 p-2 font-mono text-[11px] text-slate-300">
                  {Object.entries(viewResult.extracted)
                    .map(([k, v]) => `${k} = ${v}`)
                    .join('\n')}
                </pre>
              ) : (
                <div className="text-[11px] text-slate-500">（无提取变量）</div>
              )}
            </Section>

            {/* 响应 */}
            <Section title="响应">
              {viewResult.error ? (
                <pre onClick={selectPreOnClick} className="whitespace-pre-wrap break-all rounded-md bg-rose-500/10 p-2 font-mono text-[11px] text-rose-300">
                  {viewResult.error}
                </pre>
              ) : viewResult.body ? (
                <pre onClick={selectPreOnClick} className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-900/50 p-2 font-mono text-[11px] text-slate-300">
                  {prettyJson(viewResult.body)}
                </pre>
              ) : (
                <div className="text-[11px] text-slate-500">（无响应体）</div>
              )}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
