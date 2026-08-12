import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';

interface Props {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  placeholderKey?: string;
  placeholderValue?: string;
}

interface Entry {
  id: string;
  k: string;
  v: string;
}

let uidSeq = 0;
function newId(): string {
  uidSeq += 1;
  return `kv_${Date.now().toString(36)}_${uidSeq}`;
}

function recordsToEntries(value: Record<string, string>): Entry[] {
  const list = Object.entries(value).map(([k, v]) => ({ id: newId(), k, v }));
  // 末尾保留一行空行，方便直接继续录入。
  return [...list, { id: newId(), k: '', v: '' }];
}

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
  // 内部维护带稳定 id 的 entries（可包含空行），保证「添加一行」后正常渲染与编辑，
  // 且中间删除/编辑不会因 index 复用导致输入错位。仅在提交父组件时剔除空 key 行。
  const [entries, setEntries] = useState<Entry[]>(() => recordsToEntries(value));

  // 当父组件的值发生外部变更（例如 curl 导入）时，重新同步内部状态。
  useEffect(() => {
    const stripped: Record<string, string> = {};
    for (const e of entries) if (e.k.trim()) stripped[e.k] = e.v;
    if (!sameRecord(value, stripped)) {
      setEntries(recordsToEntries(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: Entry[]) => {
    setEntries(next);
    const obj: Record<string, string> = {};
    for (const e of next) if (e.k.trim()) obj[e.k] = e.v;
    onChange(obj);
  };

  const setAt = (id: string, field: 'k' | 'v', text: string) => {
    commit(entries.map((e) => (e.id === id ? { ...e, [field]: text } : e)));
  };

  const removeAt = (id: string) => commit(entries.filter((e) => e.id !== id));
  const addRow = () => commit([...entries, { id: newId(), k: '', v: '' }]);

  return (
    <div className="space-y-1.5">
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-2">
          <input
            value={e.k}
            onChange={(ev) => setAt(e.id, 'k', ev.target.value)}
            placeholder={placeholderKey}
            className="w-2/5 rounded-md border border-slate-700/50 bg-slate-800/40 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-brand/60"
          />
          <input
            value={e.v}
            onChange={(ev) => setAt(e.id, 'v', ev.target.value)}
            placeholder={placeholderValue}
            className="min-w-0 flex-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-brand/60"
          />
          <button
            onClick={() => removeAt(e.id)}
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
