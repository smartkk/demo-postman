import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { CaptureInput, InterfaceRecord, InterfaceSummary } from '../../../shared/types';

export type SortKey = 'updated' | 'calls' | 'name' | 'method';
export type StatusFilter = 'all' | 'success' | 'fail' | 'none';

/** 搜索时每条记录的响应体最多参与匹配的字符数。 */
const SEARCH_BODY_LIMIT = 2048;

/**
 * 选中记录的摘要是否发生变化（变化才刷新详情）。
 * 抓取是高频路径：只有当前选中接口自身发生了变化才值得再拉一次完整记录，
 * 否则每次别的接口被捕获都触发一次 getDetail，IPC 压力与列表推送同阶。
 */
function summaryChanged(
  a: InterfaceSummary | undefined,
  b: InterfaceSummary | undefined
): boolean {
  if (!a || !b) return true; // 新建 / 删除
  return (
    a.lastUpdated !== b.lastUpdated ||
    a.callCount !== b.callCount ||
    a.pinned !== b.pinned ||
    a.name !== b.name ||
    a.folder !== b.folder ||
    a.lastSentAt !== b.lastSentAt ||
    a.lastResponse?.status !== b.lastResponse?.status ||
    a.lastResponse?.at !== b.lastResponse?.at
  );
}

export function useInterfaces() {
  const [list, setList] = useState<InterfaceSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  // 选中接口的完整记录（含未截断响应体与历史响应），按需拉取
  const [detail, setDetail] = useState<InterfaceRecord | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  // 过滤用的关键字（输入防抖后更新）：搜索需要对每条记录做字符串拼接，
  // 逐字符重算在几百条记录、且部分响应体达 MB 级时会明显卡顿。
  const [queryKeyword, setQueryKeyword] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('updated');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 最新选中 id / 列表的快照：供异步回调做竞态校验，避免过期响应覆盖新状态
  const selectedIdRef = useRef<string | null>(null);
  const listRef = useRef<InterfaceSummary[]>([]);

  const fetchDetail = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null);
      return;
    }
    const r = await api.getDetail(id);
    // 仅在仍是当前选中项时采用，防止快速切换选择时旧响应覆盖新记录
    if (selectedIdRef.current === id) setDetail(r);
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // 选中项变化（含取消选择）时拉取完整记录
  useEffect(() => {
    fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  useEffect(() => {
    api.getList().then((l) => {
      listRef.current = l;
      setList(l);
    });
    api.listFolders().then(setFolders);
    api.onUpdated((l, f) => {
      // 选中记录的摘要变了才刷新详情（抓取高频时避免反复拉全量记录）
      const sel = selectedIdRef.current;
      if (sel) {
        const before = listRef.current.find((it) => it.id === sel);
        const after = l.find((it) => it.id === sel);
        if (summaryChanged(before, after)) fetchDetail(sel);
      }
      listRef.current = l;
      setList(l);
      setFolders(f);
    });
  }, [fetchDetail]);

  // 搜索防抖：输入框保持即时响应，只有实际过滤延迟执行
  useEffect(() => {
    const timer = setTimeout(() => setQueryKeyword(keyword), 200);
    return () => clearTimeout(timer);
  }, [keyword]);

  const addManual = useCallback(async (input: CaptureInput) => {
    const r = await api.addManual(input);
    if (r) setSelectedId(r.id);
    return r;
  }, []);

  const duplicate = useCallback(async (id: string) => {
    const r = await api.duplicate(id);
    if (r) setSelectedId(r.id);
    return r;
  }, []);

  const deleteOne = useCallback(async (id: string) => {
    await api.deleteOne(id);
    setSelectedId((cur) => (cur === id ? null : cur));
    setSelectedIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }, []);

  const deleteBySource = useCallback(async (source: 'captured' | 'manual') => {
    await api.deleteBySource(source);
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    await api.rename(id, name);
  }, []);

  const moveFolder = useCallback(async (id: string, folder: string) => {
    await api.moveFolder(id, folder);
  }, []);

  const togglePin = useCallback(async (id: string) => {
    await api.togglePin(id);
  }, []);

  const createFolder = useCallback(async (name: string) => {
    await api.createFolder(name);
  }, []);

  const deleteFolder = useCallback(async (name: string) => {
    await api.deleteFolder(name);
  }, []);

  const clearAll = useCallback(async () => {
    await api.clearAll();
    setSelectedId(null);
    setSelectedIds(new Set());
  }, []);

  const exportCollection = useCallback(async () => {
    return api.exportCollection();
  }, []);

  const importCollection = useCallback(async (data: unknown): Promise<boolean> => {
    const ok = await api.importCollection(data);
    // 仅在导入成功时清空选择；失败（形状不合法）时保留当前界面状态
    if (ok) {
      setSelectedId(null);
      setSelectedIds(new Set());
    }
    return ok;
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const clearSelect = useCallback(() => setSelectedIds(new Set()), []);

  const moveSelectedToFolder = useCallback(
    async (folder: string) => {
      // 一次批量 IPC：逐个调用会让 N 条记录产生 N 次落盘调度 + N 次全量推送
      await api.moveMany([...selectedIds], folder);
      setSelectedIds(new Set());
    },
    [selectedIds]
  );

  const filtered = useMemo(() => {
    const kw = queryKeyword.trim().toLowerCase();
    let arr = list.filter((it) => {
      if (methodFilter !== 'ALL' && it.method !== methodFilter) return false;
      if (statusFilter !== 'all') {
        const st = it.lastResponse?.status ?? 0;
        if (statusFilter === 'success' && !(st >= 200 && st < 400)) return false;
        if (statusFilter === 'fail' && !(st >= 400)) return false;
        if (statusFilter === 'none' && st !== 0) return false;
      }
      if (kw) {
        // 响应体单条可达 MB 级，全量拼接会让每次过滤做百万字符级运算。
        // 这里只取前 2KB 参与匹配，足以覆盖按响应内容查找的常见场景。
        const hay = [
          it.method,
          it.url,
          it.host,
          it.name || '',
          it.body || '',
          (it.lastResponse?.body || '').slice(0, SEARCH_BODY_LIMIT),
          JSON.stringify(it.query),
          JSON.stringify(it.headers),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    arr = [...arr].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      switch (sort) {
        case 'calls':
          return b.callCount - a.callCount;
        case 'name':
          return (a.name || a.path).localeCompare(b.name || b.path);
        case 'method':
          return a.method.localeCompare(b.method);
        default:
          return b.lastUpdated.localeCompare(a.lastUpdated);
      }
    });
    return arr;
  }, [list, queryKeyword, methodFilter, statusFilter, sort]);

  // 选中记录的完整数据来自 getDetail（按需拉取），不再是列表里的裁剪版
  const selected = detail;

  return {
    list,
    folders,
    filtered,
    selected,
    detail,
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
    selectedIds,
    toggleSelect,
    clearSelect,
    moveSelectedToFolder,
    addManual,
    duplicate,
    deleteOne,
    deleteBySource,
    rename,
    moveFolder,
    togglePin,
    createFolder,
    deleteFolder,
    exportCollection,
    importCollection,
    clearAll,
  };
}
