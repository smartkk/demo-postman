import { useEffect, useState } from 'react';
import { Plus, Trash2, Clock, GitBranch, Power } from 'lucide-react';
import { api } from '../api/client';
import type { ScheduleConfig } from '../../../shared/types';
import { EmptyState } from './ui/EmptyState';

interface Props {
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

export function ScheduleList({ activeId, onSelect }: Props) {
  const [schedules, setSchedules] = useState<ScheduleConfig[]>([]);

  const refresh = async () => {
    setSchedules(await api.listSchedules());
  };

  useEffect(() => {
    refresh();
    const off = api.onSchedules((list) => setSchedules(list));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteSchedule = async (id: string) => {
    await api.deleteSchedule(id);
    if (activeId === id) onSelect(null);
  };

  const toggleSchedule = async (id: string) => {
    await api.toggleSchedule(id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-200">
          定时任务
        </span>
        <button
          onClick={() => onSelect(null)}
          title="新建定时任务"
          className="rounded-md bg-brand/20 px-1.5 py-0.5 text-[11px] text-brand-light transition hover:bg-brand/30 cursor-pointer"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {schedules.length === 0 && (
          <div className="py-10">
            <EmptyState
              icon={Clock}
              title="暂无定时任务"
              hint="点击右上角 + 新建，按固定间隔自动调用接口或链式任务。"
            />
          </div>
        )}
        {schedules.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition cursor-pointer ${
              s.id === activeId
                ? 'bg-brand/20 text-brand-light'
                : 'text-slate-300 hover:bg-slate-700/40'
            }`}
            onClick={() => onSelect(s.id)}
          >
            {s.chainId ? (
              <GitBranch size={12} className="shrink-0 text-purple-400" />
            ) : (
              <Clock size={12} className="shrink-0 text-slate-500" />
            )}
            <span className="min-w-0 flex-1 truncate">{s.name || '未命名'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSchedule(s.id);
              }}
              title={s.enabled ? '点击停用' : '点击启用'}
              className={`shrink-0 cursor-pointer transition hover:scale-110 ${
                s.enabled ? 'text-emerald-400' : 'text-slate-600'
              }`}
            >
              <Power size={11} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteSchedule(s.id);
              }}
              className="shrink-0 rounded p-0.5 text-slate-500 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100 cursor-pointer"
              title="删除"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
