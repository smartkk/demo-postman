import http from 'node:http';
import type { CaptureInput, ResponseRecord } from '../../shared/types';

const MAX_BODY = 5 * 1024 * 1024; // 5MB 上限，防止异常大请求撑爆内存

/**
 * 浏览器插件接收端点：在本地固定端口暴露一个 HTTP 服务，
 * 接收 Chrome 扩展（DevTools/Network 协议）捕获后 POST 过来的数据：
 *   - /api/capture          ：请求本身（method/url/headers/body）
 *   - /api/capture-response ：该请求对应的响应结果（status/headers/body）
 * 二者都交给与代理相同的 store 做去重与参数更新。
 */
export class ExtensionReceiver {
  private server: http.Server | null = null;
  private port: number;
  private onCapture: (input: CaptureInput) => void;
  private onResponse: (method: string, url: string, response: ResponseRecord) => void;

  constructor(
    port: number,
    onCapture: (input: CaptureInput) => void,
    onResponse: (method: string, url: string, response: ResponseRecord) => void
  ) {
    this.port = port;
    this.onCapture = onCapture;
    this.onResponse = onResponse;
  }

  get portNumber(): number {
    return this.port;
  }

  get running(): boolean {
    return this.server !== null;
  }

  start(): void {
    if (this.server) return;

    const server = http.createServer((req, res) => {
      // 允许跨域（扩展 background fetch 会受 CORS 限制）
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const path = (req.url || '').split('?')[0];
      if (
        req.method !== 'POST' ||
        (path !== '/api/capture' && path !== '/api/capture-response')
      ) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
        return;
      }

      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'payload too large' }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });

      req.on('end', () => {
        let payload: Record<string, unknown> | null = null;
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        } catch {
          // 忽略非法 JSON
        }
        if (!payload || !payload.url || !payload.method) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid payload' }));
          return;
        }

        if (path === '/api/capture') {
          this.onCapture({
            method: String(payload.method),
            url: String(payload.url),
            headers: (payload.headers as Record<string, string>) || undefined,
            body: (payload.body as string | null) ?? null,
            contentType: (payload.contentType as string | null) ?? null,
          });
        } else {
          const resp = payload.response as Record<string, unknown> | undefined;
          if (!resp || typeof resp.status !== 'number') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'invalid response' }));
            return;
          }
          this.onResponse(String(payload.method), String(payload.url), {
            status: resp.status,
            statusText: typeof resp.statusText === 'string' ? resp.statusText : '',
            headers: (resp.headers as Record<string, string>) || {},
            body: typeof resp.body === 'string' ? resp.body : '',
            durationMs: typeof resp.durationMs === 'number' ? resp.durationMs : 0,
            at: typeof resp.at === 'string' ? resp.at : new Date().toISOString(),
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    server.on('error', (err) => {
      console.error('[extension] 接收端点错误', err);
    });

    server.listen(this.port, '127.0.0.1', () => {
      this.server = server;
      console.log(
        `[extension] 插件接收端点已启动: http://127.0.0.1:${this.port}/api/capture`
      );
    });
  }

  stop(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch (e) {
        console.error('[extension] 关闭失败', e);
      }
      this.server = null;
    }
  }
}
