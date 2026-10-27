import { Plus, Trash2 } from 'lucide-react';

/**
 * 行内键值编辑器（ChainPanel 头部 Headers 等场景）。
 * 从 ChainPanel 抽出的自洽小组件：仅依赖 props 与图标，无闭包依赖。
 */
export function KVEditorInline({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const entries = Object.entries(value);
  const setAt = (i: number, k: string, v: string) => {
    const next: Record<string, string> = {};
    entries.forEach(([ek, ev], idx) => {
      if (idx === i) next[k] = v;
      else next[ek] = ev;
    });
    onChange(next);
  };
  const setVal = (i: number, v: string) => {
    const next: Record<string, string> = {};
    entries.forEach(([ek, ev], idx) => (next[ek] = idx === i ? v : ev));
    onChange(next);
  };
  const add = () => onChange({ ...value, '': '' });
  const remove = (k: string) => {
    const next = { ...value };
    delete next[k];
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <input
            value={k}
            onChange={(e) => setAt(i, e.target.value, v)}
            placeholder="Header"
            className="w-1/3 rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand/60"
          />
          <input
            value={v}
            onChange={(e) => setVal(i, e.target.value)}
            placeholder="值（可含 {{var}}）"
            className="flex-1 rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand/60"
          />
          <button
            onClick={() => remove(k)}
            className="text-slate-500 transition hover:text-rose-400 cursor-pointer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1 text-[11px] text-slate-400 transition hover:text-slate-200 cursor-pointer"
      >
        <Plus size={12} /> 添加 Header
      </button>
    </div>
  );
}
