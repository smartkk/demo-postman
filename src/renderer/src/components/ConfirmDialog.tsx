import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = true,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="glass w-full max-w-sm rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          {danger && (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/15">
              <AlertTriangle size={16} className="text-rose-400" />
            </span>
          )}
          <h2 className="text-[15px] font-semibold text-slate-100">{title}</h2>
        </div>
        <p className="mb-5 text-[13px] leading-relaxed text-slate-300">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[13px] text-slate-300 transition hover:bg-slate-700/50 cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-[13px] font-medium text-white shadow-lg transition hover:brightness-110 cursor-pointer ${
              danger
                ? 'bg-gradient-to-br from-rose-500 to-rose-600 shadow-rose-500/30'
                : 'bg-gradient-to-br from-brand to-brand-light shadow-brand/30'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
