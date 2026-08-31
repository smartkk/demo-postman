import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  CaptureInput,
  InterfaceRecord,
  RecordSource,
  ResponseRecord,
} from '../../shared/types';

interface PersistShape {
  version: 1;
  records: InterfaceRecord[];
  folders: string[];
}

/** 保留的历史响应条数上限（最新在末尾）。 */
const MAX_RESPONSES = 20;
/** 落盘时单条响应体超过该大小则截断（避免 interfaces.json 膨胀）。 */
const MAX_STORED_BODY = 1 * 1024 * 1024; // 1MB
/** 需要脱敏的请求/响应头。 */
const SENSITIVE_HEADERS = ['authorization', 'proxy-authorization', 'cookie'];

function truncateBody(body: string): string {
  if (body.length > MAX_STORED_BODY) {
    return (
      body.slice(0, MAX_STORED_BODY) +
      `\n\n…[已截断，原响应体超过 ${(MAX_STORED_BODY / 1024 / 1024).toFixed(0)}MB，仅保留前部分]`
    );
  }
  return body;
}

/** 对抓取来源的记录脱敏敏感头（手动录入保留真实值以便重发）。 */
function maskSensitiveHeaders(
  headers: Record<string, string>,
  source: 'captured' | 'manual'
): Record<string, string> {
  if (source !== 'captured') return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    out[k] = SENSITIVE_HEADERS.includes(k.toLowerCase()) ? '***已脱敏***' : v;
  }
  return out;
}

/**
 * 接口存储管理器：负责加载、去重合并、分组、原子落盘。
 *
 * 去重唯一键 = method + host + path（query 视为参数，不计入去重键）。
 * 记录以 id 为主键存储；captureIndex 仅索引「浏览器抓取」记录，
 * 用于把后续抓取的请求/响应合并到同一条，而手动创建/复制的记录相互独立。
 */
export class InterfaceStore {
  private records = new Map<string, InterfaceRecord>();
  private captureIndex = new Map<string, string>(); // method|host|path -> id（仅抓取记录）
  private folders: string[] = [];
  private filePath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private listeners: Array<() => void> = [];
  private dedupByFullUrl = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  /** 设置去重策略：true=按完整 URL（含 query）去重。切换后重建索引，避免旧键失效产生重复记录。 */
  setDedupMode(fullUrl: boolean): void {
    this.dedupByFullUrl = fullUrl;
    this.captureIndex.clear();
    for (const r of this.records.values()) {
      if (r.source === 'captured') {
        const sp = new URLSearchParams(r.query || {}).toString();
        const search = sp ? `?${sp}` : '';
        this.captureIndex.set(this.buildKey(r.method, r.host, r.path, search), r.id);
      }
    }
  }

  private buildKey(method: string, host: string, p: string, search = ''): string {
    const base = `${method.toUpperCase()}|${host.toLowerCase()}|${p}`;
    return this.dedupByFullUrl && search ? `${base}|${search}` : base;
  }

  private genId(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed: PersistShape | InterfaceRecord[] = JSON.parse(raw);
      const recs: InterfaceRecord[] = Array.isArray(parsed)
        ? parsed
        : parsed.records || [];
      for (const r of recs) {
        if (!r.source) r.source = 'captured';
        this.records.set(r.id, r);
        if (r.source === 'captured') {
          this.captureIndex.set(this.buildKey(r.method, r.host, r.path), r.id);
        }
      }
      if (!Array.isArray(parsed) && parsed.folders) {
        this.folders = parsed.folders;
      }
    } catch (err) {
      console.error('[store] 加载失败，尝试备份', err);
      const bak = this.filePath + '.bak';
      if (fs.existsSync(bak)) {
        try {
          const parsed: PersistShape | InterfaceRecord[] = JSON.parse(
            fs.readFileSync(bak, 'utf8')
          );
          const recs: InterfaceRecord[] = Array.isArray(parsed)
            ? parsed
            : parsed.records || [];
          for (const r of recs) {
            if (!r.source) r.source = 'captured';
            this.records.set(r.id, r);
            if (r.source === 'captured') {
              this.captureIndex.set(
                this.buildKey(r.method, r.host, r.path),
                r.id
              );
            }
          }
          if (!Array.isArray(parsed) && parsed.folders) {
            this.folders = parsed.folders;
          }
        } catch (e2) {
          console.error('[store] 备份加载失败', e2);
        }
      }
    }
  }

  /** 浏览器抓取 / 代理捕获时调用：已存在抓取记录则覆盖最新参数并累加次数，否则新建。 */
  upsert(input: CaptureInput, opts?: { folder?: string }): InterfaceRecord | null {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      console.error('[store] 非法 url，已忽略', input.url);
      return null;
    }

    const method = (input.method || 'GET').toUpperCase();
    const host = parsed.host;
    const p = parsed.pathname || '/';
    const base = `${parsed.protocol}//${parsed.host}${p}`;
    const search = parsed.search;
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => {
      query[k] = v;
    });

    const key = this.buildKey(method, host, p, search);
    const now = new Date().toISOString();
    const existingId = this.captureIndex.get(key);
    const hasBody = input.body != null && input.body !== '';
    const hasCt = input.contentType != null && input.contentType !== '';

    let record: InterfaceRecord;
    if (existingId && this.records.has(existingId)) {
      const existing = this.records.get(existingId)!;
      existing.method = method;
      existing.url = base;
      existing.host = host;
      existing.path = p;
      existing.headers = maskSensitiveHeaders(input.headers || {}, 'captured');
      existing.query = query;
      existing.body = hasBody ? input.body! : existing.body;
      existing.contentType = hasCt ? input.contentType! : existing.contentType;
      existing.lastUpdated = now;
      existing.callCount += 1;
      if (!existing.source) existing.source = 'captured';
      record = existing;
    } else {
      const id = this.genId();
      record = {
        id,
        method,
        url: base,
        host,
        path: p,
        headers: maskSensitiveHeaders(input.headers || {}, 'captured'),
        query,
        body: hasBody ? input.body! : null,
        contentType: hasCt ? input.contentType! : null,
        lastResponse: null,
        createdAt: now,
        lastUpdated: now,
        callCount: 1,
        source: 'captured',
        folder: opts?.folder ?? '', // 新建抓取记录时才套用自动分组
      };
      this.records.set(id, record);
      this.captureIndex.set(key, id);
    }
    this.scheduleSave();
    this.emitChange();
    return record;
  }

  /** 手动录入：始终新建一条独立记录（source=manual），不参与抓取去重。 */
  addManual(input: CaptureInput): InterfaceRecord | null {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      console.error('[store] 非法 url，已忽略', input.url);
      return null;
    }
    const method = (input.method || 'GET').toUpperCase();
    const host = parsed.host;
    const p = parsed.pathname || '/';
    const base = `${parsed.protocol}//${parsed.host}${p}`;
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    const now = new Date().toISOString();
    const id = this.genId();
    const record: InterfaceRecord = {
      id,
      method,
      url: base,
      host,
      path: p,
      headers: input.headers || {},
      query,
      body: input.body ?? null,
      contentType: input.contentType ?? null,
      lastResponse: null,
      createdAt: now,
      lastUpdated: now,
      callCount: 1,
      source: 'manual',
    };
    this.records.set(id, record);
    this.scheduleSave();
    this.emitChange();
    return record;
  }

  list(): InterfaceRecord[] {
    return [...this.records.values()].sort((a, b) =>
      b.lastUpdated.localeCompare(a.lastUpdated)
    );
  }

  /** 编辑已存在的接口：按 id 定位，保留 id/createdAt/callCount/name/folder/source，更新其余字段。 */
  update(id: string, input: CaptureInput): InterfaceRecord | null {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      console.error('[store] 非法 url，已忽略', input.url);
      return null;
    }

    const existing = this.records.get(id);
    if (!existing) return null;

    // 清理旧 captureIndex 中指向该 id 的条目
    for (const [k, v] of this.captureIndex) {
      if (v === id) this.captureIndex.delete(k);
    }

    const method = (input.method || 'GET').toUpperCase();
    const host = parsed.host;
    const p = parsed.pathname || '/';
    const base = `${parsed.protocol}//${parsed.host}${p}`;
    const search = parsed.search;
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => {
      query[k] = v;
    });

    const now = new Date().toISOString();
    const record: InterfaceRecord = {
      ...existing,
      method,
      url: base,
      host,
      path: p,
      headers: input.headers || {},
      query,
      body: input.body ?? null,
      contentType: input.contentType ?? null,
      lastUpdated: now,
    };
    this.records.set(id, record);
    if (record.source === 'captured') {
      this.captureIndex.set(this.buildKey(method, host, p, search), id);
    }
    this.scheduleSave();
    this.emitChange();
    return record;
  }

  get(id: string): InterfaceRecord | null {
    return this.records.get(id) || null;
  }

  /** 复制一条接口：生成新 id，来源置为 manual，调用次数归零，响应清空。 */
  duplicate(id: string): InterfaceRecord | null {
    const src = this.records.get(id);
    if (!src) return null;
    const now = new Date().toISOString();
    const nid = this.genId();
    const copy: InterfaceRecord = {
      ...src,
      id: nid,
      name: (src.name || src.path) + ' 副本',
      source: 'manual',
      callCount: 0,
      createdAt: now,
      lastUpdated: now,
      lastResponse: null,
      headers: { ...src.headers },
      query: { ...src.query },
    };
    this.records.set(nid, copy);
    this.scheduleSave();
    this.emitChange();
    return copy;
  }

  /** 删除单条接口记录。 */
  deleteOne(id: string): boolean {
    if (!this.records.has(id)) return false;
    this.records.delete(id);
    for (const [k, v] of this.captureIndex) {
      if (v === id) this.captureIndex.delete(k);
    }
    this.scheduleSave();
    this.emitChange();
    return true;
  }

  /** 按来源批量删除（如仅删除浏览器抓取记录）。返回删除条数。 */
  deleteBySource(source: RecordSource): number {
    let count = 0;
    for (const [id, r] of [...this.records.entries()]) {
      if (r.source === source) {
        this.records.delete(id);
        for (const [k, v] of this.captureIndex) {
          if (v === id) this.captureIndex.delete(k);
        }
        count++;
      }
    }
    this.scheduleSave();
    this.emitChange();
    return count;
  }

  /** 重命名（显示名称）。 */
  rename(id: string, name: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.name = name;
    r.lastUpdated = new Date().toISOString();
    this.scheduleSave();
    this.emitChange();
  }

  /** 移动接口到指定分组（空串表示「未分组」）。 */
  moveFolder(id: string, folder: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.folder = folder;
    r.lastUpdated = new Date().toISOString();
    this.scheduleSave();
    this.emitChange();
  }

  /** 切换收藏（置顶）状态。 */
  togglePin(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.pinned = !r.pinned;
    this.scheduleSave();
    this.emitChange();
  }

  // ===== 分组（集合）管理 =====
  listFolders(): string[] {
    return [...this.folders];
  }

  createFolder(name: string): void {
    const n = name.trim();
    if (!n || this.folders.includes(n)) return;
    this.folders.push(n);
    this.scheduleSave();
    this.emitChange();
  }

  deleteFolder(name: string): void {
    this.folders = this.folders.filter((f) => f !== name);
    for (const r of this.records.values()) {
      if (r.folder === name) r.folder = '';
    }
    this.scheduleSave();
    this.emitChange();
  }

  clearAll(): void {
    this.records.clear();
    this.captureIndex.clear();
    this.folders = [];
    this.scheduleSave();
    this.emitChange();
  }

  /** 导出整个集合（记录 + 分组），供迁移/分享。 */
  exportCollection(): PersistShape {
    return { version: 1, records: this.list(), folders: [...this.folders] };
  }

  /** 导入集合：清空现有数据后载入（records 兼容数组与 {records,folders} 两种格式）。 */
  importCollection(data: PersistShape | InterfaceRecord[]): void {
    const recs: InterfaceRecord[] = Array.isArray(data)
      ? data
      : data.records || [];
    const folders: string[] = Array.isArray(data) ? [] : data.folders || [];
    this.records.clear();
    this.captureIndex.clear();
    for (const r of recs) {
      if (!r.source) r.source = 'captured';
      this.records.set(r.id, r);
      if (r.source === 'captured') {
        this.captureIndex.set(this.buildKey(r.method, r.host, r.path), r.id);
      }
    }
    this.folders = [...folders];
    this.scheduleSave();
    this.emitChange();
  }

  /** 保存某接口最近一次「手动发送」的响应结果，并累加调用次数。 */
  saveResponse(id: string, resp: ResponseRecord): void {
    const r = this.records.get(id);
    if (!r) return;
    resp.source = 'manual';
    const stored: ResponseRecord = {
      ...resp,
      headers: maskSensitiveHeaders(resp.headers, 'manual'),
      body: truncateBody(resp.body),
    };
    r.lastResponse = stored;
    r.responses = [...(r.responses || []), stored].slice(-MAX_RESPONSES);
    r.lastUpdated = stored.at;
    r.callCount += 1;
    this.scheduleSave();
    this.emitChange();
  }

  /** 记录接口最后一次「实际发送请求」的时间（仅更新该字段，不改动其它）。 */
  setLastSent(id: string, at: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.lastSentAt = at;
    this.scheduleSave();
    this.emitChange();
  }

  /**
   * 浏览器插件在抓取请求后回传的响应结果：按 method+host+path 关联记录，
   * 写入 lastResponse（不累加 callCount，避免与请求捕获重复计数）。
   */
  upsertResponse(
    method: string,
    url: string,
    resp: ResponseRecord,
    opts?: { folder?: string }
  ): InterfaceRecord | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      console.error('[store] 非法 url，已忽略', url);
      return null;
    }
    const m = method.toUpperCase();
    const host = parsed.host;
    const p = parsed.pathname || '/';
    const key = this.buildKey(m, host, p, parsed.search);

    let id = this.captureIndex.get(key);
    let record = id ? this.records.get(id) || null : null;
    if (!record) {
      for (const r of this.records.values()) {
        if (
          r.method.toUpperCase() === m &&
          r.host.toLowerCase() === host.toLowerCase() &&
          r.path === p
        ) {
          record = r;
          break;
        }
      }
    }

    resp.source = 'captured';
    const now = resp.at || new Date().toISOString();
    const stored: ResponseRecord = {
      ...resp,
      headers: maskSensitiveHeaders(resp.headers, 'captured'),
      body: truncateBody(resp.body),
    };

    if (record) {
      record.lastResponse = stored;
      record.responses = [...(record.responses || []), stored].slice(-MAX_RESPONSES);
      record.lastUpdated = now;
      this.scheduleSave();
      this.emitChange();
      return record;
    }

    const base = `${parsed.protocol}//${parsed.host}${p}`;
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    const nid = this.genId();
    const rec: InterfaceRecord = {
      id: nid,
      method: m,
      url: base,
      host,
      path: p,
      headers: {},
      query,
      body: null,
      contentType: null,
      lastResponse: stored,
      responses: [stored],
      createdAt: now,
      lastUpdated: now,
      callCount: 1,
      source: 'captured',
      folder: opts?.folder ?? '',
    };
    this.records.set(nid, rec);
    this.captureIndex.set(key, nid);
    this.scheduleSave();
    this.emitChange();
    return rec;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emitChange(): void {
    for (const cb of this.listeners) cb();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  /** 原子落盘：写临时文件 + rename，并保留 .bak 备份。 */
  save(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = JSON.stringify(
      { version: 1, records: this.list(), folders: this.folders },
      null,
      2
    );
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, data, 'utf8');
    if (fs.existsSync(this.filePath)) {
      fs.copyFileSync(this.filePath, this.filePath + '.bak');
    }
    fs.renameSync(tmp, this.filePath);
  }
}
