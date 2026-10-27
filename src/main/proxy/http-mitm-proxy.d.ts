/**
 * http-mitm-proxy 未附带类型声明，这里按本项目用法最小化封装。
 * 仅声明用到的成员；ctx 形状参照库源码（lib/…）中实际挂载的字段。
 */
declare module 'http-mitm-proxy' {
  /** 规整前的 Node 原始 headers（值可能为 string / string[]）。 */
  export type RawHeaders = Record<string, unknown>;

  /** ctx.clientToProxyRequest：客户端发往代理的请求。 */
  export interface MitmRequest {
    method?: string;
    url?: string;
    headers: RawHeaders;
  }

  /** ctx.serverToProxyResponse：服务端返回给代理的响应。 */
  export interface MitmResponse {
    statusCode?: number;
    statusMessage?: string;
    headers: RawHeaders;
  }

  /** 代理回调上下文。 */
  export interface MitmCtx {
    clientToProxyRequest: MitmRequest;
    serverToProxyResponse?: MitmResponse;
    /** HTTPS（经 MITM 解密）连接时为 true。 */
    isSSL?: boolean;
    /** 本项目在 onRequest 时挂载的捕获上下文，类型由使用方泛化处理。 */
    _capture?: unknown;
  }

  export class Proxy {
    onError(fn: (ctx: MitmCtx, err?: Error, errorKind?: string) => void): void;
    onConnect(fn: (req: MitmRequest, socket: unknown, head: unknown, cb: () => void) => void): void;
    onRequest(fn: (ctx: MitmCtx, callback: (err?: Error | null) => void) => void): void;
    onRequestData(
      fn: (
        ctx: MitmCtx,
        chunk: Buffer,
        callback: (err?: Error | null, chunk?: Buffer) => void
      ) => void
    ): void;
    onRequestEnd(fn: (ctx: MitmCtx, callback: (err?: Error | null) => void) => void): void;
    onResponse(fn: (ctx: MitmCtx, callback: (err?: Error | null) => void) => void): void;
    onResponseData(
      fn: (
        ctx: MitmCtx,
        chunk: Buffer,
        callback: (err?: Error | null, chunk?: Buffer) => void
      ) => void
    ): void;
    onResponseEnd(fn: (ctx: MitmCtx, callback: (err?: Error | null) => void) => void): void;
    listen(
      options: { port?: number; host?: string; sslCaDir?: string },
      callback?: () => void
    ): void;
    close(): void;
  }
}
