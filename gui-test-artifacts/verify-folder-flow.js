// 参数文件夹全链路验证：
// A. AI 预处理 → 写入参数文件夹并绑定 → 执行（实时读文件夹依次发送）
// B. 绑定外部文件夹 → 执行（3 文件顺序）
// C. 保存任务 → 运行已保存（batch:run 执行时读文件夹）
// D. 文件夹内容变化后执行（实时性：加文件后再跑）
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ART = __dirname;
const REPO = 'D:\\file\\github\\demo-postman';
const BASE = 'http://127.0.0.1:8765';
const PARAM_DIR = path.join(ART, 'param-folder');
const DATA_DIR = path.join(ART, 'electron-data');

(async () => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${DATA_DIR}`],
    cwd: REPO,
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  const shot = async (n) => { await win.waitForTimeout(400); await win.screenshot({ path: path.join(ART, n) }); console.log('shot:', n); };
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const readHits = () => JSON.parse(fs.readFileSync(path.join(ART, 'hits.json'), 'utf8'));
  const hitsFrom = (n) => readHits().hits.slice(n);

  // ---------- A. AI → 写入文件夹并绑定 → 执行 ----------
  await win.getByRole('button', { name: '设置' }).click();
  await win.waitForTimeout(500);
  await win.getByRole('textbox', { name: /接口地址/ }).fill(`${BASE}/v1`);
  await win.getByRole('textbox', { name: /模型名/ }).fill('mock-model');
  await win.locator('div.fixed.inset-0').locator('button').filter({ has: win.locator('svg.lucide-x') }).first().click();
  await win.waitForTimeout(400);

  await win.getByRole('button', { name: '批量', exact: true }).click();
  await win.waitForTimeout(400);
  await win.getByRole('button', { name: 'AI 预处理' }).click();
  await win.waitForTimeout(300);
  await win.locator('div.fixed.inset-0 textarea').first().fill('user 1001 login\nuser 1002 pay');
  await win.getByRole('button', { name: '生成参数' }).click();
  await win.waitForTimeout(1500);
  await win.getByRole('button', { name: '写入参数文件夹并绑定' }).click();
  await win.waitForTimeout(1000);
  await shot('ff_a1_bound.png');
  const bodyA = await win.locator('body').ariaSnapshot();
  ok(bodyA.includes('已绑定参数文件夹'), '应显示文件夹绑定面板');
  ok(bodyA.includes('batch-params'), '应显示 batch-params 路径');
  ok(bodyA.includes('2 个文件'), '应显示 2 个文件');
  // 磁盘核对：数据目录下新生成参数文件夹，含 001/002.json
  const ppRoot = path.join(DATA_DIR, 'batch-params');
  const ppDirs = fs.readdirSync(ppRoot).filter((d) => d.startsWith('pp-'));
  ok(ppDirs.length >= 1, '数据目录应生成 batch-params/pp-* 文件夹');
  const ppDir = path.join(ppRoot, ppDirs[ppDirs.length - 1]);
  const ppFiles = fs.readdirSync(ppDir).sort();
  ok(ppFiles.join(',').includes('001.json') && ppFiles.join(',').includes('002.json'), '应有 001/002.json，实际: ' + ppFiles);
  const row1 = JSON.parse(fs.readFileSync(path.join(ppDir, '001.json'), 'utf8'));
  ok(row1.id === 'A1' && row1.name === 'Alice', '001.json 内容应为 AI 第一行参数');

  await win.getByRole('textbox', { name: 'https://api.example.com/users/{{id}}' }).fill(
    `${BASE}/api/echo?id={{id}}&f={{fileName}}`
  );
  let idx = readHits().hits.length;
  await win.getByRole('button', { name: /运行（文件夹 2 文件）/ }).click();
  await win.waitForTimeout(2500);
  await shot('ff_a2_run.png');
  const hitsA = hitsFrom(idx).filter((h) => h.url.includes('/api/echo?'));
  ok(hitsA.length === 2, `应执行 2 次（实际 ${hitsA.length}）`);
  ok(hitsA.some((h) => h.url.includes('id=A1') && h.url.includes('f=001.json')), '第一次应为 001.json 的 A1');
  ok(hitsA.some((h) => h.url.includes('id=B2') && h.url.includes('f=002.json')), '第二次应为 002.json 的 B2');
  console.log('A AI→文件夹→执行: PASS');

  // ---------- D. 实时性：向绑定的文件夹追加文件后执行（不重新保存） ----------
  fs.writeFileSync(path.join(ppDir, '003.json'), JSON.stringify({ id: 'C3', name: 'Carol' }), 'utf8');
  idx = readHits().hits.length;
  await win.getByRole('button', { name: /运行（文件夹/ }).click();
  await win.waitForTimeout(2500);
  const hitsD = hitsFrom(idx).filter((h) => h.url.includes('/api/echo?'));
  ok(hitsD.length === 3, `追加文件后应执行 3 次（实际 ${hitsD.length}）`);
  ok(hitsD.some((h) => h.url.includes('id=C3')), '新文件 003.json 应被执行');
  console.log('D 文件夹实时读取: PASS（追加 003.json 后自动生效）');

  // ---------- C. 保存任务 → 运行已保存（主进程 batch:run 读文件夹） ----------
  await win.getByRole('button', { name: '保存' }).click();
  await win.waitForTimeout(800);
  idx = readHits().hits.length;
  await win.getByRole('button', { name: '运行已保存' }).click();
  await win.waitForTimeout(3000);
  const hitsC = hitsFrom(idx).filter((h) => h.url.includes('/api/echo?'));
  ok(hitsC.length === 3, `运行已保存应执行 3 次（实际 ${hitsC.length}）`);
  console.log('C 保存任务→运行已保存: PASS');

  // ---------- B. 绑定外部文件夹 → 执行 ----------
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, PARAM_DIR);
  await win.getByRole('button', { name: '绑定文件夹' }).click();
  await win.waitForTimeout(1000);
  await shot('ff_b1_bound.png');
  const bodyB = await win.locator('body').ariaSnapshot();
  ok(bodyB.includes('param-folder') || bodyB.includes('a-user.json') || bodyB.includes('3 个文件'), '应绑定外部文件夹并显示 3 个文件');
  idx = readHits().hits.length;
  await win.getByRole('button', { name: /运行（文件夹 3 文件）/ }).click();
  await win.waitForTimeout(2500);
  await shot('ff_b2_run.png');
  const hitsB = hitsFrom(idx).filter((h) => h.url.includes('/api/echo?'));
  hitsB.forEach((h) => console.log('  B-hit:', h.url));
  const order = hitsB.map((h) => decodeURIComponent(h.url.match(/id=([^&]*)/)?.[1] || '') || (h.url.match(/fileName=([^&]*)/)?.[1] || ''));
  ok(hitsB.length === 3, `外部文件夹应执行 3 次（实际 ${hitsB.length}，顺序 ${order.join(' → ')}）`);
  ok(order[0] === 'F1' && order[1] === 'F2' && order[2] === '', '应按文件名顺序 F1 → F2 → c-note');
  console.log('B 绑定外部文件夹→执行: PASS（顺序 F1 → F2 → c-note.txt）');

  console.log('console errors:', errors.length ? errors : 'none');
  await app.close();
  process.exit(0);
})().catch((e) => {
  console.error('VERIFY FAILED:', e.message || e);
  process.exit(1);
});
