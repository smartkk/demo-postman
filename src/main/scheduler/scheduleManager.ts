import type {
  ScheduleConfig,
  ScheduleRunResult,
  ChainProject,
  ChainRunResult,
} from '../../shared/types';
import { sendRequest } from '../request/sender';
import { ScheduleStore } from './scheduleStore';

export interface ScheduleChainDeps {
  /** 按 id 获取链式任务。 */
  getChain?: (id: string) => ChainProject | null;
  /** 执行链式任务，返回各步骤结果。 */
  runChain?: (p: ChainProject) => Promise<ChainRunResult[]>;
}

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
  private chainDeps: ScheduleChainDeps;

  constructor(file: string, chainDeps: ScheduleChainDeps = {}) {
    this.store = new ScheduleStore(file);
    this.chainDeps = chainDeps;
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
    const interval = Math.max(s.intervalSeconds * 1000, 1000); // 最小 1 秒

    if (s.startAt) {
      const start = new Date(s.startAt).getTime();
      if (!Number.isNaN(start)) {
        if (start > now) {
          // 首次：等待到指定的开始执行时间
          delay = start - now;
        } else {
          // 已开始过：以 startAt 为相位锚点，对齐到 now 之后的下一个执行点，
          // 保证列表「下次时间」与真实调度一致（不依赖本次 fire 的实际时刻）。
          let next = start;
          while (next <= now) next += interval;
          delay = next - now;
        }
      } else {
        delay = interval;
      }
    } else {
      delay = interval;
    }
    const timer = setTimeout(() => this.fire(id), delay);
    this.timers.set(id, timer);
  }

  private async fire(id: string): Promise<void> {
    const s = this.store.get(id);
    if (!s) return;

    const firedAt = new Date().toISOString();
    const MAX_HISTORY_BODY = 20 * 1024; // 历史中仅保留前 20KB 响应体
    try {
      // ── 链式任务模式 ──
      if (s.chainId && this.chainDeps.getChain && this.chainDeps.runChain) {
        const project = this.chainDeps.getChain(s.chainId);
        if (!project) {
          throw new Error(`链式任务不存在：${s.chainId}`);
        }
        const steps = await this.chainDeps.runChain(project);
        const failed = steps.find((st) => st.status === 0 || st.error);
        const last = steps[steps.length - 1];
        const summary = steps.map((st) => ({
          step: st.name,
          status: st.status,
          statusText: st.statusText,
          durationMs: st.durationMs,
          error: st.error || undefined,
          body: st.body ? st.body.slice(0, 2000) : undefined,
        }));
        const result: ScheduleRunResult = {
          status: failed ? failed.status : last.status,
          statusText: failed
            ? failed.error || `${failed.name} 失败`
            : `链式完成 ${steps.length} 步`,
          durationMs: steps.reduce((sum, st) => sum + st.durationMs, 0),
          error: failed ? failed.error : undefined,
          body: JSON.stringify(summary, null, 2),
          firedAt,
          at: last.at,
        };
        this.store.recordResult(id, result);
        return;
      }

      // ── 单接口模式 ──
      const resp = await sendRequest(s.input);
      const result: ScheduleRunResult = {
        status: resp.status,
        statusText: resp.statusText,
        durationMs: resp.durationMs,
        body: resp.body && resp.body.length > MAX_HISTORY_BODY
          ? resp.body.slice(0, MAX_HISTORY_BODY) + '\n…(已截断)'
          : resp.body,
        firedAt,
        at: resp.at,
      };
      this.store.recordResult(id, result);
    } catch (err) {
      const result: ScheduleRunResult = {
        status: 0,
        statusText: '',
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
        firedAt,
        at: new Date().toISOString(),
      };
      this.store.recordResult(id, result);
    } finally {
      // 排定下一次运行（如果任务仍启用）
      this.scheduleNext(id);
    }
  }
}
