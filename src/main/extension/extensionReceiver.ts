import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CaptureInput, ResponseRecord } from '../../shared/types';

const MAX_BODY = 5 * 1024 * 1024; // 5MB 上限，防止异常大请求撑爆内存

/** 本机来源：仅 127.0.0.1 / localhost（可带端口）。 */
const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

/** 鉴权头：扩展需带上与桌面端一致的本地 token，挡住本机其他程序灌数据。 */
const TOKEN_HEADER = 'x-demo-token';

/** 恒定时间比较，避免时序侧信道（token 是本机秘密，仍按稳妥方式比对）。 */
function tokenEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * 判断写入来源是否可信。
 *
 * - Host 必须是本机：挡住 DNS rebinding（把域名解析到 127.0.0.1 后带任意 Host 访问）。
 * - Origin 必须是扩展上下文或本机页面：挡住任意网页伪造抓取记录。
 * - 缺失 Origin 视为非浏览器客户端（扩展的 background fetch 早期版本、命令行调试），放行。
 */
function trustedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (host && !LOCAL_HOST_RE.test(host.toLowerCase())) return false;
  if (!origin) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
}

/**
 * 浏览器插件接收端点：在本地固定端口暴露一个 HTTP 服务，
 * 接收 Chrome 扩展（DevTools/Network 协议）捕获后 POST 过来的数据：
 *   - /api/capture          ：请求本身（method/url/headers/body）
 *   - /api/capture-response ：该请求对应的响应结果（status/headers/body）
 * 二者都交给与代理相同的 store 做去重与参数更新。
 *
 * 写入需携带 x-demo-token 头（值等于 token 文件内容），防止本机其他程序滥用；
 * token 持久化在 tokenFile，首次启动随机生成，用户在扩展弹窗中填写即可。
 */
export class ExtensionReceiver {
  private server: http.Server | null = null;
  private port: number;
  private tokenFile: string;
  private token: string;
  private onCapture: (input: CaptureInput) => void;
  private onResponse: (method: string, url: string, response: ResponseRecord) => void;

  constructor(
    port: number,
    tokenFile: string,
    onCapture: (input: CaptureInput) => void,
    onResponse: (method: string, url: string, response: ResponseRecord) => void
  ) {
    this.port = port;
    this.tokenFile = tokenFile;
    this.onCapture = onCapture;
    this.onResponse = onResponse;
    this.token = this.loadOrCreateToken();
  }

  /** 读取已持久化的 token，不存在则随机生成并落盘。 */
  private loadOrCreateToken(): string {
    try {
      if (fs.existsSync(this.tokenFile)) {
        const existing = fs.readFileSync(this.tokenFile, 'utf8').trim();
        if (existing) return existing;
      }
      const generated = crypto.randomBytes(24).toString('hex');
      fs.mkdirSync(path.dirname(this.tokenFile), { recursive: true });
      fs.writeFileSync(this.tokenFile, generated, 'utf8');
      return generated;
    } catch (err) {
      // 文件不可写（如只读目录）时退回到进程内随机值：本次运行仍受保护
      console.error('[extension] token 持久化失败，使用临时 token', err);
      return crypto.randomBytes(24).toString('hex');
    }
  }

  get portNumber(): number {
    return this.port;
  }

  /** 当前鉴权 token（供 UI 展示，用户复制到扩展弹窗）。 */
  get authToken(): string {
    return this.token;
  }

  get running(): boolean {
    return this.server !== null;
  }

  start(): void {
    if (this.server) return;

    const server = http.createServer((req, res) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (!trustedOrigin(origin, host)) {
        console.warn(
          '[extension] 已拒绝非可信来源的写入',
          `origin=${origin || '(无)'} host=${host || '(无)'}`
        );
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }));
        return;
      }

      // 只回显可信来源，不再无差别放行 "*"：
      // 否则本地浏览的任意网页都能向 8891 端口 POST 伪造的接口记录。
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      // 预检需放行鉴权头，否则浏览器跨域 POST 会被拦在预检
      res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${TOKEN_HEADER}`);

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

      // 本地 token 鉴权：仅放行携带正确 token 的写入（扩展弹窗里配置）
      const provided = req.headers[TOKEN_HEADER];
      const providedStr = Array.isArray(provided) ? provided[0] : provided || '';
      if (!tokenEquals(providedStr, this.token)) {
        console.warn('[extension] 已拒绝 token 不匹配的写入');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid token' }));
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
