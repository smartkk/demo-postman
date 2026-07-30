// 轻量 curl 命令解析器（无第三方依赖，可在渲染进程 / 主进程 / Node 测试中共用）。
// 支持常见写法：curl [--request|-X] [-H|--header] [-d|--data(--raw|--binary|--urlencode)]
//   [-u|--user] [-b|--cookie] [-A|--user-agent] [-e|--referer] [-G|--get] [--compressed] [--url] <URL>

export interface ParsedCurl {
  method: string;
  url: string; // 不含 query 的基础 url
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string | null;
}

// 简单的 shell 风格分词：处理单/双引号与反斜杠转义。
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++;
    if (i >= n) break;

    let tok = '';
    while (i < n) {
      const c = input[i];
      if (c === '\\') {
        i++;
        if (i < n) {
          const nc = input[i];
          // shell 换行续行：\<newline> → 跳过，不加入 token
          if (nc === '\n') {
            i++;
            continue;
          }
          if (nc === '\r') {
            i++;
            if (i < n && input[i] === '\n') i++;
            continue;
          }
          tok += nc;
        }
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        const quote = c;
        i++;
        while (i < n && input[i] !== quote) {
          if (input[i] === '\\' && quote === '"') {
            i++;
            if (i < n) tok += input[i];
          } else {
            tok += input[i];
          }
          i++;
        }
        i++; // 跳过闭合引号
        continue;
      }
      if (/\s/.test(c)) break;
      tok += c;
      i++;
    }
    if (tok) tokens.push(tok);
  }
  return tokens;
}

function parseQueryString(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) {
      out[decodeURIComponent(pair)] = '';
    } else {
      const k = decodeURIComponent(pair.slice(0, eq));
      const v = decodeURIComponent(pair.slice(eq + 1));
      out[k] = v;
    }
  }
  return out;
}

function base64Encode(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf-8').toString('base64');
  }
  if (typeof btoa !== 'undefined') {
    // btoa 仅支持 Latin1，这里用 encodeURIComponent 转义后再解码以支持 UTF-8
    return btoa(unescape(encodeURIComponent(input)));
  }
  // 兜底：极简 ASCII base64（理论上不会走到这里）
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const b0 = input.charCodeAt(i);
    const b1 = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
    const b2 = i + 2 < input.length ? input.charCodeAt(i + 2) : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < input.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < input.length ? chars[b2 & 63] : '=';
  }
  return out;
}

export function parseCurl(input: string): ParsedCurl {
  const tokens = tokenize(input);
  let idx = 0;
  if (tokens[idx] === 'curl') idx++;

  let method = 'GET';
  let explicitMethod = false;
  let url = '';
  const headers: Record<string, string> = {};
  let body: string | null = null;
  let getMode = false;

  const takeValue = (): string => {
    const v = tokens[idx + 1] ?? '';
    idx += 2;
    return v;
  };

  while (idx < tokens.length) {
    const t = tokens[idx];
    if (t === '-X' || t === '--request') {
      method = takeValue().toUpperCase() || 'GET';
      explicitMethod = true;
    } else if (t === '-H' || t === '--header') {
      const h = takeValue();
      const ci = h.indexOf(':');
      if (ci > 0) {
        const k = h.slice(0, ci).trim();
        const v = h.slice(ci + 1).trim();
        headers[k] = v;
      }
    } else if (
      t === '-d' ||
      t === '--data' ||
      t === '--data-raw' ||
      t === '--data-binary' ||
      t === '--data-urlencode'
    ) {
      body = takeValue();
    } else if (t === '-u' || t === '--user') {
      const up = takeValue();
      headers['Authorization'] = 'Basic ' + base64Encode(up);
    } else if (t === '-b' || t === '--cookie') {
      headers['Cookie'] = takeValue();
    } else if (t === '-A' || t === '--user-agent') {
      headers['User-Agent'] = takeValue();
    } else if (t === '-e' || t === '--referer') {
      headers['Referer'] = takeValue();
    } else if (t === '--url') {
      url = takeValue() || url;
    } else if (t === '-G' || t === '--get') {
      getMode = true;
      idx += 1;
    } else if (t === '--compressed' || t === '--location' || t === '-L') {
      idx += 1;
    } else if (t.startsWith('-') && t !== '-') {
      // 未知 flag：跳过 flag 本身及可能携带的值
      idx += 1;
      if (idx < tokens.length && !tokens[idx].startsWith('-')) idx += 1;
    } else {
      // 位置参数：第一个是 URL，其余作为兜底 data
      if (!url) url = t;
      else if (body === null) body = t;
      idx += 1;
    }
  }

  // -G 模式下 -d 的内容会被追加到 URL 作为 query
  if (getMode) {
    if (!explicitMethod) method = 'GET';
    if (body) {
      const q = parseQueryString(body);
      body = null;
      // 先占位，下面统一合并到 query
      (headers as Record<string, string> & { __getQuery?: Record<string, string> }).__getQuery = q;
    }
  } else if (!explicitMethod && method === 'GET' && body !== null) {
    method = 'POST';
  }

  // 拆分 URL 中的 query
  const query: Record<string, string> = {};
  if (url) {
    const qIndex = url.indexOf('?');
    if (qIndex >= 0) {
      const qs = url.slice(qIndex + 1);
      url = url.slice(0, qIndex);
      Object.assign(query, parseQueryString(qs));
    }
  }
  const getQuery = (headers as Record<string, string> & { __getQuery?: Record<string, string> }).__getQuery;
  if (getQuery) {
    Object.assign(query, getQuery);
    delete (headers as Record<string, string> & { __getQuery?: Record<string, string> }).__getQuery;
  }

  return { method, url, headers, query, body };
}
