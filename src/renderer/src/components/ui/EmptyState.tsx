import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  className?: string;
  action?: React.ReactNode;
}

/**
 * 统一的空状态展示：图标卡片 + 标题 + 说明，供各面板与列表复用，
 * 避免「暂无数据」散落各处、风格不一。
 */
export function EmptyState({ icon: Icon, title, hint, className = '', action }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-8 text-center ${className}`}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/60">
        <Icon size={22} className="text-slate-500" />
      </div>
      <h3 className="mb-1.5 text-[13.5px] font-medium text-slate-300">{title}</h3>
      {hint && <p className="max-w-xs text-[12px] leading-relaxed text-slate-500">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
