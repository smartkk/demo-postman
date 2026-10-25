import crypto from 'node:crypto';
import type {
  BatchCallInput,
  BatchCallResult,
  CaptureInput,
} from '../../shared/types';
import { AUTO_TIMEOUT_MS, sendRequest } from './sender';

/** 并发模式下的最大同时请求数，避免海量行瞬间建立大量 socket。 */
export const BATCH_CONCURRENCY = 20;

/**
 * 内置动态变量：在模板或参数行单元格值中以 {{$name}} 形式书写，运行时自动解析。
 * 支持：
 *   $timestamp      当前 Unix 秒级时间戳
 *   $timestamp_ms   毫秒级时间戳
 *   $datetime       ISO 本地时间 2026-08-05T14:30:00+08:00
 *   $date           2026-08-05（YYYY-MM-DD）
 *   $time           HH:mm:ss
 *   $uuid           随机 UUID（每次调用生成不同值）
 *   $random(a,b)    a~b 之间的随机整数（含端点）
 * 未匹配的动态变量保持原样返回。
 */
export function resolveDynamic(s: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const offMin = -now.getTimezoneOffset();
  const off = `${offMin >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offMin) / 60))}:${pad(Math.abs(offMin) % 60)}`;
  return s.replace(/\{\{\s*\$([\w.-]+)(?:\(([^)]*)\))?\s*\}\}/g, (_m, name: string, args?: string) => {
    switch (name) {
      case 'timestamp':
        return String(Math.floor(now.getTime() / 1000));
      case 'timestamp_ms':
        return String(now.getTime());
      case 'datetime':
        return `${dateStr}T${timeStr}${off}`;
      case 'date':
        return dateStr;
      case 'time':
        return timeStr;
      case 'uuid':
        return crypto.randomUUID();
      case 'random': {
        if (args != null) {
          const parts = args.split(',').map((x) => parseInt(x.trim(), 10));
          if (parts.length === 2 && !parts.some(Number.isNaN)) {
            const [a, b] = parts;
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
          }
        }
        return _m;
      }
      default:
        return _m;
    }
  });
}

/** 用键值对替换 {{var}} 占位符（URL / Header 值 / Body）。未提供的变量尝试解析为动态变量，否则保持原样。 */
export function resolvePlaceholders(
  input: CaptureInput,
  vars: Record<string, string>
): CaptureInput {
  const sub = (s: string) =>
    s.replace(/\{\{\s*(\$?[\w.-]+)(?:\(([^)]*)\))?\s*\}\}/g, (m, k: string) =>
      // 变量池命中优先；否则把完整匹配交给动态变量解析（支持 {{$timestamp}}、{{$random(1,5)}}）
      k in vars ? vars[k] : resolveDynamic(m)
    );
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers || {})) headers[k] = sub(v);
  return {
    ...input,
    url: sub(input.url),
    headers,
    body: input.body ? sub(input.body) : input.body,
  };
}

/** 用环境变量替换 {{var}} 占位符（URL / Header 值 / Body）。 */
export function resolveEnv(
  input: CaptureInput,
  env?: Record<string, string>
): CaptureInput {
  if (!env) return input;
  return resolvePlaceholders(input, env);
}

/**
 * 仅替换环境变量、不解析动态变量的版本。
 * 批量模板中的 {{$uuid}} / {{$timestamp}} 等动态变量应在每行执行时独立生成，
 * 若在环境预解析阶段就替换，会导致所有行共享同一个值。
 */
export function resolveEnvVars(
  input: CaptureInput,
  env?: Record<string, string>
): CaptureInput {
  if (!env) return input;
  const sub = (s: string) =>
    s.replace(/\{\{\s*(\$?[\w.-]+)(?:\(([^)]*)\))?\s*\}\}/g, (m, k: string) =>
      k in env ? env[k] : m
    );
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers || {})) headers[k] = sub(v);
  return {
    ...input,
    url: sub(input.url),
    headers,
    body: input.body ? sub(input.body) : input.body,
  };
}

/**
 * 行变量补全：批量模板声明过的变量（input.variables，含参数文件夹模式下各文件键的并集）
 * 在该行缺键时补空串，避免 {{var}} 残留字面量被发往服务器。
 * 未声明的占位符不受影响（仍走环境变量 / 动态变量解析链）。
 */
export function completeRowVars(
  row: Record<string, string>,
  variables: string[]
): Record<string, string> {
  const out = { ...row };
  for (const v of variables) {
    if (!(v in out)) out[v] = '';
  }
  return out;
}

/**
 * 批量调用：同一基础请求，按每行变量值替换后逐个/并发发送，返回每行的发送时间 + 结果。
 * @param env 当前激活环境的环境变量（可选），先替换进基础模板，再按行替换。
 */
export async function runBatchCall(
  input: BatchCallInput,
  env?: Record<string, string>
): Promise<BatchCallResult[]> {
  // 先对环境变量做一次性替换（基础模板可引用环境）；动态变量留到每行执行时独立生成
  const base: CaptureInput = {
    method: input.method,
    url: input.url,
    headers: input.headers,
    body: input.body,
    contentType: input.headers['content-type'] || null,
  };
  const baseResolved = resolveEnvVars(base, env);

  const runOne = async (
    row: Record<string, string>,
    index: number
  ): Promise<BatchCallResult> => {
    const sentAt = new Date().toISOString();
    // 先解析参数行单元格值里的动态变量（如 {{$uuid}}、{{$timestamp}}），每行独立生成；
    // 模板声明过但该行缺失的变量补空串（文件夹模式下不同文件的键集可能不同）
    const rowFilled = completeRowVars(row, input.variables || []);
    const resolvedRow: Record<string, string> = {};
    for (const [k, v] of Object.entries(rowFilled)) resolvedRow[k] = resolveDynamic(v);
    const request = resolvePlaceholders(baseResolved, resolvedRow);
    try {
      // 批量是无人值守场景，必须带超时，否则服务不可达时会堆积永不释放的连接
      const resp = await sendRequest(request, 0, undefined, AUTO_TIMEOUT_MS);
      return {
        index,
        vars: resolvedRow,
        status: resp.status,
        statusText: resp.statusText,
        durationMs: resp.durationMs,
        body: resp.body,
        request,
        sentAt,
        at: resp.at,
      };
    } catch (err) {
      return {
        index,
        vars: resolvedRow,
        status: 0,
        statusText: '',
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
        body: '',
        request,
        sentAt,
        at: new Date().toISOString(),
      };
    }
  };

  const rows = input.rows || [];
  if (input.sequential) {
    const out: BatchCallResult[] = [];
    for (let i = 0; i < rows.length; i++) out.push(await runOne(rows[i], i));
    return out;
  }
  // 并发模式：限制同时发送的请求数（结果仍按下标保序），
  // 避免海量行瞬间建立大量 socket 导致内存/连接耗尽。
  const out: BatchCallResult[] = new Array(rows.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(BATCH_CONCURRENCY, rows.length) },
    async () => {
      while (next < rows.length) {
        const i = next++;
        out[i] = await runOne(rows[i], i);
      }
    }
  );
  await Promise.all(workers);
  return out;
}
