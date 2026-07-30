import path from 'node:path';
import fs from 'node:fs';
import { Proxy } from 'http-mitm-proxy';
import type { CaptureInput } from '../../shared/types';

interface CaptureCtx {
  method: string;
  url: string;
  headers: Record<string, string>;
  contentType: string | null;
  chunks: Buffer[];
}

/**
 * 捕获代理：监听本地端口，拦截经过的 HTTP/HTTPS 请求，
 * 解析出 method/url/headers/body 后回调 onCapture。
 * HTTPS 通过自签 CA（MITM）解密；CA 证书位于 caDir/ca.pem，需被客户端信任。
 */
export class CaptureProxy {
  private proxy: any = null;
  private port: number;
  private caDir: string;
  private onCapture: (input: CaptureInput) => void;

  constructor(
    port: number,
    caDir: string,
    onCapture: (input: CaptureInput) => void
  ) {
    this.port = port;
    this.caDir = caDir;
    this.onCapture = onCapture;
  }

  get portNumber(): number {
    return this.port;
  }

  get caPath(): string | null {
    if (!this.proxy) return null;
    const p = path.join(this.caDir, 'ca.pem');
    return fs.existsSync(p) ? p : null;
  }

  get running(): boolean {
    return this.proxy !== null;
  }

  start(): void {
    if (this.proxy) return;
    if (!fs.existsSync(this.caDir)) fs.mkdirSync(this.caDir, { recursive: true });

    const proxy = new Proxy();

    proxy.onError((ctx: any, err?: Error, errorKind?: string) => {
      const code = (err as any)?.code;
      if (code !== 'ECONNRESET' && code !== 'EPIPE') {
        console.error('[proxy] error', errorKind, err?.message || err);
      }
    });

    proxy.onRequest((ctx: any, callback: (e?: Error | null) => void) => {
      const req = ctx.clientToProxyRequest;
      const method = (req.method || 'GET').toUpperCase();
      const host = (req.headers['host'] as string) || '';
      let url: string = req.url || '/';
      // HTTP 代理下 req.url 常为 origin-form（如 /path?x=1），需结合 Host 头还原完整 URL
      if (!/^https?:\/\//i.test(url)) {
        const scheme = ctx.isSSL ? 'https' : 'http';
        url = `${scheme}://${host}${url}`;
      }
      const headers: Record<string, string> = {};
      for (const k in req.headers) {
        const v = req.headers[k];
        headers[k] = Array.isArray(v) ? (v as string[]).join(', ') : (v as string);
      }
      const contentType = (headers['content-type'] as string) || null;
      const cap: CaptureCtx = { method, url, headers, contentType, chunks: [] };
      (ctx as any)._capture = cap;
      callback();
    });

    proxy.onRequestData(
      (ctx: any, chunk: Buffer, callback: (e?: Error | null, c?: Buffer) => void) => {
        const cap = (ctx as any)._capture as CaptureCtx | undefined;
        if (cap) cap.chunks.push(chunk);
        callback(null, chunk);
      }
    );

    proxy.onRequestEnd((ctx: any, callback: (e?: Error | null) => void) => {
      const cap = (ctx as any)._capture as CaptureCtx | undefined;
      if (cap) {
        const body = Buffer.concat(cap.chunks).toString('utf8') || null;
        this.onCapture({
          method: cap.method,
          url: cap.url,
          headers: cap.headers,
          body,
          contentType: cap.contentType,
        });
      }
      callback();
    });

    try {
      proxy.listen({ port: this.port, sslCaDir: this.caDir });
      this.proxy = proxy;
      console.log(`[proxy] 捕获代理已启动: 127.0.0.1:${this.port}`);
    } catch (err) {
      console.error('[proxy] 启动失败', err);
    }
  }

  stop(): void {
    if (this.proxy) {
      try {
        this.proxy.close();
      } catch (e) {
        console.error('[proxy] 关闭失败', e);
      }
      this.proxy = null;
    }
  }
}
