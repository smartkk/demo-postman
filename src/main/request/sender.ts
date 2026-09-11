import http from 'node:http';
import https from 'node:https';
import type { CaptureInput, ResponseRecord } from '../../shared/types';
import { getActiveSettings } from '../settings';

const MAX_REDIRECTS = 5;
const MAX_BODY = 8 * 1024 * 1024; // 8MB

/**
 * 自动场景（批量 / 链式 / 定时调度）的默认超时。
 *
 * 手动调试时不设超时是合理的——用户可能故意等一个慢接口，且随时可以取消。
 * 但自动场景没有人在旁边盯着：服务不可达时每轮都会挂住一批连接，
 * 20 并发的批量任务或周期性定时任务会不断累积永不释放的 socket。
 */
export const AUTO_TIMEOUT_MS = 30_000;

/**
 * 在 Electron 主进程侧发送 HTTP/HTTPS 请求（绕过浏览器 CORS/代理限制），
 * 返回状态码、响应头、响应体与耗时。支持 30x 重定向（最多 5 次）。
 *
 * @param timeoutMs 整体超时（毫秒）。不传表示不超时——仅适用于可手动取消的交互场景；
 *                  批量 / 链式 / 定时调度请传 AUTO_TIMEOUT_MS。超时会随重定向链传递，
 *                  即作用于整条链而非单跳。
 */
export function sendRequest(
  input: CaptureInput,
  redirects = 0,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<ResponseRecord> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('已取消'));
      return;
    }
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      reject(new Error('非法 URL: ' + input.url));
      return;
    }

    const method = (input.method || 'GET').toUpperCase();
    const isBodyMethod = !['GET', 'HEAD'].includes(method);
    const body = isBodyMethod ? input.body ?? null : null;

    // 复制并清理由 Node 自动处理的请求头
    const headers: Record<string, string> = { ...(input.headers || {}) };
    delete headers['host'];
    delete headers['content-length'];
    delete headers['connection'];
    delete headers['transfer-encoding'];

    const lib = url.protocol === 'https:' ? https : http;
    const options: http.RequestOptions & { rejectUnauthorized?: boolean } = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers,
      // 是否校验 TLS 证书：设置项 verifyTls 为 true 时严格校验，否则接受自签名/内网证书（默认）
      rejectUnauthorized: getActiveSettings()?.get().verifyTls ?? false,
    };

    const start = Date.now();
    let timer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      req.destroy();
      reject(new Error('已取消'));
    };
    signal?.addEventListener('abort', onAbort);

    /**
     * 统一的收尾：摘掉 abort 监听并清掉超时计时器。
     * 每个结束分支（正常 end / error / 重定向 / 响应体超限 / 超时）都必须调用，
     * 否则 AbortSignal 上会残留监听器，或留下一个游离的定时器。
     */
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const req = lib.request(options, (res) => {
      const status = res.statusCode || 0;
      const statusText = res.statusMessage || '';
      const respHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (v !== undefined) respHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
      }

      // 重定向处理
      if (
        [301, 302, 303, 307, 308].includes(status) &&
        respHeaders['location'] &&
        redirects < MAX_REDIRECTS
      ) {
        const nextUrl = new URL(respHeaders['location'], url);
        const nextMethod = status === 303 ? 'GET' : method;
        // 当前请求的生命周期已结束，摘掉监听并清计时器，避免泄漏
        cleanup();
        res.resume(); // 丢弃当前响应体
        sendRequest(
          {
            ...input,
            url: nextUrl.toString(),
            method: nextMethod,
            body: status === 303 ? null : body,
          },
          redirects + 1,
          signal, // 透传取消信号，保证重定向链中也能取消
          timeoutMs // 超时作用于整条重定向链，而非单跳
        )
          .then(resolve)
          .catch(reject);
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          // 与重定向 / 正常结束分支保持一致：先收尾再销毁请求，
          // 否则 AbortSignal 上会残留一个永远不会被移除的监听器（持有 req 引用）。
          cleanup();
          res.resume(); // 排空剩余数据，让底层连接得以释放
          req.destroy();
          reject(new Error('响应体过大（超过 8MB）'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        cleanup();
        const buf = Buffer.concat(chunks);
        resolve({
          status,
          statusText,
          headers: respHeaders,
          body: buf.toString('utf8'),
          durationMs: Date.now() - start,
          at: new Date().toISOString(),
        });
      });
    });

    req.on('error', (err) => {
      cleanup();
      reject(err);
    });

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        req.destroy();
        reject(new Error(`请求超时（超过 ${timeoutMs}ms）`));
      }, timeoutMs);
    }

    if (body) req.write(body);
    req.end();
  });
}
