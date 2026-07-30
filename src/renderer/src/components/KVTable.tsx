interface Props {
  data: Record<string, string>;
}

export function KVTable({ data }: Props) {
  const entries = Object.entries(data);
  if (entries.length === 0)
    return <div className="py-8 text-center text-[12px] text-slate-600">无数据</div>;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700/40">
      {entries.map(([k, v], i) => (
        <div
          key={k}
          className={`flex gap-3 px-3 py-2 text-[12.5px] ${
            i % 2 ? 'bg-slate-800/30' : 'bg-transparent'
          }`}
        >
          <span className="w-1/3 shrink-0 break-all font-medium text-brand-light">
            {k}
          </span>
          <span className="min-w-0 flex-1 break-all text-slate-300">{v}</span>
        </div>
      ))}
    </div>
  );
}
