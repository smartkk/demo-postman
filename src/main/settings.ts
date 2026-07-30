import fs from 'node:fs';
import path from 'node:path';
import type { CaptureSettings } from '../shared/types';

const DEFAULTS: CaptureSettings = {
  includeHosts: [],
  excludeHosts: [],
  autoGroup: true,
  dedupByFullUrl: false,
  environments: { 默认: {} },
  activeEnv: '默认',
};

/**
 * 抓取设置：白名单（include/exclude 主机）与自动分组开关。
 * 持久化到 userData/settings.json，运行时可被 UI 修改并即时生效。
 */
export class Settings {
  private data: CaptureSettings;
  private file: string;
  private listeners: Array<() => void> = [];

  constructor(file: string) {
    this.file = file;
    this.data = { ...DEFAULTS };
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { ...DEFAULTS, ...raw };
      }
    } catch (err) {
      console.error('[settings] 加载失败，使用默认', err);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[settings] 保存失败', err);
    }
  }

  get(): CaptureSettings {
    return { ...this.data };
  }

  update(patch: Partial<CaptureSettings>): CaptureSettings {
    this.data = { ...this.data, ...patch };
    this.save();
    this.emit();
    return this.get();
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}
