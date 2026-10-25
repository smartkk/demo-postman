// Demo Postman GUI 黑盒测试 v2：仅通过 UI 控件模拟真实用户操作
// 修复 v2：弹窗内元素按弹窗作用域定位；每步开始前清理遗留遮罩；逐步核对服务端打点
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ART = __dirname;
const REPO = 'D:\\file\\github\\demo-postman';
const BASE = 'http://127.0.0.1:8765';

const results = [];
const consoleErrors = [];

const readHits = () => {
  try { return JSON.parse(fs.readFileSync(path.join(ART, 'hits.json'), 'utf8')); }
  catch { return { counter: 0, hits: [] }; }
};

async function step(win, name, fn) {
  const tag = name.replace(/[^\w\u4e00-\u9fa5]+/g, '_').slice(0, 40);
  // 防御：清理上一步可能遗留的弹窗遮罩
  try {
    const cancel = win.getByRole('button', { name: '取消' });
    if (await cancel.count() && await cancel.first().isVisible()) {
      await cancel.first().click({ timeout: 1500 });
      await win.waitForTimeout(300);
      console.log('  [cleanup] 关闭遗留弹窗');
    }
  } catch {}
  const hitsBefore = readHits().counter;
  try {
    const detail = await fn(win, async () => {
      await win.waitForTimeout(400);
      const p = path.join(ART, `t_${tag}.png`);
      await win.screenshot({ path: p });
      return p;
    });
    const delta = readHits().counter - hitsBefore;
    results.push({ name, status: 'PASS', detail: (detail || '') + ` [服务端命中+${delta}]`, shot: `t_${tag}.png` });
    console.log(`PASS  ${name}  ${detail || ''} [hits+${delta}]`);
  } catch (e) {
    const delta = readHits().counter - hitsBefore;
    const p = path.join(ART, `t_${tag}.png`);
    try { await win.screenshot({ path: p }); } catch {}
    try {
      fs.writeFileSync(path.join(ART, `t_${tag}.aria.yaml`), await win.locator('body').ariaSnapshot());
    } catch {}
    results.push({ name, status: 'FAIL', detail: String(e && e.message || e).slice(0, 400) + ` [服务端命中+${delta}]`, shot: `t_${tag}.png` });
    console.log(`FAIL  ${name}  ${String(e && e.message || e).slice(0, 160)} [hits+${delta}]`);
    // 失败后再次尝试清理弹窗，避免遮罩连锁
    try {
      const cancel = win.getByRole('button', { name: '取消' });
      if (await cancel.count() && await cancel.first().isVisible()) await cancel.first().click({ timeout: 1500 });
    } catch {}
  }
}

(async () => {
  const app = await electron.launch({
    args: [
      '.',
      `--user-data-dir=${path.join(ART, 'electron-data')}`,
      // 绕开 Google Fonts 远端字体：网络挂起时 document.fonts.ready 不完成会卡死截图
      '--disable-remote-fonts',
    ],
    cwd: REPO,
  });
  const win = await app.firstWindow();
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  win.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  const bodyHas = async (text) => (await win.getByText(text, { exact: false }).count()) > 0;
  const dumpAria = async (tag) => {
    try { fs.writeFileSync(path.join(ART, `aria_${tag}.yaml`), await win.locator('body').ariaSnapshot()); } catch {}
  };
  // 弹窗作用域：遮罩层内的玻璃面板
  const dlg = () => win.locator('div.fixed.inset-0').locator('div.glass').first();

  // ---------- T1 手动录入并保存（观察保存是否触发自动发送） ----------
  await step(win, 'T1_手动录入保存', async (win, shot) => {
    await win.getByRole('button', { name: '手动录入' }).click();
    await dlg().getByRole('textbox', { name: 'https://api.example.com/users' }).fill(`${BASE}/api/hello`);
    await dlg().getByRole('button', { name: '保存（自动去重）' }).click();
    await win.waitForTimeout(800);
    await shot();
    if (!(await bodyHas('/api/hello'))) throw new Error('侧栏未出现 /api/hello 记录');
    // 保存动作本身不应发起网络请求（此处 delta 由 step 包装器记录）
    return '侧栏出现接口记录';
  });

  // ---------- T2 详情面板发送请求 ----------
  await step(win, 'T2_发送请求并查看响应', async (win, shot) => {
    await win.getByText('/api/hello', { exact: false }).first().click();
    await win.waitForTimeout(600);
    await dumpAria('detail_panel');
    const sendBtn = win.getByRole('button', { name: /发送/ }).first();
    if (!(await sendBtn.count())) throw new Error('详情面板未找到「发送」按钮');
    await sendBtn.click();
    await win.waitForTimeout(1500);
    await shot();
    if (!(await bodyHas('TKN-9527'))) throw new Error('响应区未显示预期的 token TKN-9527');
    return '响应显示 hello from test server + TKN-9527';
  });

  // ---------- T3 弹窗内编辑 Query/Header 并发送 ----------
  await step(win, 'T3_Query与Header编辑发送', async (win, shot) => {
    await win.getByRole('button', { name: '手动录入' }).click();
    const d = dlg();
    await d.getByRole('textbox', { name: 'https://api.example.com/users' }).fill(`${BASE}/api/headers`);
    await d.getByRole('textbox', { name: 'key', exact: true }).fill('X-Test');
    await d.getByRole('textbox', { name: 'value', exact: true }).first().fill('abc123');
    await d.getByRole('textbox', { name: 'param', exact: true }).fill('foo');
    await d.getByRole('textbox', { name: 'value', exact: true }).nth(1).fill('bar');
    await shot();
    await d.getByRole('button', { name: '保存（自动去重）' }).click();
    await win.waitForTimeout(800);
    await win.getByText('/api/headers', { exact: false }).first().click();
    await win.waitForTimeout(500);
    await win.getByRole('button', { name: /发送/ }).first().click();
    await win.waitForTimeout(1500);
    await shot();
    if (!(await bodyHas('abc123'))) throw new Error('响应未回显自定义 Header X-Test: abc123');
    if (!(await bodyHas('foo=bar'))) throw new Error('响应未回显 Query 参数 foo=bar');
    return '服务端回显 X-Test=abc123 与 foo=bar';
  });

  // ---------- T4 cURL 导入 ----------
  await step(win, 'T4_cURL导入', async (win, shot) => {
    await win.getByRole('button', { name: '手动录入' }).click();
    const d = dlg();
    await d.getByRole('button', { name: '从 curl 导入' }).click();
    await win.waitForTimeout(400);
    const ta = d.locator('textarea').first();
    await ta.fill(`curl -X GET "${BASE}/api/counter" -H "X-From: curl-import"`);
    await shot();
    await d.getByRole('button', { name: '解析并填充' }).click();
    await win.waitForTimeout(500);
    const v = await d.getByRole('textbox', { name: 'https://api.example.com/users' }).inputValue();
    if (!v.includes('/api/counter')) throw new Error('解析后 URL 未回填，当前=' + v);
    await shot();
    await d.getByRole('button', { name: '保存（自动去重）' }).click();
    await win.waitForTimeout(800);
    if (!(await bodyHas('/api/counter'))) throw new Error('侧栏未出现 /api/counter 记录');
    return 'curl 解析回填并保存为接口';
  });

  // ---------- T5 链式请求：提取 token → 注入下一步 ----------
  await step(win, 'T5_链式请求两步工作流', async (win, shot) => {
    await win.getByRole('button', { name: '链式', exact: true }).click();
    await win.waitForTimeout(500);
    await win.getByRole('button', { name: '新建空白任务' }).click();
    await win.waitForTimeout(500);
    await win.getByRole('textbox', { name: '步骤名（引用键，如 login）' }).fill('login');
    await win.getByRole('textbox', { name: 'https://api.example.com/login' }).fill(`${BASE}/api/hello`);
    await win.getByRole('button', { name: '添加提取' }).click();
    await win.waitForTimeout(400);
    await win.getByRole('textbox', { name: '输出变量名' }).fill('token');
    await win.getByRole('textbox', { name: /JSON 路径/ }).fill('token');
    await shot();
    await win.getByRole('button', { name: '步骤', exact: true }).click();
    await win.waitForTimeout(500);
    await dumpAria('chain_step2');
    // 编辑器是“选中步骤”单编辑器：点击列表中的步骤 2（未填写地址）使其被选中
    const step2Item = win.getByText('（未填写地址）').first();
    if (!(await step2Item.count())) throw new Error('步骤列表未出现第 2 步');
    await step2Item.click();
    await win.waitForTimeout(400);
    await win.getByRole('textbox', { name: '步骤名（引用键，如 login）' }).fill('echo');
    await win.getByRole('textbox', { name: 'https://api.example.com/login' }).fill(`${BASE}/api/echo`);
    const combos = win.getByRole('combobox');
    const comboCount = await combos.count();
    if (comboCount < 2) throw new Error('combobox 数量异常=' + comboCount);
    await combos.nth(comboCount - 1).selectOption('POST');
    const bodyBox = win.getByRole('textbox', { name: /user.*uuid|\{\{ ?\\?"user/i }).last();
    if (!(await bodyBox.count())) throw new Error('未找到步骤 Body 输入框');
    await bodyBox.fill('{"t":"{{login.token}}"}');
    await shot();
    const runBtn = win.getByRole('button', { name: /运行（2 步）/ });
    if (!(await runBtn.count())) throw new Error('运行按钮未显示 2 步');
    await runBtn.click();
    await win.waitForTimeout(2500);
    await shot();
    await dumpAria('chain_result');
    if (!(await bodyHas('TKN-9527'))) throw new Error('链式结果未出现注入的 token（TKN-9527）');
    return '链式两步执行成功，步骤2 注入 {{login.token}}';
  });

  // ---------- T6 批量调用 ----------
  await step(win, 'T6_批量调用模板替换', async (win, shot) => {
    await win.getByRole('button', { name: '批量', exact: true }).click();
    await win.waitForTimeout(500);
    await win.getByRole('button', { name: '新建空白任务' }).click();
    await win.waitForTimeout(500);
    await win.getByRole('textbox', { name: 'https://api.example.com/users/{{id}}' }).fill(`${BASE}/api/echo?id={{id}}`);
    await shot();
    const runBtn = win.getByRole('button', { name: /运行（2 次）/ });
    if (!(await runBtn.count())) throw new Error('运行（2 次）按钮不存在');
    await runBtn.click();
    await win.waitForTimeout(2500);
    await shot();
    await dumpAria('batch_result');
    const hits = readHits();
    const batchHits = hits.hits.filter((h) => h.url.includes('/api/echo?id='));
    if (batchHits.length < 2) throw new Error('服务端仅收到 ' + batchHits.length + ' 次批量调用');
    const ids = batchHits.map((h) => h.url.match(/id=(\d+)/)?.[1]).sort();
    return `批量 2 次执行完成，参数行 id=${ids.join(',')}`;
  });

  // ---------- T7 定时任务（30 秒间隔） ----------
  await step(win, 'T7_定时任务创建', async (win, shot) => {
    await win.getByRole('button', { name: '定时', exact: true }).click();
    await win.waitForTimeout(500);
    await win.getByRole('button', { name: '新建定时任务' }).click();
    await win.waitForTimeout(500);
    await win.getByRole('textbox', { name: '如：健康检查 / 每小时同步' }).fill('gui-健康检查');
    // 接口下拉：扫描 option 文本找到 /api/counter
    const sel = win.getByRole('combobox').first();
    const options = await sel.locator('option').allTextContents();
    const target = options.find((o) => o.includes('/api/counter'));
    if (!target) throw new Error('接口下拉中未找到 /api/counter，options=' + options.join('|'));
    await sel.selectOption({ label: target });
    await win.getByRole('button', { name: '30 秒' }).click();
    await shot();
    const addBtn = win.getByRole('button', { name: '添加任务' });
    if (await addBtn.isDisabled()) throw new Error('表单填写后「添加任务」仍为禁用');
    await addBtn.click();
    await win.waitForTimeout(1000);
    await shot();
    if (!(await bodyHas('gui-健康检查'))) throw new Error('任务列表未出现新建任务');
    return `定时任务已创建（30 秒间隔，绑定 ${target.trim()}）`;
  });

  await step(win, 'T7b_定时任务实际触发', async (win, shot) => {
    await win.waitForTimeout(42000); // 覆盖 ≥1 个 30s 周期
    await shot();
    await dumpAria('schedule_history');
    const hits = readHits();
    const counterHits = hits.hits.filter((h) => h.url.startsWith('/api/counter'));
    if (counterHits.length < 1) throw new Error('服务端未收到定时任务请求（/api/counter 命中 0 次）');
    const pauseBtn = win.getByRole('button', { name: '点击停用' }).first();
    if (!(await pauseBtn.count())) throw new Error('任务行未找到「点击停用」按钮');
    await pauseBtn.click();
    await win.waitForTimeout(600);
    const reEnabled = win.getByRole('button', { name: /点击启用/ }).first();
    if (!(await reEnabled.count())) throw new Error('点击停用后任务未变为停用状态');
    await shot();
    return `服务端 /api/counter 被定时调用 ${counterHits.length} 次`;
  });

  // ---------- T8 代理捕获 ----------
  await step(win, 'T8_代理自动捕获请求', async (win, shot) => {
    await win.getByRole('button', { name: '接口', exact: true }).click();
    await win.waitForTimeout(400);
    // 先按应用界面提示的 127.0.0.1:8899 走代理（预期暴露 IPv4 绑定缺陷）
    let ipv4Err = '';
    try {
      execSync(`curl -s -x http://127.0.0.1:8899 "${BASE}/api/hello?from=proxy"`, { timeout: 8000 });
    } catch (e) { ipv4Err = 'Connection refused（IPv4）'; }
    // 实测代理仅监听 [::1]，用 IPv6 走代理验证捕获链路
    const proxyResp = execSync(`curl -s -x "http://[::1]:8899" "${BASE}/api/hello?from=proxy"`, { timeout: 8000 }).toString();
    if (!proxyResp.includes('TKN-9527')) throw new Error('代理响应异常: ' + proxyResp.slice(0, 100));
    await win.waitForTimeout(1500);
    await shot();
    await dumpAria('after_proxy');
    // 侧栏展示路径不含查询串：以「抓取」来源徽标与记录数增长为捕获证据
    const uiUpdated = (await bodyHas('抓取'));
    const hits = readHits();
    const viaProxy = hits.hits.filter((h) => h.url.includes('from=proxy'));
    if (!viaProxy.length) throw new Error('目标服务未收到经代理转发的请求');
    if (!uiUpdated) throw new Error('应用侧未出现「抓取」来源的记录');
    if (ipv4Err) return `捕获链路正常，但按界面提示的 127.0.0.1 访问代理失败（${ipv4Err}），[::1] 可用 —— 已记录缺陷`;
    return '代理转发与捕获正常';
  });

  // ---------- T9 错误处理 ----------
  await step(win, 'T9_错误处理_连接失败', async (win, shot) => {
    await win.getByText('/api/hello', { exact: false }).first().click();
    await win.waitForTimeout(500);
    await win.getByRole('textbox', { name: 'https://api.example.com/users' }).fill('http://127.0.0.1:1/closed');
    await win.getByRole('button', { name: /发送/ }).first().click();
    await win.waitForTimeout(2500);
    await shot();
    const txt = await win.locator('body').innerText();
    if (!/ECONNREFUSED|错误|失败|Error/i.test(txt)) throw new Error('连接失败未在 UI 呈现任何错误信息');
    return '连接失败在 UI 有错误反馈，应用未崩溃';
  });

  await step(win, 'T9b_错误处理_HTTP500', async (win, shot) => {
    await win.getByRole('textbox', { name: 'https://api.example.com/users' }).fill(`${BASE}/api/error`);
    await win.getByRole('button', { name: /发送/ }).first().click();
    await win.waitForTimeout(2000);
    await shot();
    const txt = await win.locator('body').innerText();
    if (!/500|boom|错误|失败/i.test(txt)) throw new Error('500 响应未在 UI 呈现');
    return 'HTTP 500 状态与错误体正常展示';
  });

  // ---------- T10 设置面板 ----------
  await step(win, 'T10_设置面板', async (win, shot) => {
    await win.getByRole('button', { name: '设置' }).click();
    await win.waitForTimeout(600);
    await shot();
    const txt = await win.locator('body').innerText();
    const need = ['按域名自动分组', '按完整 URL 去重', '严格校验 TLS 证书', '环境变量', '文件保存位置'];
    const missing = need.filter((k) => !txt.includes(k));
    if (missing.length) throw new Error('设置面板缺少项: ' + missing.join(','));
    // 关闭：点击弹窗内带 X 图标的按钮（Escape 不生效）
    const xBtn = win.locator('div.fixed.inset-0').locator('button').filter({ has: win.locator('svg.lucide-x') }).first();
    if (!(await xBtn.count())) throw new Error('设置弹窗未找到关闭按钮');
    await xBtn.click();
    await win.waitForTimeout(500);
    if (await win.getByText('抓取设置').count()) throw new Error('点击 X 后设置弹窗未关闭');
    return '设置面板关键项齐全（含 TLS 严格校验开关）';
  });

  // ---------- T11 主题切换 ----------
  await step(win, 'T11_主题切换', async (win, shot) => {
    await win.getByRole('button', { name: '切换到浅色主题' }).click();
    await win.waitForTimeout(600);
    await win.screenshot({ path: path.join(ART, 't_T11_light.png') });
    await win.getByRole('button', { name: '切换到深色主题' }).click();
    await win.waitForTimeout(600);
    await shot();
    return '明暗主题切换正常（浅色见 t_T11_light.png）';
  });

  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify({ results, consoleErrors }, null, 2));
  console.log('\n==== SUMMARY ====');
  for (const r of results) console.log(`${r.status}  ${r.name}  ${r.detail.slice(0, 120)}`);
  console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');

  await app.close();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e);
  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify({ results, consoleErrors, fatal: String(e) }, null, 2));
  process.exit(1);
});
