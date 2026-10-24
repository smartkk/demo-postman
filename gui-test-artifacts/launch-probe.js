// 启动探查：确认应用能启动、userData 隔离生效、窗口渲染，并输出 aria 快照供后续脚本参考
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ART = __dirname;
const REPO = 'D:\\file\\github\\demo-postman';

(async () => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(ART, 'electron-data')}`],
    cwd: REPO,
  });
  const ud = await app.evaluate(({ app }) => app.getPath('userData'));
  console.log('userData =', ud);

  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);

  console.log('title =', await win.title());
  console.log('url =', win.url());
  const size = win.viewportSize();
  console.log('viewport =', JSON.stringify(size));

  await win.screenshot({ path: path.join(ART, 't0_launch.png'), fullPage: false });
  const snap = await win.locator('body').ariaSnapshot();
  fs.writeFileSync(path.join(ART, 't0_aria.yaml'), snap);

  console.log('console errors so far:', errors.length ? errors : 'none');

  await app.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
