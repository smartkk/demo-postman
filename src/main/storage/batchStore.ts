import fs from 'node:fs';
import crypto from 'node:crypto';
import { FolderManager } from './folderManager';
import { atomicWriteJson } from './atomicWrite';
import type { BatchProgressState, BatchProject } from '../../shared/types';

interface PersistShape {
  version: 1;
  projects: BatchProject[];
  folders: string[];
}

/**
 * 批量调用任务存储：每个「批量项目」独立持久化到 batches.json，
 * 支持按文件夹分组、增删改查，以及最近一次运行结果的保存。
 * 关闭批量面板不会清空数据，下次打开可继续编辑/运行。
 */
export class BatchStore {
  private projects = new Map<string, BatchProject>();
  private folders = new FolderManager(
    () => this.projects.values(),
    () => {
      this.scheduleSave();
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
      const parsed: PersistShape | BatchProject[] = JSON.parse(
        fs.readFileSync(this.filePath, 'utf8')
      );
      const list: BatchProject[] = Array.isArray(parsed)
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
      console.error('[batchStore] 加载失败', err);
    }
  }

  list(): BatchProject[] {
    return [...this.projects.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  get(id: string): BatchProject | null {
    return this.projects.get(id) || null;
  }

  /** 新建或更新一个批量项目（按 id 定位，无 id 则新建）。 */
  save(project: BatchProject): BatchProject {
    const now = new Date().toISOString();
    if (project.id && this.projects.has(project.id)) {
      const existing = this.projects.get(project.id)!;
      const updated: BatchProject = {
        ...existing,
        ...project,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      this.projects.set(updated.id, updated);
      this.scheduleSave();
      this.emitChange();
      return updated;
    }
    const created: BatchProject = {
      ...project,
      id: this.genId(),
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(created.id, created);
    this.scheduleSave();
    this.emitChange();
    return created;
  }

  delete(id: string): boolean {
    if (!this.projects.has(id)) return false;
    this.projects.delete(id);
    this.scheduleSave();
    this.emitChange();
    return true;
  }

  rename(id: string, name: string): void {
    const p = this.projects.get(id);
    if (!p) return;
    p.name = name;
    p.updatedAt = new Date().toISOString();
    this.scheduleSave();
    this.emitChange();
  }

  moveFolder(id: string, folder: string): void {
    const p = this.projects.get(id);
    if (!p) return;
    p.folder = folder;
    p.updatedAt = new Date().toISOString();
    this.scheduleSave();
    this.emitChange();
  }

  /** 记录某项目最近一次运行结果（不覆盖其它字段）。 */
  recordRun(id: string, results: BatchProject['results'], lastRunAt: string): void {
    const p = this.projects.get(id);
    if (!p) return;
    p.results = results;
    p.lastRunAt = lastRunAt;
    p.updatedAt = lastRunAt;
    this.scheduleSave();
    this.emitChange();
  }

  /**
   * 记录断点续跑进度（已完成的行号与结果）。
   * 全部行完成时清除断点，避免下次运行误判为「未跑完」。
   */
  recordProgress(id: string, progress: BatchProgressState | null): void {
    const p = this.projects.get(id);
    if (!p) return;
    const total = p.rows?.length ?? 0;
    const doneCount = progress?.doneIndexes.length ?? 0;
    if (!progress || total === 0 || doneCount >= total) {
      delete p.progress;
    } else {
      p.progress = progress;
    }
    p.updatedAt = new Date().toISOString();
    this.scheduleSave();
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

  private scheduleSave(): void {
    this.persist();
  }

  persist(): void {
    atomicWriteJson(this.filePath, {
      version: 1,
      projects: this.list(),
      folders: this.folders.list(),
    });
  }
}
