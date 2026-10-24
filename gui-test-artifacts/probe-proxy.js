// 代理探针：启动应用后实测 8899 端口监听状态与代理转发能力
const { _electron: electron } = require('playwright-core');
const path = require('path');
const { execSync } = require('child_process');

const ART = __dirname;
const REPO = 'D:\\file\\github\\demo-postman';

(async () => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(ART, 'electron-data')}`],
    cwd: REPO,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(3000);

  console.log('=== badge ===');
  console.log(await win.getByRole('button', { name: /代理/ }).first().innerText().catch(() => 'n/a'));

  console.log('=== netstat 8899 ===');
  try { console.log(execSync('netstat -ano | findstr :8899', { timeout: 8000 }).toString()); }
  catch (e) { console.log('netstat: 无匹配（端口未监听）'); }

  console.log('=== netstat 8891 (插件端点) ===');
  try { console.log(execSync('netstat -ano | findstr :8891', { timeout: 8000 }).toString()); }
  catch (e) { console.log('netstat: 无匹配'); }

  console.log('=== curl 直连目标（不走代理，对照） ===');
  try { console.log(execSync('curl -s http://127.0.0.1:8765/api/hello', { timeout: 8000 }).toString()); }
  catch (e) { console.log('直连失败: ' + e.message.slice(0, 100)); }

  console.log('=== curl 经代理（-v 详细） ===');
  try {
    console.log(execSync('curl -sv -x http://127.0.0.1:8899 "http://127.0.0.1:8765/api/hello?from=probe" 2>&1', { timeout: 10000 }).toString());
  } catch (e) {
    console.log('经代理失败: ' + (e.stdout || '') + (e.stderr || '') + ' code=' + e.status);
  }

  console.log('=== curl 经代理 (IPv6 localhost) ===');
  try {
    console.log(execSync('curl -s -x http://[::1]:8899 "http://127.0.0.1:8765/api/hello?from=probe6" 2>&1', { timeout: 10000 }).toString());
  } catch (e) {
    console.log('IPv6 经代理失败: ' + (e.stdout || '').slice(0, 200) + ' code=' + e.status);
  }

  await app.close();
})().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
