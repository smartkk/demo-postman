// 新功能验证：AI 预处理入口 + 文件夹参数导入（批量调用端到端）
// AI 走本地 mock OpenAI 兼容端点（test-server.js:8765/v1/chat/completions）
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ART = __dirname;
const REPO = 'D:\\file\\github\\demo-postman';
const BASE = 'http://127.0.0.1:8765';
const PARAM_DIR = path.join(ART, 'param-folder');

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

  const shot = async (name) => {
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(ART, name) });
    console.log('shot:', name);
  };
  const bodyHas = async (t) => (await win.getByText(t, { exact: false }).count()) > 0;
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const readHits = () => JSON.parse(fs.readFileSync(path.join(ART, 'hits.json'), 'utf8'));

  // ---------- 1. 设置中配置 AI（mock 端点） ----------
  await win.getByRole('button', { name: '设置' }).click();
  await win.waitForTimeout(500);
  await win.getByRole('textbox', { name: /接口地址/ }).fill(`${BASE}/v1`);
  await win.getByRole('textbox', { name: /模型名/ }).fill('mock-model');
  await shot('ai_t1_settings.png');
  const xBtn = win.locator('div.fixed.inset-0').locator('button').filter({ has: win.locator('svg.lucide-x') }).first();
  await xBtn.click();
  await win.waitForTimeout(400);

  // ---------- 2. AI 预处理弹窗：生成 → 填充 ----------
  await win.getByRole('button', { name: '批量', exact: true }).click();
  await win.waitForTimeout(400);
  await win.getByRole('button', { name: 'AI 预处理' }).click();
  await win.waitForTimeout(400);
  await shot('ai_t2_dialog.png');
  await win.locator('div.fixed.inset-0 textarea').first().fill(
    'user 1001 login\nuser 1002 pay'
  );
  await win.getByRole('button', { name: '生成参数' }).click();
  await win.waitForTimeout(1500);
  await shot('ai_t3_result.png');
  const resultBox = win.locator('div.fixed.inset-0 textarea').nth(1);
  const resultText = await resultBox.inputValue();
  ok(resultText.includes('A1') && resultText.includes('Bob'), 'AI 结果应包含 mock 返回的参数');
  ok(await bodyHas('mock-model'), '应显示模型名 meta');
  await win.getByRole('button', { name: '填充到参数行' }).click();
  await win.waitForTimeout(600);
  const snapFilled = await win.locator('body').ariaSnapshot();
  ok(snapFilled.includes('Alice'), '填充后参数表应出现 Alice');
  ok(snapFilled.includes('B2'), '填充后参数表应出现 B2');
  // 模板改为回显接口，验证变量注入
  await win.getByRole('textbox', { name: 'https://api.example.com/users/{{id}}' }).fill(
    `${BASE}/api/echo?id={{id}}&name={{name}}`
  );
  const idxBefore = readHits().hits.length;
  await win.getByRole('button', { name: /运行（2 次）/ }).click();
  await win.waitForTimeout(2000);
  await shot('ai_t4_batch_run.png');
  const hits1 = readHits();
  const aiCalls = hits1.hits.slice(idxBefore).filter((h) => h.url.includes('id=A1') || h.url.includes('id=B2'));
  ok(aiCalls.length === 2, `AI 参数应触发 2 次调用（实际 ${aiCalls.length}）`);
  console.log('AI 预处理 → 批量执行: PASS（id=A1/B2 各 1 次）');

  // ---------- 3. 文件夹参数导入 ----------
  // 原生文件夹选择对话框无法自动化：测试中注入返回固定目录（仅测试用）
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, PARAM_DIR);
  const hitsBefore = readHits().counter;
  await win.getByRole('button', { name: '选择文件夹' }).click();
  await win.waitForTimeout(1000);
  await shot('ai_t5_folder_rows.png');
  const snapFolder = await win.locator('body').ariaSnapshot();
  ok(snapFolder.includes('a-user.json'), '参数表应出现文件名变量值 a-user.json');
  ok(snapFolder.includes('plain text payload 003'), '文本文件内容应进 fileContent');
  await win.getByRole('textbox', { name: 'https://api.example.com/users/{{id}}' }).fill(
    `${BASE}/api/echo?id={{id}}&fileName={{fileName}}`
  );
  await win.getByRole('button', { name: /运行（3 次）/ }).click();
  await win.waitForTimeout(2500);
  await shot('ai_t6_folder_run.png');
  const hits2 = readHits();
  const newHits = hits2.hits.slice(hitsBefore);
  const f1 = newHits.find((h) => h.url.includes('id=F1'));
  const f2 = newHits.find((h) => h.url.includes('id=F2'));
  const f3 = newHits.find((h) => h.url.includes('fileName=c-note.txt'));
  ok(f1, 'a-user.json 应以 id=F1 执行');
  ok(f2, 'b-order.json 应以 id=F2 执行');
  ok(f3, 'c-note.txt 应以 fileName=c-note.txt 执行（id 为空）');
  ok(newHits.length === 3, `文件夹 3 个文件应依次执行 3 次（实际 ${newHits.length}）`);
  console.log('文件夹参数导入 → 依次执行: PASS（F1/F2/c-note.txt 顺序触发）');

  console.log('console errors:', errors.length ? errors : 'none');
  await app.close();
  process.exit(0);
})().catch((e) => {
  console.error('VERIFY FAILED:', e.message || e);
  process.exit(1);
});
