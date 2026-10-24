// 主题探针：浅色主题下找出主区域所有仍为深色背景的元素及其类名（只读检查）
const { _electron: electron } = require('playwright-core');
const path = require('path');

const ART = __dirname;
const REPO = 'D:\\file\\github\\demo-postman';

(async () => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(ART, 'electron-data')}`],
    cwd: REPO,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 选中一个有响应历史的接口并切到响应页
  await win.getByText('/api/hello', { exact: false }).first().click();
  await win.waitForTimeout(500);
  await win.getByRole('button', { name: '响应' }).click().catch(() => {});
  await win.waitForTimeout(300);

  // 切换到浅色主题
  await win.getByRole('button', { name: '切换到浅色主题' }).click();
  await win.waitForTimeout(600);

  // 只读遍历：找出计算样式仍为深色的元素
  const offenders = await win.evaluate(() => {
    const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const out = new Map();
    for (const el of document.querySelectorAll('main *')) {
      const cs = getComputedStyle(el);
      const m = cs.backgroundColor.match(/rgba?\((\d+), ?(\d+), ?(\d+)(?:, ?([\d.]+))?\)/);
      if (!m) continue;
      const a = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (a === 0) continue;
      const L = lum(+m[1], +m[2], +m[3]);
      if (L < 0.35) {
        const key = el.className && typeof el.className === 'string' ? el.className : el.tagName;
        const short = key.split(/\s+/).filter((c) => /bg-|border-|from-|via-|to-/.test(c)).join(' ');
        const k = short || el.tagName;
        if (!out.has(k)) out.set(k, { count: 0, sample: (el.textContent || '').slice(0, 30) });
        out.get(k).count++;
      }
    }
    return [...out.entries()].map(([cls, v]) => ({ cls, count: v.count, sample: v.sample }));
  });
  console.log('浅色主题下仍是深色背景的元素（按类聚合）:');
  offenders.forEach((o) => console.log(` x${o.count}  ${o.cls}   «${o.sample}»`));

  await win.screenshot({ path: path.join(ART, 'probe_light_main.png') });
  await app.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
