import { useEffect, useState } from 'react';
import { Plus, FolderPlus, Folder, Trash2, GitBranch } from 'lucide-react';
import { api } from '../api/client';
import type { ChainProject } from '../../../shared/types';
import { EmptyState } from './ui/EmptyState';

interface Props {
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

export function ChainList({ activeId, onSelect }: Props) {
  const [projects, setProjects] = useState<ChainProject[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState('');

  const refresh = async () => {
    const [list, f] = await Promise.all([api.listChains(), api.listChainFolders()]);
    setProjects(list);
    setFolders(f);
  };

  useEffect(() => {
    refresh();
    const off = api.onChains((list, f) => {
      setProjects(list);
      setFolders(f);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setNewFolderName('');
    await api.createChainFolder(name);
    await refresh();
  };

  const deleteProject = async (id: string) => {
    await api.deleteChain(id);
    if (activeId === id) onSelect(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-200">
          链式任务
        </span>
        <button
          onClick={() => onSelect(null)}
          title="新建空白任务"
          className="rounded-md bg-brand/20 px-1.5 py-0.5 text-[11px] text-brand-light transition hover:bg-brand/30 cursor-pointer"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="px-3 pb-2">
        <div className="flex gap-1">
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="新文件夹名"
            className="min-w-0 flex-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-2 py-1 text-[11px] outline-none focus:border-brand/60"
          />
          <button
            onClick={addFolder}
            title="新建文件夹"
            className="rounded-md bg-slate-700/50 px-1.5 py-1 text-slate-300 transition hover:bg-slate-700 cursor-pointer"
          >
            <FolderPlus size={13} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 && (
          <div className="py-10">
            <EmptyState
              icon={GitBranch}
              title="暂无链式任务"
              hint="点击右上角 + 新建，把多个接口按顺序串成工作流（如先登录再调业务接口）。"
            />
          </div>
        )}
        {folders.map((f) => {
          const items = projects.filter((p) => p.folder === f);
          if (items.length === 0) return null;
          return (
            <div key={f} className="mb-1.5">
              <div className="flex items-center gap-1 px-1 py-1 text-[10.5px] uppercase tracking-wide text-slate-500">
                <Folder size={11} /> {f}
              </div>
              {items.map((p) => (
                <ChainRow
                  key={p.id}
                  p={p}
                  active={p.id === activeId}
                  onOpen={() => onSelect(p.id)}
                  onDelete={() => deleteProject(p.id)}
                />
              ))}
            </div>
          );
        })}
        {projects
          .filter((p) => !p.folder)
          .map((p) => (
            <ChainRow
              key={p.id}
              p={p}
              active={p.id === activeId}
              onOpen={() => onSelect(p.id)}
              onDelete={() => deleteProject(p.id)}
            />
          ))}
      </div>
    </div>
  );
}

function ChainRow({
  p,
  active,
  onOpen,
  onDelete,
}: {
  p: ChainProject;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] transition cursor-pointer ${
        active ? 'bg-brand/20 text-brand-light' : 'text-slate-300 hover:bg-slate-700/40'
      }`}
      onClick={onOpen}
    >
      <span className="min-w-0 flex-1 truncate">{p.name || '未命名'}</span>
      <span className="shrink-0 text-[10px] text-slate-500">{p.steps?.length ?? 0} 步</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="shrink-0 rounded p-0.5 text-slate-500 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100 cursor-pointer"
        title="删除"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
