// Demo Postman 浏览器扩展后台：捕获页面发出的请求并发送到桌面端接收端点。
//
// 为什么用 DevTools 协议（chrome.debugger / Network）而不是 webRequest？
//   MV3 的 chrome.webRequest.onBeforeRequest 虽然能拿到 requestBody，但对 fetch 流式
//   上传的请求，requestBody 常常为 null，导致 POST 的 body 丢失。而 DevTools 协议的
//   Network.requestWillBeSent 事件中的 request.postData 由浏览器自身提供，可稳定拿到
//   任意请求（含 fetch）的请求体，是 MV3 下可靠捕获 body 的唯一方式。
//
// 代价：附加调试器后，被捕获的标签页会显示「已附加远程调试」提示条。这是 MV3 获取
// 请求体的固有成本。仅在「启用捕获」时附加调试器，关闭即卸载。

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8891';

// 默认跳过的静态资源扩展名，减少噪音
const STATIC_EXT = new Set([
  'js', 'mjs', 'cjs', 'css', 'less', 'scss', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'mp4', 'webm', 'ogg', 'wav', 'flac',
  'zip', 'gz', 'tar', 'pdf', 'json', 'xml', 'txt',
]);

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['endpoint', 'enabled', 'excludeStatic', 'includeHosts', 'excludeHosts', 'token'],
      (s) => {
        resolve({
          endpoint: (s.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, ''),
          enabled: s.enabled !== false, // 默认启用
          excludeStatic: s.excludeStatic !== false, // 默认跳过静态资源
          includeHosts: parseList(s.includeHosts),
          excludeHosts: parseList(s.excludeHosts),
          token: s.token || '', // 桌面端插件鉴权 Token（x-demo-token）
        });
      }
    );
  });
}

// 将逗号/换行分隔的字符串解析为过滤规则数组
function parseList(v) {
  if (!v) return [];
  return String(v)
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// 主机匹配：支持 "*" 前缀的通配（如 *.example.com）或精确/子域匹配
function matchHost(host, pattern) {
  if (!pattern) return false;
  if (pattern.startsWith('*')) return host.endsWith(pattern.slice(1));
  return host === pattern || host.endsWith('.' + pattern);
}

function isStaticAsset(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.toLowerCase().split('?')[0].split('#')[0];
    const ext = seg.includes('.') ? seg.split('.').pop() : '';
    return STATIC_EXT.has(ext);
  } catch {
    return false;
  }
}

function isSelfEndpoint(url, endpoint) {
  if (!url || !endpoint) return false;
  const base = endpoint.split('/api')[0];
  return url.startsWith(base);
}

// 综合过滤判断：是否应当捕获该请求
function shouldCapture(url, settings) {
  if (!url || url.startsWith('chrome-extension://')) return false;
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  if (isSelfEndpoint(url, settings.endpoint)) return false; // 不捕获接收端点自身的请求
  if (settings.excludeStatic && isStaticAsset(url)) return false;
  if (settings.excludeHosts.some((p) => matchHost(host, p))) return false;
  if (settings.includeHosts.length && !settings.includeHosts.some((p) => matchHost(host, p))) {
    return false;
  }
  return true;
}

// CDP 的 request.headers 可能是对象 {name: value} 或数组 [{name,value}]
function headersToRecord(headers) {
  const obj = {};
  if (!headers) return obj;
  if (Array.isArray(headers)) {
    for (const h of headers) if (h && h.name) obj[h.name] = h.value;
  } else {
    for (const [k, v] of Object.entries(headers)) obj[k] = v;
  }
  return obj;
}

// 更新捕获计数与角标
async function bumpCount(url) {
  try {
    const data = await chrome.storage.local.get(['capturedCount']);
    const count = (data.capturedCount || 0) + 1;
    await chrome.storage.local.set({
      capturedCount: count,
      lastCapturedUrl: url,
      lastCapturedAt: Date.now(),
    });
    chrome.action.setBadgeText({ text: count > 999 ? '999+' : String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9' });
  } catch {
    // 忽略角标更新异常
  }
}

function sendCapture(endpoint, method, url, headers, body, contentType, token) {
  return fetch(endpoint + '/api/capture', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ method, url, headers, body, contentType }),
  })
    .then(() => bumpCount(url))
    .catch(() => {
      // 桌面端未启动 / 端点未开启时静默忽略
    });
}

// 桌面端要求的鉴权头；未配置 token 时不发送（服务端会返回 401）
function authHeaders(token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['x-demo-token'] = token;
  return h;
}

// ---------- DevTools 协议捕获 ----------
let debuggerActive = false;

async function attachToTab(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
      maxPostDataSize: 8 * 1024 * 1024, // 8MB，覆盖绝大多数请求体
      maxResourceBufferSize: 5 * 1024 * 1024, // 响应体缓冲上限 5MB
    });
  } catch (e) {
    // 该标签已被其它调试器占用或无权限，忽略
  }
}

async function detachFromTab(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {
    // 忽略
  }
}

async function enableDebugger() {
  if (debuggerActive) return;
  debuggerActive = true;
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) if (t.id != null) await attachToTab(t.id);
}

function disableDebugger() {
  if (!debuggerActive) return;
  debuggerActive = false;
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) if (t.id != null) detachFromTab(t.id);
  });
}

// 记录已捕获请求，用于关联其响应（requestId -> 请求信息）
const requests = new Map();

// base64 -> UTF-8 文本
function b64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// 把抓取到的响应结果回传桌面端（/api/capture-response）
function sendResponse(endpoint, method, url, response, token) {
  return fetch(endpoint + '/api/capture-response', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ method, url, response }),
  }).catch(() => {
    // 桌面端未启动 / 端点未开启时静默忽略
  });
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (!debuggerActive || source.tabId == null) return;

  // 1) 请求发出：捕获请求并暂存，关联后续响应
  if (method === 'Network.requestWillBeSent') {
    const req = params.request;
    if (!req || !req.url) return;
    const settings = await getSettings();
    if (!settings.enabled) return;
    if (!shouldCapture(req.url, settings)) return;

    const headers = headersToRecord(req.headers);
    // postData 由浏览器提供，可稳定拿到 fetch 等任意请求体
    const body = req.hasPostData ? req.postData || null : null;
    const contentType = headers['content-type'] || null;
    requests.set(params.requestId, {
      endpoint: settings.endpoint,
      token: settings.token,
      method: req.method || 'GET',
      url: req.url,
      headers,
      body,
      contentType,
      startTs: params.timestamp,
    });
    sendCapture(
      settings.endpoint,
      req.method || 'GET',
      req.url,
      headers,
      body,
      contentType,
      settings.token
    );
    return;
  }

  const r = requests.get(params.requestId);
  if (!r) return; // 仅处理我们实际捕获过的请求

  // 2) 收到响应头：记录状态码与响应头
  if (method === 'Network.responseReceived') {
    const resp = params.response;
    if (resp) {
      r.respStatus = resp.status;
      r.respStatusText = resp.statusText;
      r.respHeaders = headersToRecord(resp.headers);
    }
    return;
  }

  // 3) 加载完成：取响应体并回传
  if (method === 'Network.loadingFinished') {
    let bodyStr = '';
    try {
      const res = await chrome.debugger.sendCommand(
        { tabId: source.tabId },
        'Network.getResponseBody',
        { requestId: params.requestId }
      );
      if (res && res.body) {
        bodyStr = res.base64Encoded ? b64ToUtf8(res.body) : res.body;
      }
    } catch (e) {
      // 部分资源/WebSocket 无法取响应体，忽略 body
    }
    const durationMs =
      r.startTs != null && params.timestamp != null
        ? Math.max(0, Math.round((params.timestamp - r.startTs) * 1000))
        : 0;
    sendResponse(r.endpoint, r.method, r.url, {
      status: r.respStatus || 0,
      statusText: r.respStatusText || '',
      headers: r.respHeaders || {},
      body: bodyStr,
      durationMs,
      at: new Date().toISOString(),
    }, r.token);
    requests.delete(params.requestId);
    return;
  }

  // 4) 加载失败：记录错误
  if (method === 'Network.loadingFailed') {
    sendResponse(r.endpoint, r.method, r.url, {
      status: 0,
      statusText: params.errorText || '加载失败',
      headers: {},
      body: '',
      durationMs: 0,
      at: new Date().toISOString(),
    }, r.token);
    requests.delete(params.requestId);
  }
});

chrome.debugger.onDetach.addListener(() => {
  // 用户手动卸载调试器时，标记为非激活
  debuggerActive = false;
});

// 新开/更新/关闭标签时维护调试器附加状态
chrome.tabs.onCreated.addListener((tab) => {
  if (debuggerActive && tab.id != null) attachToTab(tab.id);
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (debuggerActive && info.status === 'complete') attachToTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (debuggerActive) detachFromTab(tabId);
});

// 根据「启用捕获」开关启停调试器
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) {
    if (changes.enabled.newValue !== false) enableDebugger();
    else disableDebugger();
  }
});

// 启动时若启用，则附加调试器
getSettings().then((s) => {
  if (s.enabled) enableDebugger();
});

// 启动时恢复角标
chrome.storage.local.get(['capturedCount'], (data) => {
  const count = data.capturedCount || 0;
  if (count > 0) {
    chrome.action.setBadgeText({ text: count > 999 ? '999+' : String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9' });
  }
});
