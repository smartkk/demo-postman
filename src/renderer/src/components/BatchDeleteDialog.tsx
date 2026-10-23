import { useState } from 'react';
import { Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  capturedCount: number;
  manualCount: number;
  onConfirm: (onlyCaptured: boolean) => void;
  onCancel: () => void;
}

export function BatchDeleteDialog({
  open,
  capturedCount,
  manualCount,
  onConfirm,
  onCancel,
}: Props) {
  const [onlyCaptured, setOnlyCaptured] = useState(true);
  if (!open) return null;
  const target = onlyCaptured ? capturedCount : capturedCount + manualCount;

  return (
    <div
      data-select-scope
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="glass w-full max-w-sm rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/15">
            <Trash2 size={16} className="text-rose-400" />
          </span>
          <h2 className="text-[15px] font-semibold text-slate-100">批量删除接口</h2>
        </div>

        <div className="space-y-2">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
              onlyCaptured
                ? 'border-brand/50 bg-brand/10'
                : 'border-slate-700/40 bg-slate-800/30'
            }`}
          >
            <input
              type="radio"
              checked={onlyCaptured}
              onChange={() => setOnlyCaptured(true)}
              className="mt-0.5 accent-brand"
            />
            <span className="text-[13px] leading-relaxed text-slate-200">
              仅删除「浏览器抓取」请求
              <span className="ml-1 text-slate-500">（{capturedCount} 个）</span>
            </span>
          </label>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
              !onlyCaptured
                ? 'border-rose-500/50 bg-rose-500/10'
                : 'border-slate-700/40 bg-slate-800/30'
            }`}
          >
            <input
              type="radio"
              checked={!onlyCaptured}
              onChange={() => setOnlyCaptured(false)}
              className="mt-0.5 accent-rose-500"
            />
            <span className="text-[13px] leading-relaxed text-slate-200">
              删除全部请求
              <span className="ml-1 text-slate-500">
                （{capturedCount + manualCount} 个，含 {manualCount} 个手动创建）
              </span>
            </span>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[13px] text-slate-300 transition hover:bg-slate-700/50 cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(onlyCaptured)}
            disabled={target === 0}
            className="rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 px-4 py-2 text-[13px] font-medium text-white shadow-lg shadow-rose-500/30 transition hover:brightness-110 disabled:opacity-40 cursor-pointer"
          >
            删除 {target} 个
          </button>
        </div>
      </div>
    </div>
  );
}
