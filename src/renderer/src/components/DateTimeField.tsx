import { useEffect, useRef, useState } from 'react';
import { Calendar, X } from 'lucide-react';

interface Props {
  value: string; // datetime-local 格式: YYYY-MM-DDTHH:mm
  onChange: (v: string) => void;
  placeholder?: string;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n: number) => String(n).padStart(2, '0');

function parse(v: string): { y: number; m: number; d: number; hh: number; mm: number } | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return {
    y: +m[1],
    m: +m[2],
    d: +m[3],
    hh: +m[4],
    mm: +m[5],
  };
}

export function DateTimeField({ value, onChange, placeholder = '点击选择开始时间' }: Props) {
  const parsed = parse(value);
  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(parsed ? parsed.y : new Date().getFullYear());
  const [viewM, setViewM] = useState(parsed ? parsed.m - 1 : new Date().getMonth());
  const [selDay, setSelDay] = useState<number | null>(
    parsed ? parsed.d : new Date().getDate(),
  );
  const [hh, setHh] = useState(parsed ? parsed.hh : 0);
  const [mm, setMm] = useState(parsed ? parsed.mm : 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const firstDay = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const confirmDate = (day: number) => {
    setSelDay(day);
    const next = `${viewY}-${pad(viewM + 1)}-${pad(day)}T${pad(hh)}:${pad(mm)}`;
    onChange(next);
  };

  const display = parsed
    ? `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)} ${pad(parsed.hh)}:${pad(parsed.mm)}`
    : '';

  const shift = (delta: number) => {
    const d = new Date(viewY, viewM + delta, 1);
    setViewY(d.getFullYear());
    setViewM(d.getMonth());
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-800/60 px-2.5 py-2 text-left text-[13px] text-slate-200 outline-none transition hover:border-slate-600 focus:border-brand/60"
      >
        <Calendar size={14} className="shrink-0 text-slate-500" />
        <span className={display ? 'text-slate-200' : 'text-slate-500'}>
          {display || placeholder}
        </span>
        {display && (
          <X
            size={13}
            className="ml-auto shrink-0 text-slate-500 transition hover:text-slate-300"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
          />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[260px] rounded-xl border border-slate-700/60 bg-slate-900/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-md">
          {/* 月份切换 */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="rounded-md px-2 py-1 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
            >
              ‹
            </button>
            <span className="text-[13px] font-medium text-slate-200">
              {viewY} 年 {viewM + 1} 月
            </span>
            <button
              type="button"
              onClick={() => shift(1)}
              className="rounded-md px-2 py-1 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
            >
              ›
            </button>
          </div>

          {/* 星期 */}
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] text-slate-500">
            {WEEK.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>

          {/* 日期格子 */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day == null) return <div key={i} />;
              const isSel =
                selDay === day &&
                parsed &&
                parsed.y === viewY &&
                parsed.m === viewM + 1;
              const isToday =
                new Date().getFullYear() === viewY &&
                new Date().getMonth() === viewM &&
                new Date().getDate() === day;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => confirmDate(day)}
                  className={[
                    'rounded-md py-1 text-[12px] transition',
                    isSel
                      ? 'bg-brand text-white'
                      : 'text-slate-300 hover:bg-slate-700/60',
                    !isSel && isToday ? 'ring-1 ring-inset ring-brand/40' : '',
                  ].join(' ')}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* 时间选择 */}
          <div className="mt-3 flex items-center gap-2 border-t border-slate-700/50 pt-3">
            <span className="text-[12px] text-slate-400">时间</span>
            <input
              type="number"
              min={0}
              max={23}
              value={hh}
              onChange={(e) => setHh(Math.min(23, Math.max(0, +e.target.value || 0)))}
              className="w-12 rounded-md border border-slate-700/50 bg-slate-800/60 px-2 py-1 text-center text-[13px] text-slate-200 outline-none focus:border-brand/60"
            />
            <span className="text-slate-400">:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={mm}
              onChange={(e) => setMm(Math.min(59, Math.max(0, +e.target.value || 0)))}
              className="w-12 rounded-md border border-slate-700/50 bg-slate-800/60 px-2 py-1 text-center text-[13px] text-slate-200 outline-none focus:border-brand/60"
            />
            <button
              type="button"
              onClick={() => {
                const day =
                  selDay ??
                  (parsed && parsed.y === viewY && parsed.m === viewM + 1
                    ? parsed.d
                    : new Date().getDate());
                confirmDate(day);
                setOpen(false);
              }}
              className="ml-auto rounded-md bg-brand/80 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-brand"
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
