import type { ScheduleConfig, ScheduleRunResult } from '../../shared/types';
import { sendRequest } from '../request/sender';
import { ScheduleStore } from './scheduleStore';

/**
 * 定时调度管理器：管理所有定时任务的 setInterval，任务执行时复用 sender.ts 的 sendRequest。
 *
 * ── 生命周期 ──
 * 1. 构造时从 JSON 恢复所有已启用任务，启动计时器。
 * 2. add / remove / toggle 即时启动 / 停止计时器。
 * 3. 每次 fire 后自动排定下一次运行（递归 setTimeout 模式）。
 * 4. destroy 时清理所有计时器（app 退出前调用）。
 */
export class ScheduleManager {
  private store: ScheduleStore;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private push: ((list: ScheduleConfig[]) => void) | null = null;

  constructor(file: string) {
    this.store = new ScheduleStore(file);
    // 任何持久化变更都推送到渲染进程（如果已绑定）
    this.store.onChange(() => {
      this.push?.(this.store.list());
    });
    // 应用启动时恢复所有已启用任务
    this.restartAll();
  }

  /* ───────── 暴露给 IPC ───────── */

  list(): ScheduleConfig[] {
    return this.store.list();
  }

  add(config: ScheduleConfig): void {
    this.store.upsert(config);
    if (config.enabled) this.scheduleNext(config.id);
  }

  update(config: ScheduleConfig): void {
    // 先停旧计时器，写入后再按新配置启动
    this.stopTimer(config.id);
    this.store.upsert(config);
    if (config.enabled) this.scheduleNext(config.id);
  }

  remove(id: string): boolean {
    this.stopTimer(id);
    return this.store.remove(id);
  }

  toggle(id: string): ScheduleConfig | undefined {
    const updated = this.store.toggle(id);
    if (!updated) return;
    if (updated.enabled) {
      this.scheduleNext(id);
    } else {
      this.stopTimer(id);
    }
    return updated;
  }

  /** 绑定推送回调：数据变更时由 IPC 转发到渲染进程。 */
  onPush(handler: (list: ScheduleConfig[]) => void): void {
    this.push = handler;
  }

  /** 获取指定任务的执行历史。 */
  getHistory(id: string): ScheduleRunResult[] {
    return this.store.getHistory(id);
  }

  /** 销毁：停止所有计时器。 */
  destroy(): void {
    for (const id of this.timers.keys()) this.stopTimer(id);
  }

  /* ───────── 内部：计时器管理 ───────── */

  private restartAll(): void {
    for (const s of this.store.list()) {
      if (s.enabled) this.scheduleNext(s.id);
    }
  }

  private stopTimer(id: string): void {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
  }

  private scheduleNext(id: string): void {
    const s = this.store.get(id);
    if (!s || !s.enabled) return;

    this.stopTimer(id);

    let delay: number;
    const now = Date.now();
    if (s.startAt) {
      const start = new Date(s.startAt).getTime();
      // 若设置了未来时间，则等待到该刻再首次执行
      if (!Number.isNaN(start) && start > now) {
        delay = start - now;
      } else {
        delay = Math.max(s.intervalSeconds * 1000, 1000); // 最小 1 秒
      }
    } else {
      delay = Math.max(s.intervalSeconds * 1000, 1000); // 最小 1 秒
    }
    const timer = setTimeout(() => this.fire(id), delay);
    this.timers.set(id, timer);
  }

  private async fire(id: string): Promise<void> {
    const s = this.store.get(id);
    if (!s) return;

    try {
      const resp = await sendRequest(s.input);
      const result: ScheduleRunResult = {
        status: resp.status,
        statusText: resp.statusText,
        durationMs: resp.durationMs,
        at: resp.at,
      };
      this.store.recordResult(id, result);
    } catch (err) {
      const result: ScheduleRunResult = {
        status: 0,
        statusText: '',
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
      this.store.recordResult(id, result);
    } finally {
      // 排定下一次运行（如果任务仍启用）
      this.scheduleNext(id);
    }
  }
}
