// 请求/响应体的类型识别、JSON 美化与语法高亮工具。

export type BodyKind = 'json' | 'form' | 'xml' | 'html' | 'text';

/** 根据 content-type 与内容启发式判断 body 类型，决定美化方式。 */
export function detectKind(
  contentType: string | null | undefined,
  text: string
): BodyKind {
  const ct = (contentType || '').toLowerCase();
  const t = text.trimStart();
  if (ct.includes('json')) return 'json';
  if (ct.includes('x-www-form-urlencoded')) return 'form';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('html')) return 'html';
  // 无明确 content-type 时的启发式
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (t.startsWith('<?xml') || /^<[a-zA-Z!]/.test(t)) {
    return t.includes('</') ? 'xml' : 'html';
  }
  if (/^[a-zA-Z0-9_.~-]+=/.test(t) && t.includes('=')) {
    try {
      new URLSearchParams(t);
      return 'form';
    } catch {
      /* ignore */
    }
  }
  return 'text';
}

/** 尝试把文本美化成 2 空格缩进的 JSON；失败返回 null。 */
export function tryPrettyJson(text: string): string | null {
  try {
    const obj = JSON.parse(text);
    return JSON.stringify(obj, null, 2);
  } catch {
    return null;
  }
}

/** 尝试把文本解析为 JSON 值；失败返回 null。供可折叠树视图使用。 */
export function parseJsonSafe(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 解析 application/x-www-form-urlencoded 为键值对。 */
export function parseFormUrlEncoded(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const usp = new URLSearchParams(text);
  usp.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/** 把 JSON 字符串转成带语法高亮 class 的 HTML（先转义，安全）。 */
export function syntaxHighlightJson(json: string): string {
  const esc = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = 'json-number';
      if (/^"/.test(m)) {
        cls = /:$/.test(m) ? 'json-key' : 'json-string';
      } else if (/true|false/.test(m)) {
        cls = 'json-boolean';
      } else if (/null/.test(m)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${m}</span>`;
    }
  );
}

/** 字节数（按 UTF-8 计算）。 */
export function byteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 人类可读的体积。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 超大响应体的硬截断阈值（字符数）。超过则默认只渲染前 N 字符，避免大 DOM 卡顿。 */
export const HARD_TRUNCATE_CHARS = 200_000;

/**
 * 若文本超过硬截断阈值，返回 { truncated, preview, rest }，
 * preview 为前 N 字符，rest 为剩余字符数；否则返回原样。
 */
export function hardTruncate(text: string): {
  truncated: boolean;
  preview: string;
  restChars: number;
} {
  if (text.length <= HARD_TRUNCATE_CHARS) {
    return { truncated: false, preview: text, restChars: 0 };
  }
  return {
    truncated: true,
    preview: text.slice(0, HARD_TRUNCATE_CHARS),
    restChars: text.length - HARD_TRUNCATE_CHARS,
  };
}

function escapeShellSingle(s: string): string {
  // curl 单引号包裹时，内部单引号转义为 '\''
  return s.replace(/'/g, `'\\''`);
}

/**
 * 把网络/请求相关的英文错误翻译成中文友好提示。
 * - Electron net / fetch 抛出的 Error 通常含 ERR_* 或连接失败描述
 * - 解析失败等内部异常也给出可读信息
 */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '未知错误');
  const map: [RegExp, string][] = [
    [/ERR_CONNECTION_REFUSED/i, '连接被拒绝：目标服务器未启动或无响应'],
    [/ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|timed out/i, '连接超时：服务器响应过慢或网络不通'],
    [/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i, '域名无法解析：请检查 URL 中的主机名'],
    [/ERR_INTERNET_DISCONNECTED/i, '网络已断开：当前设备无可用网络连接'],
    [/ERR_CERT|AUTHORITY_INVALID|SSL|certificate/i, 'SSL 证书错误：目标站点的证书不受信任或不匹配'],
    [/ERR_ABORTED/i, '请求被中止'],
    [/ERR_TOO_MANY_REDIRECTS/i, '重定向次数过多：可能存在环路'],
    [/Failed to fetch|NetworkError|net::/i, '网络请求失败：请检查地址、代理与网络'],
    [/Invalid URL|invalid uri|not a valid url/i, 'URL 不合法：请检查请求地址格式'],
    [/JSON/i, 'JSON 解析失败：响应内容不是合法 JSON'],
    [/timeout/i, '请求超时'],
  ];
  for (const [re, msg] of map) {
    if (re.test(raw)) return msg;
  }
  return raw;
}

/** 由请求信息构造可复制的 curl 命令。 */
export function buildCurl(input: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string | null;
  contentType?: string | null;
}): string {
  const url = input.url;
  let cmd = `curl -X ${input.method} '${url}'`;
  for (const [k, v] of Object.entries(input.headers || {})) {
    if (!v) continue;
    cmd += ` \\\n  -H '${escapeShellSingle(k)}: ${escapeShellSingle(v)}'`;
  }
  if (input.body) {
    cmd += ` \\\n  -d '${escapeShellSingle(input.body)}'`;
  }
  return cmd;
}
