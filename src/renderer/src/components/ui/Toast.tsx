import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  msg: string;
}

let seq = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** 全局触发 toast（任意模块可直接调用，无需经过 React 组件树）。 */
export function showToast(msg: string, kind: ToastKind = 'info') {
  const item: ToastItem = { id: ++seq, kind, msg };
  listeners.forEach((fn) => fn(item));
  // 兜底：若没有 React 订阅者，至少打印到控制台，避免完全无声。
  if (listeners.size === 0) {
    // eslint-disable-next-line no-console
    console[kind === 'error' ? 'error' : 'warn']('[toast]', msg);
  }
}

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
};
const ICON_CLS = {
  info: 'text-sky-400',
  success: 'text-emerald-400',
  error: 'text-rose-400',
};
const BAR_CLS = {
  info: 'bg-sky-400',
  success: 'bg-emerald-400',
  error: 'bg-rose-400',
};

/** 全局错误兜底：未捕获的 Promise 拒绝统一弹出 toast，避免「点了没反应」。 */
export function installGlobalErrorToast() {
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : '发生未知错误';
    showToast(msg || '请求失败', 'error');
  });
  window.addEventListener('error', (e) => {
    const msg = e.message || '发生未知错误';
    showToast(msg, 'error');
  });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onAdd = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, 3800);
    };
    listeners.add(onAdd);
    return () => {
      listeners.delete(onAdd);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[90vw] flex-col gap-2">
      {items.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-lg border border-slate-700/60 bg-slate-800/95 px-3.5 py-2.5 shadow-2xl shadow-black/40 backdrop-blur"
          >
            <span className={`mt-0.5 shrink-0 ${ICON_CLS[t.kind]}`}>
              <Icon size={16} />
            </span>
            <span className="min-w-0 flex-1 break-words text-[12.5px] leading-snug text-slate-200">
              {t.msg}
            </span>
            <span className={`absolute left-0 top-0 h-full w-1 ${BAR_CLS[t.kind]}`} />
          </div>
        );
      })}
    </div>
  );
}
