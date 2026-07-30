const DEFAULT_ENDPOINT = 'http://127.0.0.1:8891';

const enabledEl = document.getElementById('enabled');
const endpointEl = document.getElementById('endpoint');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const lastUrlEl = document.getElementById('lastUrl');
const clearCountEl = document.getElementById('clearCount');
const excludeStaticEl = document.getElementById('excludeStatic');
const includeHostsEl = document.getElementById('includeHosts');
const excludeHostsEl = document.getElementById('excludeHosts');
const addMethodEl = document.getElementById('addMethod');
const addUrlEl = document.getElementById('addUrl');
const addBtnEl = document.getElementById('addBtn');
const addStatusEl = document.getElementById('addStatus');

function setStatus(enabled, reachable) {
  if (!enabled) {
    statusEl.className = 'status off';
    statusEl.textContent = '已暂停捕获';
  } else if (reachable) {
    statusEl.className = 'status on';
    statusEl.textContent = '已连接，正在记录';
  } else {
    statusEl.className = 'status off';
    statusEl.textContent = '未连接（请先在桌面端开启插件端点）';
  }
}

async function checkReachable(endpoint) {
  try {
    const res = await fetch(endpoint.replace(/\/+$/, '') + '/api/capture', {
      method: 'OPTIONS',
    });
    return res.status === 204 || res.ok;
  } catch {
    return false;
  }
}

function renderStats() {
  chrome.storage.local.get(['capturedCount', 'lastCapturedUrl'], (s) => {
    const count = s.capturedCount || 0;
    countEl.textContent = String(count);
    if (s.lastCapturedUrl) {
      const u = s.lastCapturedUrl;
      lastUrlEl.textContent = u.length > 60 ? u.slice(0, 60) + '…' : u;
    } else {
      lastUrlEl.textContent = '尚未捕获请求';
    }
  });
}

async function load() {
  chrome.storage.local.get(
    ['endpoint', 'enabled', 'excludeStatic', 'includeHosts', 'excludeHosts', 'capturedCount', 'lastCapturedUrl'],
    async (s) => {
      enabledEl.checked = s.enabled !== false;
      endpointEl.value = s.endpoint || DEFAULT_ENDPOINT;
      excludeStaticEl.checked = s.excludeStatic !== false;
      includeHostsEl.value = s.includeHosts || '';
      excludeHostsEl.value = s.excludeHosts || '';
      renderStats();
      const reachable = await checkReachable(endpointEl.value);
      setStatus(enabledEl.checked, reachable);
    }
  );
}

enabledEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: enabledEl.checked });
  const reachable = await checkReachable(endpointEl.value);
  setStatus(enabledEl.checked, reachable);
});

endpointEl.addEventListener('change', async () => {
  const url = endpointEl.value.trim() || DEFAULT_ENDPOINT;
  endpointEl.value = url;
  await chrome.storage.local.set({ endpoint: url });
  const reachable = await checkReachable(url);
  setStatus(enabledEl.checked, reachable);
});

excludeStaticEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ excludeStatic: excludeStaticEl.checked });
});

includeHostsEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ includeHosts: includeHostsEl.value });
});

excludeHostsEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ excludeHosts: excludeHostsEl.value });
});

clearCountEl.addEventListener('click', async () => {
  await chrome.storage.local.set({ capturedCount: 0, lastCapturedUrl: '' });
  chrome.action.setBadgeText({ text: '' });
  renderStats();
});

function setAddStatus(msg, ok) {
  addStatusEl.textContent = msg;
  addStatusEl.className = 'addStatus ' + (ok ? 'ok' : 'err');
}

addBtnEl.addEventListener('click', async () => {
  const url = addUrlEl.value.trim();
  if (!url) {
    setAddStatus('请填写 URL', false);
    return;
  }
  const method = addMethodEl.value;
  const endpoint = endpointEl.value.trim() || DEFAULT_ENDPOINT;
  setAddStatus('发送中…', true);
  try {
    const res = await fetch(endpoint.replace(/\/+$/, '') + '/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, url, headers: {}, body: null, contentType: null }),
    });
    if (res.ok) {
      setAddStatus('已添加到桌面端', true);
      addUrlEl.value = '';
    } else {
      setAddStatus('添加失败（端点返回 ' + res.status + '）', false);
    }
  } catch {
    setAddStatus('连接失败，请检查端点', false);
  }
});

// 捕获计数变化时实时刷新（popup 打开期间）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.capturedCount || changes.lastCapturedUrl)) {
    renderStats();
  }
});

load();
