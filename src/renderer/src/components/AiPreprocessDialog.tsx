import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { BatchRow } from '../../../shared/types';
import { api } from '../api/client';
import { rowsFromAiText } from '../../../shared/params';

/**
 * AI 预处理弹窗：把日志 / 文档等原始数据整理成 JSON 数组形式的参数行。
 *
 * 从 BatchPanel 拆出：弹窗的输入 / 结果 / 忙碌 / 错误状态只服务自身，
 * 与外部仅通过两个回调交互（填充到参数行 / 写入参数文件夹并绑定）。
 */
export function AiPreprocessDialog({
  open,
  onClose,
  onFillRows,
  onWriteFolder,
}: {
  open: boolean;
  onClose: () => void;
  /** 填充到参数行（父组件负责解除文件夹绑定并应用行） */
  onFillRows: (rows: BatchRow[]) => void;
  /** 写入参数文件夹并绑定（父组件负责写盘 + 重新读取文件夹信息） */
  onWriteFolder: (rows: BatchRow[]) => Promise<void>;
}) {
  const [aiData, setAiData] = useState('');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiMeta, setAiMeta] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  // 每次打开都清空上一轮的结果 / 错误（输入保留，便于反复调整）
  useEffect(() => {
    if (open) {
      setAiResult('');
      setAiMeta('');
      setAiError('');
    }
  }, [open]);

  if (!open) return null;

  const runAiPreprocess = async () => {
    if (!aiData.trim()) {
      setAiError('请先粘贴需要预处理的原始数据');
      return;
    }
    setAiBusy(true);
    setAiError('');
    try {
      const r = await api.aiPreprocess({ data: aiData, instruction: aiInstruction });
      setAiResult(r.content);
      setAiMeta(`${r.model} · ${r.durationMs}ms`);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  /** 解析 AI 回复为参数行；失败时把错误显示在弹窗内并返回 null。 */
  const parseOrComplain = (): BatchRow[] | null => {
    const parsed = rowsFromAiText(aiResult);
    if (!parsed || !parsed.length) {
      setAiError('无法从 AI 回复中解析出 JSON 数组，可手动修改结果后重试');
      return null;
    }
    return parsed;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm animate-fade-in"
      onClick={() => !aiBusy && onClose()}
    >
      <div
        className="glass flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
            <Sparkles size={15} className="text-brand-light" /> AI 预处理 → 请求参数
          </h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mb-3 text-[11.5px] leading-relaxed text-slate-400">
          粘贴任意原始数据（日志、文档、表格文本……），AI 会将其整理成{' '}
          <code className="text-brand-light">JSON 数组</code>{' '}
          形式的参数。默认「写入参数文件夹并绑定」：每行参数存为一个文件，执行时按文件名顺序实时读取依次发送；
          也可「填充到参数行」手动编辑。接口在「设置 → AI
          预处理设置」中配置（OpenAI 兼容）。
        </p>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
          <div>
            <label className="mb-1 block text-[12px] text-slate-400">原始数据</label>
            <textarea
              value={aiData}
              onChange={(e) => setAiData(e.target.value)}
              rows={7}
              placeholder={'例：\n2026-10-24 10:00 user=1001 action=login ok\n2026-10-24 10:01 user=1002 action=pay fail\n…'}
              className="w-full resize-none rounded-md border border-slate-700/50 bg-slate-900/60 px-3 py-2 font-mono text-[12px] text-slate-200 outline-none focus:border-brand/60"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-slate-400">
              整理要求（可选，字段名请与批量模板变量一致）
            </label>
            <input
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="例：解析出 userId 与 action 两个字段，每行一条"
              className="w-full rounded-md border border-slate-700/50 bg-slate-800/60 px-3 py-2 text-[12.5px] text-slate-200 outline-none focus:border-brand/60"
            />
          </div>

          {aiError && <div className="text-[12px] text-rose-400">{aiError}</div>}

          {aiResult && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[12px] text-slate-400">解析结果（可手动修改）</label>
                {aiMeta && <span className="text-[10.5px] text-slate-500">{aiMeta}</span>}
              </div>
              <textarea
                value={aiResult}
                onChange={(e) => setAiResult(e.target.value)}
                rows={7}
                className="w-full resize-none rounded-md border border-slate-700/50 bg-slate-900/60 px-3 py-2 font-mono text-[12px] text-slate-200 outline-none focus:border-brand/60"
              />
            </div>
          )}
        </div>

        <div className="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-slate-700/40 pt-3">
          <button
            onClick={onClose}
            disabled={aiBusy}
            className="rounded-lg px-4 py-2 text-[13px] text-slate-300 transition hover:bg-slate-700/50 disabled:opacity-40 cursor-pointer"
          >
            取消
          </button>
          {aiResult ? (
            <>
              <button
                onClick={runAiPreprocess}
                disabled={aiBusy}
                className="rounded-lg border border-brand/40 px-4 py-2 text-[13px] font-medium text-brand-light transition hover:bg-brand/10 disabled:opacity-40 cursor-pointer"
              >
                重新生成
              </button>
              <button
                onClick={() => {
                  const parsed = parseOrComplain();
                  if (parsed) {
                    onFillRows(parsed);
                    onClose();
                  }
                }}
                disabled={aiBusy}
                className="rounded-lg border border-slate-600/60 px-4 py-2 text-[13px] font-medium text-slate-300 transition hover:bg-slate-700/50 disabled:opacity-40 cursor-pointer"
              >
                填充到参数行
              </button>
              <button
                onClick={async () => {
                  const parsed = parseOrComplain();
                  if (!parsed) return;
                  setAiBusy(true);
                  try {
                    await onWriteFolder(parsed);
                    onClose();
                  } catch (e) {
                    setAiError('写入参数文件夹失败：' + (e instanceof Error ? e.message : String(e)));
                  } finally {
                    setAiBusy(false);
                  }
                }}
                disabled={aiBusy}
                className="rounded-lg bg-gradient-to-br from-brand to-brand-light px-4 py-2 text-[13px] font-medium text-white shadow-lg shadow-brand/30 transition hover:brightness-110 disabled:opacity-40 cursor-pointer"
              >
                写入参数文件夹并绑定
              </button>
            </>
          ) : (
            <button
              onClick={runAiPreprocess}
              disabled={aiBusy}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand to-brand-light px-4 py-2 text-[13px] font-medium text-white shadow-lg shadow-brand/30 transition hover:brightness-110 disabled:opacity-40 cursor-pointer"
            >
              {aiBusy ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <Sparkles size={13} />
              )}
              {aiBusy ? '生成中…' : '生成参数'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
