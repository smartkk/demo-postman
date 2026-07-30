import type { CaptureSettings } from '../shared/types';

/** 本地服务端口：这些端口上的请求（如插件回传端点、捕获代理本身）不纳入抓取，避免回环。 */
const LOCAL_SERVICE_PORTS = new Set(['8891', '8899']);

/** 将逗号/换行分隔的字符串解析为过滤规则数组。 */
export function parseList(v: unknown): string[] {
  if (!v) return [];
  return String(v)
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * 主机匹配：支持 "*" 前缀的通配（如 *.example.com 匹配任意子域），
 * 或精确匹配 / 子域匹配（example.com 也匹配 a.example.com）。
 */
export function matchHost(host: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.startsWith('*')) return host.endsWith(pattern.slice(1));
  return host === pattern || host.endsWith('.' + pattern);
}

/** 提取 url 的 hostname（不含端口）。非法 url 返回空串。 */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 综合过滤判断：该 url 是否应当被抓取。
 * - 跳过本地服务端口（8891/8899）请求，避免插件回传被代理再次抓取形成回环；
 * - excludeHosts 命中则跳过；
 * - includeHosts 非空时，未命中则跳过。
 */
export function shouldCapture(
  url: string,
  settings: Pick<CaptureSettings, 'includeHosts' | 'excludeHosts'>
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (
    (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
    LOCAL_SERVICE_PORTS.has(u.port)
  ) {
    return false;
  }
  const host = u.hostname;
  if (settings.excludeHosts.some((p) => matchHost(host, p))) return false;
  if (
    settings.includeHosts.length &&
    !settings.includeHosts.some((p) => matchHost(host, p))
  ) {
    return false;
  }
  return true;
}
