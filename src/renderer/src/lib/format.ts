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
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
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

function escapeShellSingle(s: string): string {
  // curl 单引号包裹时，内部单引号转义为 '\''
  return s.replace(/'/g, `'\\''`);
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
