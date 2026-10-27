import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Proxy } from 'http-mitm-proxy';
import type { MitmCtx } from 'http-mitm-proxy';
import type { CaptureInput, ResponseRecord } from '../../shared/types';

/**
 * 单条请求 / 响应体最多缓存的字节数。
 * 超出后丢弃已收集的内容但保留请求元信息，避免大文件下载把主进程内存顶满
 * （store 落盘时还会再截断一次到 1MB，这里留足余量）。
 */
const MAX_CAPTURE_BODY = 2 * 1024 * 1024; // 2MB

interface CaptureCtx {
  method: string;
  url: string;
  headers: Record<string, string>;
  contentType: string | null;
  startedAt: number;
  // ── 请求体 ──
  reqChunks: Buffer[];
  reqSize: number;
  // ── 响应 ──
  status: number;
  statusText: string;
  respHeaders: Record<string, string>;
  respChunks: Buffer[];
  respSize: number;
}

/** 把 Node 原始 headers 规整成 string->string。 */
function headersOf(raw: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k in raw || {}) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? (v as string[]).join(', ') : String(v);
  }
  return out;
}

/** 取出 onRequest 时挂到 ctx 上的捕获上下文（可能尚未创建）。 */
function captureOf(ctx: MitmCtx): CaptureCtx | undefined {
  return ctx._capture as CaptureCtx | undefined;
}

/**
 * 把可能经过压缩的响应体还原为文本。
 * 代理层拿到的是传输态数据（常为 gzip / br），直接 toString 会得到乱码，
 * 因此按 content-encoding 解压；无法解压时返回空串（仍保留状态与头部）。
 */
function decodeBody(buf: Buffer, contentEncoding: string): string {
  if (!buf.length) return '';
  const enc = (contentEncoding || '').toLowerCase().trim();
  try {
    if (!enc || enc === 'identity') return buf.toString('utf8');
    if (enc === 'gzip') return zlib.gunzipSync(buf).toString('utf8');
    if (enc === 'deflate') return zlib.inflateSync(buf).toString('utf8');
    if (enc === 'br') return zlib.brotliDecompressSync(buf).toString('utf8');
  } catch {
    /* 解压失败（如数据不完整）时放弃响应体，不影响状态与头部的记录 */
  }
  return '';
}

/**
 * 捕获代理：监听本地端口，拦截经过的 HTTP/HTTPS 请求，
 * 解析出 method/url/headers/body 后回调 onCapture；响应返回时回调 onResponse。
 * HTTPS 通过自签 CA（MITM）解密；CA 证书位于 caDir/ca.pem，需被客户端信任。
 */
export class CaptureProxy {
  private proxy: Proxy | null = null;
  private port: number;
  private caDir: string;
  private onCapture: (input: CaptureInput) => void;
  private onResponse?: (
    method: string,
    url: string,
    response: ResponseRecord
  ) => void;

  constructor(
    port: number,
    caDir: string,
    onCapture: (input: CaptureInput) => void,
    onResponse?: (method: string, url: string, response: ResponseRecord) => void
  ) {
    this.port = port;
    this.caDir = caDir;
    this.onCapture = onCapture;
    this.onResponse = onResponse;
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

  /**
   * 启动代理。
   * @param onReady 监听成功后的回调。首次启动会生成自签 CA（可能数百毫秒），
   *                调用方需要确定「已开始监听」时应传此回调，而不是靠固定 sleep 猜。
   */
  start(onReady?: () => void): void {
    if (this.proxy) return;
    if (!fs.existsSync(this.caDir)) fs.mkdirSync(this.caDir, { recursive: true });

    const proxy = new Proxy();
    let listening = false;

    proxy.onError((_ctx: MitmCtx, err?: Error, errorKind?: string) => {
      // listen 的失败（典型是端口被占用的 EADDRINUSE）是异步抛出的，
      // 同步 try/catch 抓不到。未确认监听成功前出现的错误一律视为启动失败，
      // 回退状态，避免 UI 显示「已启动」而实际并未监听。
      if (!listening) {
        this.proxy = null;
        console.error('[proxy] 启动失败', errorKind, err?.message || err);
        return;
      }
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ECONNRESET' && code !== 'EPIPE') {
        console.error('[proxy] error', errorKind, err?.message || err);
      }
    });

    proxy.onRequest((ctx: MitmCtx, callback: (e?: Error | null) => void) => {
      const req = ctx.clientToProxyRequest;
      const method = (req.method || 'GET').toUpperCase();
      const host = (req.headers['host'] as string) || '';
      let url: string = req.url || '/';
      // HTTP 代理下 req.url 常为 origin-form（如 /path?x=1），需结合 Host 头还原完整 URL
      if (!/^https?:\/\//i.test(url)) {
        const scheme = ctx.isSSL ? 'https' : 'http';
        url = `${scheme}://${host}${url}`;
      }
      const headers = headersOf(req.headers);
      const cap: CaptureCtx = {
        method,
        url,
        headers,
        contentType: headers['content-type'] || null,
        startedAt: Date.now(),
        reqChunks: [],
        reqSize: 0,
        status: 0,
        statusText: '',
        respHeaders: {},
        respChunks: [],
        respSize: 0,
      };
      ctx._capture = cap;
      callback();
    });

    proxy.onRequestData(
      (ctx: MitmCtx, chunk: Buffer, callback: (e?: Error | null, c?: Buffer) => void) => {
        const cap = captureOf(ctx);
        if (cap) {
          cap.reqSize += chunk.length;
          if (cap.reqSize > MAX_CAPTURE_BODY) {
            // 超大请求体：丢掉内容但保留元信息，防止内存被单个上传撑爆
            cap.reqChunks.length = 0;
          } else {
            cap.reqChunks.push(chunk);
          }
        }
        callback(null, chunk);
      }
    );

    proxy.onRequestEnd((ctx: MitmCtx, callback: (e?: Error | null) => void) => {
      const cap = captureOf(ctx);
      if (cap) {
        const body = cap.reqChunks.length
          ? Buffer.concat(cap.reqChunks).toString('utf8')
          : '';
        this.onCapture({
          method: cap.method,
          url: cap.url,
          headers: cap.headers,
          body: body || null,
          contentType: cap.contentType,
        });
      }
      callback();
    });

    // ── 响应捕获：让走系统代理抓到的接口也能看到响应 ──
    proxy.onResponse((ctx: MitmCtx, callback: (e?: Error | null) => void) => {
      const cap = captureOf(ctx);
      const res = ctx.serverToProxyResponse;
      if (cap && res) {
        cap.status = res.statusCode || 0;
        cap.statusText = res.statusMessage || '';
        cap.respHeaders = headersOf(res.headers);
      }
      callback();
    });

    proxy.onResponseData(
      (ctx: MitmCtx, chunk: Buffer, callback: (e?: Error | null, c?: Buffer) => void) => {
        const cap = captureOf(ctx);
        if (cap && cap.respSize <= MAX_CAPTURE_BODY) {
          cap.respSize += chunk.length;
          cap.respChunks.push(chunk);
        }
        callback(null, chunk);
      }
    );

    proxy.onResponseEnd((ctx: MitmCtx, callback: (e?: Error | null) => void) => {
      const cap = captureOf(ctx);
      if (cap && this.onResponse && cap.status) {
        const buf = cap.respChunks.length
          ? Buffer.concat(cap.respChunks)
          : Buffer.alloc(0);
        this.onResponse(cap.method, cap.url, {
          status: cap.status,
          statusText: cap.statusText,
          headers: cap.respHeaders,
          body: decodeBody(buf, cap.respHeaders['content-encoding'] || ''),
          durationMs: Date.now() - cap.startedAt,
          at: new Date().toISOString(),
        });
      }
      callback();
    });

    try {
      // 显式绑定 127.0.0.1：库默认 host 为 "localhost"，在 Windows 上常解析为
      // IPv6（::1）导致仅监听 v6，而界面提示用户配置 127.0.0.1 会被拒绝。
      proxy.listen({ host: '127.0.0.1', port: this.port, sslCaDir: this.caDir }, () => {
        listening = true;
        console.log(`[proxy] 捕获代理已启动: 127.0.0.1:${this.port}`);
        onReady?.();
      });
      this.proxy = proxy;
    } catch (err) {
      // 只有同步参数错误等才会走到这里
      this.proxy = null;
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
