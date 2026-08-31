import { ChevronDown } from 'lucide-react';
import { SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** 透传到外层 wrapper 的尺寸/布局类，如 w-full / flex-1 / shrink-0 / w-[200px] */
  wrapperClassName?: string;
}

/**
 * 统一风格的下拉框：自定义箭头、聚焦高亮、悬停反馈，
 * 与项目 input / button 视觉保持一致。
 */
export function Select({ className = '', wrapperClassName = 'relative w-full', children, ...rest }: SelectProps) {
  return (
    <div className={wrapperClassName}>
      <select
        {...rest}
        className={`w-full cursor-pointer appearance-none rounded-lg border border-slate-700/50 bg-slate-800/60 py-2 pl-3 pr-8 text-[13px] text-slate-200 outline-none transition hover:border-slate-600 focus:border-brand/60 focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}
