export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'POST':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    case 'PUT':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'DELETE':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    case 'PATCH':
      return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
    default:
      return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  }
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  return `${d}天前`;
}
