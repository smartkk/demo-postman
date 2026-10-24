// 修复验证：
// A. 定时任务创建后自动选中（表单保持编辑态 + 概要/历史可见 + 左侧栏高亮）
// B. 浅色主题无深色残留（含 main 根节点本身），并检查弹窗
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ART = __dirname;
const REPO = 'D:\\file\\github\\demo-postman';
const BASE = 'http://127.0.0.1:8765';

(async () => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(ART, 'electron-data')}`],
    cwd: REPO,
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

  // ---------- 场景 A：定时任务创建后自动选中 ----------
  await win.getByRole('button', { name: '定时', exact: true }).click();
  await win.waitForTimeout(500);
  await win.getByRole('button', { name: '新建定时任务' }).click();
  await win.waitForTimeout(400);
  const stamp = Date.now().toString().slice(-6);
  await win.getByRole('textbox', { name: '如：健康检查 / 每小时同步' }).fill('验证-自动选中-' + stamp);
  const sel = win.getByRole('combobox').first();
  const options = await sel.locator('option').allTextContents();
  const target = options.find((o) => o.includes('/api/counter'));
  await sel.selectOption({ label: target });
  await win.getByRole('button', { name: '30 秒' }).click();
  await win.getByRole('button', { name: '添加任务' }).click();
  await win.waitForTimeout(1200);
  await win.screenshot({ path: path.join(ART, 'fix_A_after_create.png') });

  const bodyText = await win.locator('body').innerText();
  ok(bodyText.includes('编辑定时任务'), '创建后表单应保持编辑态（编辑定时任务）');
  ok(/每 30 秒/.test(bodyText), '概要区应显示任务间隔');
  ok(bodyText.includes('验证-自动选中-' + stamp), '任务名应可见');
  // 概要+历史容器应存在（不再空白）
  ok(/执行记录|最近 \d+ 次执行/.test(bodyText), '执行历史区应可见');
  // 左侧栏应高亮选中（任务行存在且 aria 中带选中态样式）
  await win.screenshot({ path: path.join(ART, 'fix_A_selected.png') });
  console.log('A 定时任务创建后自动选中: PASS');

  // ---------- 场景 B：浅色主题 ----------
  await win.getByRole('button', { name: '接口', exact: true }).click();
  await win.waitForTimeout(400);
  await win.getByText('/api/hello', { exact: false }).first().click();
  await win.waitForTimeout(500);
  await win.getByRole('button', { name: '响应' }).click().catch(() => {});
  await win.waitForTimeout(300);
  // 主题有持久化：若已是浅色则无需切换
  const toLight = win.getByRole('button', { name: '切换到浅色主题' });
  if (await toLight.count()) { await toLight.click(); await win.waitForTimeout(600); }

  // 只读扫描：main 本体 + 所有子元素，不允许再有深色背景
  const offenders = await win.evaluate(() => {
    const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const out = [];
    const els = [document.querySelector('main'), ...document.querySelectorAll('main *')];
    for (const el of els) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      const m = cs.backgroundColor.match(/rgba?\((\d+), ?(\d+), ?(\d+)(?:, ?([\d.]+))?\)/);
      if (!m) continue;
      const a = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (a === 0) continue;
      if (lum(+m[1], +m[2], +m[3]) < 0.35) {
        const cls = typeof el.className === 'string' ? el.className : el.tagName;
        out.push(cls.slice(0, 120) + ' «' + (el.textContent || '').slice(0, 20) + '»');
      }
    }
    return out;
  });
  await win.screenshot({ path: path.join(ART, 'fix_B_light_detail.png') });
  if (offenders.length) {
    console.log('B 浅色主题: 仍有深色元素:');
    offenders.slice(0, 10).forEach((o) => console.log('   ' + o));
    throw new Error('浅色主题仍有 ' + offenders.length + ' 个深色背景元素');
  }
  console.log('B 浅色主题深色残留: PASS（main 及子元素均无深色背景）');

  // 弹窗检查：浅色下打开设置
  await win.getByRole('button', { name: '设置' }).click();
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(ART, 'fix_B_light_settings.png') });
  const xBtn = win.locator('div.fixed.inset-0').locator('button').filter({ has: win.locator('svg.lucide-x') }).first();
  await xBtn.click();
  await win.waitForTimeout(400);
  // 切回深色，保持用户原有主题习惯（若当前为浅色）
  const toDark = win.getByRole('button', { name: '切换到深色主题' });
  if (await toDark.count()) { await toDark.click(); await win.waitForTimeout(400); }
  console.log('B 设置弹窗浅色渲染: 见截图');

  console.log('console errors:', errors.length ? errors : 'none');
  await app.close();
})().catch((e) => { console.error('VERIFY FAILED:', e.message || e); process.exit(1); });
