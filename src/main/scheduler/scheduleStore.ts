import fs from 'node:fs';
import path from 'node:path';
import type { ScheduleConfig, ScheduleRunResult } from '../../shared/types';

/**
 * 定时调度的持久化存储。
 * 数据以 JSON 数组形式保存在 userData/schedules.json，变更后原子写入。
 */
export class ScheduleStore {
  private data: ScheduleConfig[] = [];
  private file: string;
  private listeners: Array<() => void> = [];

  constructor(file: string) {
    this.file = file;
    this.load();
  }

  /* ───────── 持久化 ───────── */

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = Array.isArray(raw) ? raw : [];
      }
    } catch (err) {
      console.error('[scheduleStore] 加载失败', err);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      if (fs.existsSync(this.file)) {
        fs.copyFileSync(this.file, this.file + '.bak');
      }
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[scheduleStore] 保存失败', err);
    }
  }

  /* ───────── CRUD ───────── */

  list(): ScheduleConfig[] {
    return this.data;
  }

  get(id: string): ScheduleConfig | undefined {
    return this.data.find((s) => s.id === id);
  }

  upsert(config: ScheduleConfig): void {
    const idx = this.data.findIndex((s) => s.id === config.id);
    if (idx >= 0) {
      this.data[idx] = config;
    } else {
      this.data.push(config);
    }
    this.save();
    this.emit();
  }

  remove(id: string): boolean {
    const idx = this.data.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.data.splice(idx, 1);
    this.save();
    this.emit();
    return true;
  }

  toggle(id: string): ScheduleConfig | undefined {
    const s = this.get(id);
    if (!s) return;
    s.enabled = !s.enabled;
    this.save();
    this.emit();
    return s;
  }

  recordResult(id: string, result: ScheduleRunResult): void {
    const s = this.get(id);
    if (!s) return;
    s.lastRunAt = result.at;
    s.lastResult = result;
    s.runCount = (s.runCount ?? 0) + 1;
    if (!s.history) s.history = [];
    s.history.push(result);
    // 仅保留最近 50 条
    if (s.history.length > 50) {
      s.history = s.history.slice(-50);
    }
    this.save();
    this.emit();
  }

  getHistory(id: string): ScheduleRunResult[] {
    const s = this.get(id);
    return s?.history ?? [];
  }

  /* ───────── 变更通知 ───────── */

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}
