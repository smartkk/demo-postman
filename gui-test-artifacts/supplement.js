// 补充测试：点击定时任务行，验证详情/执行历史是否渲染
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
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  await win.getByRole('button', { name: '定时', exact: true }).click();
  await win.waitForTimeout(600);
  await win.getByText('gui-健康检查').first().click();
  await win.waitForTimeout(1000);
  await win.screenshot({ path: path.join(ART, 't_T7c_点击任务行.png') });
  fs.writeFileSync(path.join(ART, 'aria_schedule_detail.yaml'), await win.locator('body').ariaSnapshot());
  const txt = await win.locator('body').innerText();
  console.log('主区域包含执行历史/详情关键字:',
    /执行历史|最近执行|间隔|执行类型|单接口/.test(txt) ? 'YES' : 'NO');
  console.log('console errors:', errors.length ? errors : 'none');
  await app.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
