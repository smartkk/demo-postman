import { useRef, useState } from 'react';
import {
  Search,
  Trash2,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Star,
  Download,
  Upload,
  CheckSquare,
  X,
  ArrowRight,
  ListFilter,
  ArrowUpDown,
  SlidersHorizontal,
  Clock,
  GitBranch,
  Layers,
  Inbox,
} from 'lucide-react';
import type { InterfaceRecord } from '../../../shared/types';
import type {
  SortKey,
  StatusFilter,
} from '../store/useInterfaces';
import { methodColor, relTime } from './method';
import { Select } from './ui/Select';
import { ConfirmDialog } from './ConfirmDialog';
import { BatchDeleteDialog } from './BatchDeleteDialog';
import { showToast } from './ui/Toast';
import { ChainList } from './ChainList';
import { BatchList } from './BatchList';
import { ScheduleList } from './ScheduleList';

type ViewKey = 'interfaces' | 'schedules' | 'chains' | 'batches';

interface Props {
  store: ReturnType<typeof import('../store/useInterfaces').useInterfaces>;
  view: ViewKey;
  onChangeView: (v: ViewKey) => void;
  activeIds: { chains?: string | null; batches?: string | null; schedules?: string | null };
  onSelect: (view: ViewKey, id: string | null) => void;
}

const NAV_ITEMS: { key: ViewKey; label: string; icon: typeof Inbox }[] = [
  { key: 'interfaces', label: '接口', icon: Inbox },
  { key: 'schedules', label: '定时', icon: Clock },
  { key: 'chains', label: '链式', icon: GitBranch },
  { key: 'batches', label: '批量', icon: Layers },
];

const METHODS = ['ALL', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'updated', label: '最近更新' },
  { key: 'calls', label: '调用次数' },
  { key: 'name', label: '名称' },
  { key: 'method', label: '方法' },
];
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部状态' },
  { key: 'success', label: '成功(2xx/3xx)' },
  { key: 'fail', label: '失败(4xx/5xx)' },
  { key: 'none', label: '无响应' },
];

function statusDot(status: number | undefined): string {
  const st = status ?? 0;
  if (st === 0) return 'bg-slate-600';
  if (st >= 200 && st < 400) return 'bg-emerald-400';
  return 'bg-rose-400';
}

export function Sidebar({ store, view, onChangeView, activeIds, onSelect }: Props) {
  const {
    filtered,
    selectedId,
    setSelectedId,
    keyword,
    setKeyword,
    methodFilter,
    setMethodFilter,
    sort,
    setSort,
    statusFilter,
    setStatusFilter,
    folders,
    selectedIds,
    toggleSelect,
    clearSelect,
    moveSelectedToFolder,
    deleteOne,
    deleteBySource,
    createFolder,
    deleteFolder,
    exportCollection,
    importCollection,
    togglePin,
  } = store;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [managing, setManaging] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: 'record'; id: string; label: string } | { kind: 'folder'; name: string } | null
  >(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const capturedCount = filtered.filter((it) => it.source === 'captured').length;
  const manualCount = filtered.length - capturedCount;

  const [showFilters, setShowFilters] = useState(false);

  const present = new Set(filtered.map((it) => it.folder || ''));
  const customFolders = [...folders];
  for (const f of customFolders) present.delete(f);
  const extra = [...present].filter((f) => f !== '').sort();
  const groupOrder = [...customFolders, ...extra, ''];

  const toggle = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const commitCreate = () => {
    const n = newName.trim();
    if (n) createFolder(n);
    setNewName('');
    setCreating(false);
  };

  const doConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === 'record') deleteOne(confirm.id);
    else deleteFolder(confirm.name);
    setConfirm(null);
  };

  const doBatch = (onlyCaptured: boolean) => {
    // 仅删抓取：只清 captured；删除全部：先清 captured 再清 manual
    deleteBySource('captured');
    if (!onlyCaptured) deleteBySource('manual');
    setBatchOpen(false);
  };

  const doExport = async () => {
    const data = await exportCollection();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `demo-postman-collection-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(String(reader.result));
        await importCollection(data);
        showToast('集合导入成功', 'success');
      } catch (e) {
        showToast('导入失败：文件不是合法的集合 JSON', 'error');
      }
    };
    reader.readAsText(file);
  };

  const renderItem = (it: InterfaceRecord) => {
    const checked = selectedIds.has(it.id);
    const selected = selectedId === it.id;
    return (
      <div
        key={it.id}
        className={`group mb-1 flex w-full items-start gap-2 rounded-lg border-l-2 px-3 py-2.5 text-left transition ${
          selected ? 'border-brand bg-brand/10' : 'border-transparent hover:bg-slate-700/30'
        }`}
      >
        {managing && (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleSelect(it.id)}
            className="mt-1 shrink-0 accent-brand cursor-pointer"
          />
        )}
        <button
          onClick={() => (managing ? toggleSelect(it.id) : setSelectedId(it.id))}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span
            className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${methodColor(
              it.method
            )}`}
          >
            {it.method}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="block truncate text-[12.5px] text-slate-200">
                {it.name || it.path}
              </span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(
                  it.lastResponse?.status
                )}`}
                title={`状态 ${it.lastResponse?.status ?? '无'}`}
              />
            </span>
            <span className="block truncate text-[11px] text-slate-500">{it.host}</span>
            <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-slate-600">
              <span>×{it.callCount}</span>
              <span>{relTime(it.lastUpdated)}</span>
              <span
                className={`rounded px-1 py-0.5 text-[9.5px] ${
                  it.source === 'manual'
                    ? 'bg-brand/15 text-brand-light'
                    : 'bg-slate-700/50 text-slate-400'
                }`}
              >
                {it.source === 'manual' ? '手动' : '抓取'}
              </span>
            </span>
          </span>
        </button>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            togglePin(it.id);
          }}
          className={`mt-1 shrink-0 rounded p-1 transition cursor-pointer ${
            it.pinned
              ? 'text-amber-300'
              : 'text-slate-600 opacity-0 hover:text-slate-300 group-hover:opacity-100'
          }`}
          title={it.pinned ? '取消收藏' : '收藏置顶'}
        >
          <Star size={13} fill={it.pinned ? 'currentColor' : 'none'} />
        </span>
        {!managing && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setConfirm({ kind: 'record', id: it.id, label: it.name || it.path });
            }}
            className="mt-1 hidden shrink-0 rounded p-1 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-400 group-hover:block cursor-pointer"
            title="删除该接口"
          >
            <Trash2 size={13} />
          </span>
        )}
      </div>
    );
  };

  return (
    <aside className="glass flex h-full w-full flex-col">
      {/* ── 视图导航 ── */}
      <div className="flex shrink-0 gap-1 border-b border-slate-700/40 px-2.5 py-2">
        {NAV_ITEMS.map((it) => {
          const Icon = it.icon;
          const active = view === it.key;
          return (
            <button
              key={it.key}
              onClick={() => onChangeView(it.key)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[12px] font-medium transition cursor-pointer ${
                active
                  ? 'bg-brand/20 text-brand-light'
                  : 'text-slate-400 hover:bg-slate-700/40 hover:text-slate-200'
              }`}
              title={it.label}
            >
              <Icon size={14} className="shrink-0" />
              <span>{it.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── 仅接口视图展示搜索 / 列表 ── */}
      {view === 'interfaces' && (
        <>
        <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            id="search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索接口 / 域名 / 名称…"
            className="w-full rounded-lg border border-slate-700/50 bg-slate-800/40 py-2 pl-9 pr-3 text-[13px] text-slate-200 outline-none transition focus:border-brand/60 focus:bg-slate-800/70"
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 pb-2">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-500">
          共 <span className="text-slate-300 font-medium">{filtered.length}</span> 个接口
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* 导入 */}
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200 cursor-pointer"
            title="导入集合"
          >
            <Upload size={14} />
          </button>
          {/* 导出 */}
          <button
            onClick={doExport}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200 cursor-pointer"
            title="导出集合"
          >
            <Download size={14} />
          </button>
          {/* 分隔 */}
          <span className="mx-0.5 h-4 w-px bg-slate-700/60" />
          {/* 新建分组 */}
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200 cursor-pointer"
            title="新建分组"
          >
            <FolderPlus size={14} />
          </button>
          {/* 选择管理 */}
          <button
            onClick={() => setManaging((v) => !v)}
            className={`rounded-md p-1.5 transition cursor-pointer ${
              managing ? 'bg-brand/20 text-brand-light' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
            }`}
            title={managing ? '退出选择' : '选择管理'}
          >
            <CheckSquare size={14} />
          </button>
          {/* 批量删除 */}
          <button
            onClick={() => setBatchOpen(true)}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer"
            title="批量删除"
          >
            <Trash2 size={14} />
          </button>
          {/* 筛选器切换 */}
          <span className="mx-0.5 h-4 w-px bg-slate-700/60" />
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`rounded-md p-1.5 transition cursor-pointer ${
              showFilters ? 'bg-brand/20 text-brand-light' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
            }`}
            title="筛选器"
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImport(f);
            e.target.value = '';
          }}
        />
      </div>

      {showFilters && (
        <div className="space-y-2 border-b border-slate-700/40 px-3 pb-3">
          {/* 方法筛选 */}
          <div className="flex items-center gap-1 overflow-x-auto">
            {METHODS.map((m) => (
              <button
                key={m}
                onClick={() => setMethodFilter(m)}
                className={`shrink-0 rounded px-2 py-0.5 text-[10.5px] font-medium transition cursor-pointer ${
                  methodFilter === m
                    ? 'bg-brand/25 text-brand-light'
                    : 'bg-slate-800/60 text-slate-400 hover:bg-slate-700/60'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {/* 排序 + 状态 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <ArrowUpDown size={11} className="text-slate-500 shrink-0" />
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                wrapperClassName="relative shrink-0 flex-1"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <ListFilter size={11} className="text-slate-500 shrink-0" />
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                wrapperClassName="relative shrink-0 flex-1"
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      )}

      {managing && selectedIds.size > 0 && (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-md border border-brand/40 bg-brand/10 px-2 py-1.5 text-[11.5px] text-slate-200">
          <span className="flex-1">已选 {selectedIds.size} 项</span>
          <div className="flex items-center gap-1">
            <ArrowRight size={12} className="text-slate-400" />
            <Select
              value=""
              onChange={(e) => {
                // '' = 未选择（占位）；__ungrouped__ = 移到「未分组」
                const v = e.target.value;
                if (v === '__ungrouped__') moveSelectedToFolder('');
                else if (v) moveSelectedToFolder(v);
              }}
              wrapperClassName="relative shrink-0"
            >
              <option value="">移至分组…</option>
              <option value="__ungrouped__">未分组</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </div>
          <button
            onClick={clearSelect}
            className="rounded p-0.5 text-slate-400 hover:text-slate-200 cursor-pointer"
            title="取消选择"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {creating && (
        <div className="px-3 pb-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCreate();
              if (e.key === 'Escape') {
                setNewName('');
                setCreating(false);
              }
            }}
            placeholder="分组名称，回车确认"
            className="w-full rounded-md border border-brand/40 bg-slate-800/40 px-3 py-1.5 text-[12.5px] outline-none focus:border-brand/60"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] leading-relaxed text-slate-500">
            暂无接口记录
            <br />
            开启代理并访问接口，或点击右上角「手动录入」
          </div>
        ) : (
          groupOrder.map((f) => {
            const items = filtered.filter((it) => (it.folder || '') === f);
            if (items.length === 0) return null;
            const isUngrouped = f === '';
            const title = isUngrouped ? '未分组' : f;
            const key = isUngrouped ? '__ungrouped__' : f;
            const isCollapsed = collapsed[key];
            return (
              <div key={key} className="mb-1">
                <div
                  className="flex cursor-pointer items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-400 transition hover:text-slate-200"
                  onClick={() => toggle(key)}
                >
                  {isCollapsed ? (
                    <ChevronRight size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                  <span className="flex-1">{title}</span>
                  <span className="text-slate-600">{items.length}</span>
                  {!isUngrouped && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirm({ kind: 'folder', name: f });
                      }}
                      className="rounded p-0.5 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer"
                      title="删除分组（接口移至未分组）"
                    >
                      <Trash2 size={12} />
                    </span>
                  )}
                </div>
                {!isCollapsed && items.map(renderItem)}
              </div>
            );
          })
        )}
      </div>
      </>
      )}

      {view === 'chains' && (
        <ChainList
          activeId={activeIds.chains ?? null}
          onSelect={(id) => onSelect('chains', id)}
        />
      )}
      {view === 'batches' && (
        <BatchList
          activeId={activeIds.batches ?? null}
          onSelect={(id) => onSelect('batches', id)}
        />
      )}
      {view === 'schedules' && (
        <ScheduleList
          activeId={activeIds.schedules ?? null}
          onSelect={(id) => onSelect('schedules', id)}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'folder' ? '删除分组' : '删除接口'}
        message={
          confirm?.kind === 'folder'
            ? `确认删除分组「${confirm.name}」？该分组下的接口将移至「未分组」。`
            : `确认删除接口「${confirm?.kind === 'record' ? confirm.label : ''}」？该操作不可撤销。`
        }
        confirmText="删除"
        onConfirm={doConfirm}
        onCancel={() => setConfirm(null)}
      />

      <BatchDeleteDialog
        open={batchOpen}
        capturedCount={capturedCount}
        manualCount={manualCount}
        onConfirm={doBatch}
        onCancel={() => setBatchOpen(false)}
      />
    </aside>
  );
}
