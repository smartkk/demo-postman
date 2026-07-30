declare module 'http-mitm-proxy' {
  export class Proxy {
    onError(fn: (ctx: any, err?: Error, errorKind?: string) => void): void;
    onConnect(fn: (req: any, socket: any, head: any, cb: () => void) => void): void;
    onRequest(fn: (ctx: any, callback: (err?: Error | null) => void) => void): void;
    onRequestData(
      fn: (ctx: any, chunk: Buffer, callback: (err?: Error | null, chunk?: Buffer) => void) => void
    ): void;
    onRequestEnd(fn: (ctx: any, callback: (err?: Error | null) => void) => void): void;
    listen(options: { port?: number; host?: string; sslCaDir?: string }, callback?: () => void): void;
    close(): void;
  }
}
