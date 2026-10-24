// 面板探查：遍历各功能面板并输出 aria 快照 + 截图
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

  async function dump(name) {
    await win.waitForTimeout(600);
    await win.screenshot({ path: path.join(ART, `recon_${name}.png`) });
    const snap = await win.locator('body').ariaSnapshot();
    fs.writeFileSync(path.join(ART, `recon_${name}.yaml`), snap);
    console.log('dumped', name);
  }

  await dump('0_main');

  // 手动录入
  await win.getByRole('button', { name: '手动录入' }).click();
  await dump('1_manual_entry');
  // 关闭（尝试 Esc 或 关闭 按钮）
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  // 若 Escape 无效，找 关闭/取消 按钮
  const closeBtn = win.getByRole('button', { name: /关闭|取消|×/ }).first();
  if (await closeBtn.count()) { try { await closeBtn.click({ timeout: 1500 }); } catch {} }
  await dump('1b_after_close_manual');

  // 定时面板
  await win.getByRole('button', { name: '定时', exact: true }).click();
  await dump('2_schedule');

  // 链式面板
  await win.getByRole('button', { name: '链式', exact: true }).click();
  await dump('3_chain');

  // 批量面板
  await win.getByRole('button', { name: '批量', exact: true }).click();
  await dump('4_batch');

  // 设置
  await win.getByRole('button', { name: '设置' }).click();
  await dump('5_settings');

  console.log('console errors:', errors.length ? errors : 'none');
  await app.close();
})().catch((e) => { console.error('RECON FAILED:', e); process.exit(1); });
