import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';

interface Props {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  placeholderKey?: string;
  placeholderValue?: string;
}

type Entry = [string, string];

function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

export function KeyValueEditor({
  value,
  onChange,
  placeholderKey = 'key',
  placeholderValue = 'value',
}: Props) {
  // 内部维护可包含空行的 entries，保证「添加一行」后能正常渲染与编辑。
  // 仅在提交给父组件时剔除空 key 行，父组件的 value（Record）保持干净。
  const [entries, setEntries] = useState<Entry[]>(() => Object.entries(value));

  // 当父组件的值发生外部变更（例如 curl 导入）时，重新同步内部状态。
  // 通过对比「父值」与「内部 entries 去空后」是否一致来判断是否为外部变更。
  useEffect(() => {
    const stripped: Record<string, string> = {};
    for (const [k, v] of entries) if (k.trim()) stripped[k] = v;
    if (!sameRecord(value, stripped)) {
      setEntries(Object.entries(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: Entry[]) => {
    setEntries(next);
    const obj: Record<string, string> = {};
    for (const [k, v] of next) if (k.trim()) obj[k] = v;
    onChange(obj);
  };

  const setAt = (idx: number, field: 0 | 1, text: string) => {
    const next = entries.map((e, i) =>
      i === idx ? ([field === 0 ? text : e[0], field === 1 ? text : e[1]] as Entry) : e
    );
    commit(next);
  };

  const removeAt = (idx: number) => commit(entries.filter((_, i) => i !== idx));
  const addRow = () => commit([...entries, ['', '']]);

  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={k}
            onChange={(e) => setAt(i, 0, e.target.value)}
            placeholder={placeholderKey}
            className="w-2/5 rounded-md border border-slate-700/50 bg-slate-800/40 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-brand/60"
          />
          <input
            value={v}
            onChange={(e) => setAt(i, 1, e.target.value)}
            placeholder={placeholderValue}
            className="min-w-0 flex-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-brand/60"
          />
          <button
            onClick={() => removeAt(i)}
            className="shrink-0 rounded-md p-1.5 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-brand-light transition hover:bg-brand/10 cursor-pointer"
      >
        <Plus size={13} /> 添加一行
      </button>
    </div>
  );
}
