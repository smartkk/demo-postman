import http from 'node:http';
import https from 'node:https';
import type { CaptureInput, ResponseRecord } from '../../shared/types';

const MAX_REDIRECTS = 5;
const MAX_BODY = 8 * 1024 * 1024; // 8MB

/**
 * 在 Electron 主进程侧发送 HTTP/HTTPS 请求（绕过浏览器 CORS/代理限制），
 * 返回状态码、响应头、响应体与耗时。支持 30x 重定向（最多 5 次）。
 *
 * 注意：不设置请求超时（既不设 socket timeout，也不主动 destroy），
 * 请求会一直等待服务端响应，直到服务端返回、底层连接出错，或调用方通过 signal 取消。
 */
export function sendRequest(
  input: CaptureInput,
  redirects = 0,
  signal?: AbortSignal
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
      // 允许自签名/内网证书（开发调试场景）
      rejectUnauthorized: false,
    };

    const start = Date.now();
    const onAbort = () => {
      req.destroy();
      reject(new Error('已取消'));
    };
    signal?.addEventListener('abort', onAbort);

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
        // 当前请求的生命周期已结束，移除 abort 监听，避免泄漏
        signal?.removeEventListener('abort', onAbort);
        res.resume(); // 丢弃当前响应体
        sendRequest(
          {
            ...input,
            url: nextUrl.toString(),
            method: nextMethod,
            body: status === 303 ? null : body,
          },
          redirects + 1,
          signal // 透传取消信号，保证重定向链中也能取消
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
          req.destroy();
          reject(new Error('响应体过大（超过 8MB）'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        signal?.removeEventListener('abort', onAbort);
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
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    if (body) req.write(body);
    req.end();
  });
}
