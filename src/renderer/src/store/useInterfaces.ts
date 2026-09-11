import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { CaptureInput, InterfaceRecord } from '../../../shared/types';

export type SortKey = 'updated' | 'calls' | 'name' | 'method';
export type StatusFilter = 'all' | 'success' | 'fail' | 'none';

/** 搜索时每条记录的响应体最多参与匹配的字符数。 */
const SEARCH_BODY_LIMIT = 2048;

export function useInterfaces() {
  const [list, setList] = useState<InterfaceRecord[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  // 过滤用的关键字（输入防抖后更新）：搜索需要对每条记录做字符串拼接，
  // 逐字符重算在几百条记录、且部分响应体达 MB 级时会明显卡顿。
  const [queryKeyword, setQueryKeyword] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('updated');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getList().then(setList);
    api.listFolders().then(setFolders);
    api.onUpdated((l, f) => {
      setList(l);
      setFolders(f);
    });
  }, []);

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

  const importCollection = useCallback(async (data: unknown) => {
    await api.importCollection(data);
    setSelectedId(null);
    setSelectedIds(new Set());
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
      for (const id of selectedIds) await api.moveFolder(id, folder);
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

  const selected = list.find((it) => it.id === selectedId) || null;

  return {
    list,
    folders,
    filtered,
    selected,
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
