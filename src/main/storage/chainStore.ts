import fs from 'node:fs';
import crypto from 'node:crypto';
import { FolderManager } from './folderManager';
import { atomicWriteJson } from './atomicWrite';
import type { ChainProject } from '../../shared/types';

interface PersistShape {
  version: 1;
  projects: ChainProject[];
  folders: string[];
}

/**
 * 链式请求存储：每个「链式项目」独立持久化到 chains.json，
 * 支持按文件夹分组、增删改查，以及最近一次运行结果的保存。
 */
export class ChainStore {
  private projects = new Map<string, ChainProject>();
  private folders = new FolderManager(
    () => this.projects.values(),
    () => {
      this.persist();
      this.emitChange();
    }
  );
  private filePath: string;
  private listeners: Array<() => void> = [];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private genId(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed: PersistShape | ChainProject[] = JSON.parse(
        fs.readFileSync(this.filePath, 'utf8')
      );
      const list: ChainProject[] = Array.isArray(parsed)
        ? parsed
        : parsed.projects || [];
      for (const p of list) {
        if (!p.id) p.id = this.genId();
        this.projects.set(p.id, p);
      }
      if (!Array.isArray(parsed) && parsed.folders) {
        this.folders.setAll(parsed.folders);
      }
    } catch (err) {
      console.error('[chainStore] 加载失败', err);
    }
  }

  list(): ChainProject[] {
    return [...this.projects.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  get(id: string): ChainProject | null {
    return this.projects.get(id) || null;
  }

  /** 新建或更新一个链式项目（按 id 定位，无 id 则新建）。 */
  save(project: ChainProject): ChainProject {
    const now = new Date().toISOString();
    if (project.id && this.projects.has(project.id)) {
      const existing = this.projects.get(project.id)!;
      const updated: ChainProject = {
        ...existing,
        ...project,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      this.projects.set(updated.id, updated);
      this.persist();
      this.emitChange();
      return updated;
    }
    const created: ChainProject = {
      ...project,
      id: this.genId(),
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(created.id, created);
    this.persist();
    this.emitChange();
    return created;
  }

  delete(id: string): boolean {
    if (!this.projects.has(id)) return false;
    this.projects.delete(id);
    this.persist();
    this.emitChange();
    return true;
  }

  rename(id: string, name: string): void {
    const p = this.projects.get(id);
    if (!p) return;
    p.name = name;
    p.updatedAt = new Date().toISOString();
    this.persist();
    this.emitChange();
  }

  moveFolder(id: string, folder: string): void {
    const p = this.projects.get(id);
    if (!p) return;
    p.folder = folder;
    p.updatedAt = new Date().toISOString();
    this.persist();
    this.emitChange();
  }

  /** 记录某项目最近一次运行结果（不覆盖其它字段）。 */
  recordRun(id: string, results: ChainProject['results'], lastRunAt: string): void {
    const p = this.projects.get(id);
    if (!p) return;
    p.results = results;
    p.lastRunAt = lastRunAt;
    p.updatedAt = lastRunAt;
    this.persist();
    this.emitChange();
  }

  // ===== 文件夹（分组）管理（委托给 FolderManager，逻辑见 folderManager.ts）=====
  listFolders(): string[] {
    return this.folders.list();
  }

  createFolder(name: string): void {
    this.folders.create(name);
  }

  deleteFolder(name: string): void {
    this.folders.delete(name);
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emitChange(): void {
    for (const cb of this.listeners) cb();
  }

  persist(): void {
    atomicWriteJson(this.filePath, {
      version: 1,
      projects: this.list(),
      folders: this.folders.list(),
    });
  }
}
