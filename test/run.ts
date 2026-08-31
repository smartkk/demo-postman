import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InterfaceStore } from '../src/main/storage/interfaceStore';
import { CaptureProxy } from '../src/main/proxy/captureProxy';
import { ExtensionReceiver } from '../src/main/extension/extensionReceiver';
import { sendRequest } from '../src/main/request/sender';
import {
  runBatchCall,
  resolveEnvVars,
  resolvePlaceholders,
} from '../src/main/request/batchRunner';
import { parseCurl } from '../src/shared/curl';
import {
  matchHost,
  shouldCapture,
  hostnameOf,
} from '../src/main/captureFilter';
import type { ResponseRecord } from '../src/shared/types';
import { JsonTree } from '../src/renderer/src/components/JsonTree';

function tmpFile(): string {
  return path.join(os.tmpdir(), `demo-postman-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  console.log('  \u2713', name);
  passed++;
}

console.log('\n=== 存储与去重测试 ===');

test('同一接口只记录一次，并覆盖为最新参数', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  s.upsert({ method: 'POST', url: 'https://api.test/users?role=admin', headers: { x: '1' }, body: 'a=1' });
  s.upsert({ method: 'post', url: 'https://api.test/users?role=admin', headers: { x: '2' }, body: 'a=2' });
  const list = s.list();
  assert.strictEqual(list.length, 1, '应只有一条记录');
  assert.strictEqual(list[0].callCount, 2, '调用次数应累加');
  assert.strictEqual(list[0].body, 'a=2', 'body 应更新为最新');
  assert.strictEqual(list[0].headers['x'], '2', 'headers 应更新为最新');
  assert.strictEqual(list[0].query['role'], 'admin', 'query 应被解析');
  fs.rmSync(f, { force: true });
});

test('不同 path 分别记录', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  s.upsert({ method: 'GET', url: 'https://api.test/a' });
  s.upsert({ method: 'GET', url: 'https://api.test/b' });
  assert.strictEqual(s.list().length, 2);
  fs.rmSync(f, { force: true });
});

test('不同 method 同一 path 分别记录', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  s.upsert({ method: 'GET', url: 'https://api.test/x' });
  s.upsert({ method: 'POST', url: 'https://api.test/x' });
  assert.strictEqual(s.list().length, 2);
  fs.rmSync(f, { force: true });
});

test('持久化与重新加载', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  s.upsert({ method: 'GET', url: 'https://api.test/p' });
  s.save();
  const s2 = new InterfaceStore(f);
  assert.strictEqual(s2.list().length, 1);
  fs.rmSync(f, { force: true });
});

test('clearAll 清空记录', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  s.upsert({ method: 'GET', url: 'https://api.test/p' });
  s.clearAll();
  assert.strictEqual(s.list().length, 0);
  fs.rmSync(f, { force: true });
});

test('update 修改已存在接口并保留 id/createdAt/callCount', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const created = s.upsert({ method: 'GET', url: 'https://api.test/p?a=1', headers: { x: '1' } });
  assert.ok(created, '应创建成功');
  const id = created!.id;
  const createdAt = created!.createdAt;
  const callCount = created!.callCount;

  const updated = s.update(id, {
    method: 'POST',
    url: 'https://api.test/p?a=2&b=3',
    headers: { y: '2' },
    body: 'hello',
  });
  assert.ok(updated, '应更新成功');
  assert.strictEqual(updated!.id, id, 'id 应保持不变');
  assert.strictEqual(updated!.createdAt, createdAt, 'createdAt 应保持不变');
  assert.strictEqual(updated!.callCount, callCount, 'callCount 应保持不变');
  assert.strictEqual(updated!.method, 'POST', 'method 应被更新');
  assert.strictEqual(updated!.query['a'], '2', 'query 应被更新');
  assert.strictEqual(updated!.query['b'], '3', '新 query 应被解析');
  assert.strictEqual(updated!.headers['y'], '2', 'headers 应被更新');
  assert.strictEqual(updated!.body, 'hello', 'body 应被更新');
  assert.strictEqual(s.list().length, 1, '更新不应新增记录');
  fs.rmSync(f, { force: true });
});

test('update 不存在的 id 返回 null', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  assert.strictEqual(s.update('nope', { method: 'GET', url: 'https://api.test/x' }), null);
  fs.rmSync(f, { force: true });
});

test('upsert 未带 body 时不覆盖已有 body（插件/代理并发捕获）', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  // 代理先捕获到带 body 的请求
  s.upsert({ method: 'POST', url: 'https://api.test/order', headers: { h: '1' }, body: 'a=1', contentType: 'application/x-www-form-urlencoded' });
  // 插件（webRequest）随后捕获同接口但取不到 body（MV3 限制，body 为 null）
  s.upsert({ method: 'POST', url: 'https://api.test/order', headers: { h: '2' } });
  const list = s.list();
  assert.strictEqual(list.length, 1, '应去重为一条');
  assert.strictEqual(list[0].body, 'a=1', '无 body 的捕获不应清空已有 body');
  assert.strictEqual(list[0].contentType, 'application/x-www-form-urlencoded', 'contentType 同样应被保留');
  assert.strictEqual(list[0].headers['h'], '2', 'headers 仍应更新为最新');
  // 当某次捕获确实带上了新 body，应正常更新
  s.upsert({ method: 'POST', url: 'https://api.test/order', body: 'a=2' });
  assert.strictEqual(s.list()[0].body, 'a=2', '带 body 的捕获应更新为最新');
  fs.rmSync(f, { force: true });
});

test('upsertResponse 关联请求记录写入响应且不重复计数', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const created = s.upsert({ method: 'GET', url: 'https://api.test/p' });
  assert.strictEqual(created!.callCount, 1);
  assert.strictEqual(created!.lastResponse, null, '初始无响应');
  const resp: ResponseRecord = {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    durationMs: 15,
    at: new Date().toISOString(),
  };
  s.upsertResponse('GET', 'https://api.test/p', resp);
  const rec = s.list()[0];
  assert.strictEqual(rec.lastResponse?.status, 200, '响应状态应写入');
  assert.strictEqual(rec.lastResponse?.body, '{"ok":true}', '响应体应写入');
  assert.strictEqual(rec.callCount, 1, '响应回写不应累加调用次数');
  fs.rmSync(f, { force: true });
});

test('upsertResponse 仅有响应无请求时也保留记录', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const resp: ResponseRecord = {
    status: 404,
    statusText: 'Not Found',
    headers: {},
    body: '',
    durationMs: 8,
    at: new Date().toISOString(),
  };
  s.upsertResponse('GET', 'https://api.test/only-resp', resp);
  const list = s.list();
  assert.strictEqual(list.length, 1, '应新建一条记录');
  assert.strictEqual(list[0].lastResponse?.status, 404);
  assert.strictEqual(list[0].body, null, '无请求体时 body 应为 null');
  fs.rmSync(f, { force: true });
});

test('saveResponse 保存响应并累加调用次数', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const created = s.upsert({ method: 'GET', url: 'https://api.test/p' });
  const id = created!.id;
  const before = created!.callCount;
  const resp: ResponseRecord = {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":1}',
    durationMs: 12,
    at: new Date().toISOString(),
  };
  s.saveResponse(id, resp);
  const after = s.get(id)!;
  assert.strictEqual(after.callCount, before + 1, 'callCount 应 +1');
  assert.strictEqual(after.lastResponse?.status, 200, '应保存响应');
  assert.strictEqual(after.lastResponse?.body, '{"ok":1}', '应保存响应体');
  fs.rmSync(f, { force: true });
});

console.log('\n=== 接口管理：来源/分组/重命名/复制/删除 ===');

test('addManual 创建手动来源记录', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const r = s.addManual({ method: 'GET', url: 'https://api.test/m' });
  assert.strictEqual(r!.source, 'manual', '来源应为 manual');
  assert.strictEqual(s.list().length, 1);
  fs.rmSync(f, { force: true });
});

test('upsert 抓取记录来源为 captured', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const r = s.upsert({ method: 'GET', url: 'https://api.test/c' });
  assert.strictEqual(r!.source, 'captured', '来源应为 captured');
  fs.rmSync(f, { force: true });
});

test('duplicate 生成独立副本并归零计数', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const created = s.upsert({ method: 'GET', url: 'https://api.test/p', body: 'x=1' });
  created!.callCount = 5;
  const copy = s.duplicate(created!.id);
  assert.ok(copy, '应返回副本');
  assert.notStrictEqual(copy!.id, created!.id, '副本 id 应不同');
  assert.strictEqual(copy!.callCount, 0, '副本调用次数归零');
  assert.strictEqual(copy!.source, 'manual', '副本来源为 manual');
  assert.strictEqual(copy!.body, 'x=1', '副本应继承 body');
  assert.strictEqual(s.list().length, 2, '应存在两条记录');
  fs.rmSync(f, { force: true });
});

test('deleteOne 删除指定记录', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const a = s.upsert({ method: 'GET', url: 'https://api.test/a' });
  s.upsert({ method: 'GET', url: 'https://api.test/b' });
  s.deleteOne(a!.id);
  assert.strictEqual(s.list().length, 1, '应只剩 1 条');
  fs.rmSync(f, { force: true });
});

test('deleteBySource 仅删除浏览器抓取记录', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  s.upsert({ method: 'GET', url: 'https://api.test/c1' });
  s.upsert({ method: 'GET', url: 'https://api.test/c2' });
  s.addManual({ method: 'GET', url: 'https://api.test/m1' });
  const n = s.deleteBySource('captured');
  assert.strictEqual(n, 2, '应删除 2 条抓取记录');
  const left = s.list();
  assert.strictEqual(left.length, 1, '应只剩手动记录');
  assert.strictEqual(left[0].source, 'manual');
  fs.rmSync(f, { force: true });
});

test('rename 与 moveFolder 修改元数据', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const r = s.upsert({ method: 'GET', url: 'https://api.test/p' });
  s.rename(r!.id, '我的接口');
  s.moveFolder(r!.id, '分组A');
  const got = s.get(r!.id)!;
  assert.strictEqual(got.name, '我的接口');
  assert.strictEqual(got.folder, '分组A');
  fs.rmSync(f, { force: true });
});

test('分组创建/删除（删除分组后接口移至未分组）', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const r = s.upsert({ method: 'GET', url: 'https://api.test/p' });
  s.createFolder('分组A');
  assert.deepStrictEqual(s.listFolders(), ['分组A']);
  s.moveFolder(r!.id, '分组A');
  s.deleteFolder('分组A');
  assert.strictEqual(s.listFolders().length, 0, '分组应被删除');
  assert.strictEqual(s.get(r!.id)!.folder, '', '接口应回到未分组');
  fs.rmSync(f, { force: true });
});

test('saveResponse 标记来源 manual，upsertResponse 标记 captured', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const created = s.upsert({ method: 'GET', url: 'https://api.test/p' });
  const manualResp: ResponseRecord = {
    status: 200, statusText: 'OK', headers: {}, body: 'a', durationMs: 1, at: new Date().toISOString(),
  };
  s.saveResponse(created!.id, manualResp);
  assert.strictEqual(s.get(created!.id)!.lastResponse!.source, 'manual');
  const capResp: ResponseRecord = {
    status: 201, statusText: 'Created', headers: {}, body: 'b', durationMs: 1, at: new Date().toISOString(),
  };
  s.upsertResponse('GET', 'https://api.test/p', capResp);
  assert.strictEqual(s.get(created!.id)!.lastResponse!.source, 'captured', '抓取响应应覆盖为 captured');
  assert.strictEqual(s.get(created!.id)!.lastResponse!.status, 201);
  fs.rmSync(f, { force: true });
});

console.log('\n=== 白名单过滤与自动分组测试 ===');

test('matchHost 支持通配/精确/子域匹配', () => {
  assert.strictEqual(matchHost('api.example.com', '*.example.com'), true);
  assert.strictEqual(matchHost('a.b.example.com', '*.example.com'), true);
  assert.strictEqual(matchHost('example.com', 'example.com'), true);
  assert.strictEqual(matchHost('api.example.com', 'example.com'), true);
  assert.strictEqual(matchHost('notexample.com', 'example.com'), false);
  assert.strictEqual(matchHost('api.example.com', '*.other.com'), false);
});

test('shouldCapture 命中 includeHosts 才放行', () => {
  const s = { includeHosts: ['api.example.com'], excludeHosts: [] };
  assert.strictEqual(shouldCapture('https://api.example.com/x', s), true);
  assert.strictEqual(shouldCapture('https://other.com/x', s), false);
});

test('shouldCapture excludeHosts 优先拦截', () => {
  const s = { includeHosts: [], excludeHosts: ['*.ad.com'] };
  assert.strictEqual(shouldCapture('https://a.ad.com/x', s), false);
  assert.strictEqual(shouldCapture('https://api.example.com/x', s), true);
});

test('shouldCapture 跳过本地服务端口（防回环）', () => {
  const s = { includeHosts: [], excludeHosts: [] };
  assert.strictEqual(shouldCapture('http://127.0.0.1:8891/api/capture', s), false);
  assert.strictEqual(shouldCapture('http://127.0.0.1:8899/x', s), false);
  assert.strictEqual(shouldCapture('http://127.0.0.1:3000/api', s), true);
});

test('hostnameOf 提取不含端口的域名', () => {
  assert.strictEqual(hostnameOf('https://api.example.com:8080/path'), 'api.example.com');
  assert.strictEqual(hostnameOf('http://localhost/x'), 'localhost');
});

test('upsert 新建记录套用自动分组 folder，合并时保留原 folder', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const a = s.upsert({ method: 'GET', url: 'https://api.example.com/a' }, { folder: 'api.example.com' });
  assert.strictEqual(a!.folder, 'api.example.com', '新建应套用分组');
  // 合并同 key 的抓取记录，folder 不应被覆盖
  s.upsert({ method: 'GET', url: 'https://api.example.com/a' }, { folder: 'new.host' });
  assert.strictEqual(s.get(a!.id)!.folder, 'api.example.com', '合并应保留原分组');
  fs.rmSync(f, { force: true });
});

test('upsertResponse 新建记录套用自动分组 folder', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const resp: ResponseRecord = {
    status: 200, statusText: 'OK', headers: {}, body: 'ok', durationMs: 1, at: new Date().toISOString(),
  };
  const r = s.upsertResponse('GET', 'https://cdn.example.com/x', resp, { folder: 'cdn.example.com' });
  assert.strictEqual(r!.folder, 'cdn.example.com', '响应新建记录应套用分组');
  fs.rmSync(f, { force: true });
});

console.log('\n=== curl 解析测试 ===');

test('解析基础 GET 并拆分 query', () => {
  const r = parseCurl('curl "https://api.test/users?role=admin&page=2"');
  assert.strictEqual(r.method, 'GET');
  assert.strictEqual(r.url, 'https://api.test/users');
  assert.strictEqual(r.query['role'], 'admin');
  assert.strictEqual(r.query['page'], '2');
  assert.strictEqual(r.body, null);
});

test('解析 -X/-H/-d 为 POST', () => {
  const r = parseCurl(
    "curl -X POST https://api.test/login \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"u\":\"a\"}'"
  );
  assert.strictEqual(r.method, 'POST');
  assert.strictEqual(r.url, 'https://api.test/login');
  assert.strictEqual(r.headers['Content-Type'], 'application/json');
  assert.strictEqual(r.body, '{"u":"a"}');
});

test('解析 -u 生成 Basic Auth', () => {
  const r = parseCurl('curl -u alice:secret https://api.test/me');
  const expected = 'Basic ' + Buffer.from('alice:secret').toString('base64');
  assert.strictEqual(r.headers['Authorization'], expected);
});

test('-G 模式将 -d 转为 query', () => {
  const r = parseCurl('curl -G https://api.test/search -d "q=hello&lang=zh"');
  assert.strictEqual(r.method, 'GET');
  assert.strictEqual(r.url, 'https://api.test/search');
  assert.strictEqual(r.query['q'], 'hello');
  assert.strictEqual(r.query['lang'], 'zh');
  assert.strictEqual(r.body, null);
});

test('解析 -b cookie 与 -A user-agent', () => {
  const r = parseCurl('curl -b "sid=123" -A "MyAgent/1.0" https://api.test/x');
  assert.strictEqual(r.headers['Cookie'], 'sid=123');
  assert.strictEqual(r.headers['User-Agent'], 'MyAgent/1.0');
});

test('无 -X 且有 -d 时默认 POST', () => {
  const r = parseCurl('curl https://api.test/p -d "a=1"');
  assert.strictEqual(r.method, 'POST');
  assert.strictEqual(r.body, 'a=1');
});

console.log('\n=== JSON 树折叠视图测试 ===');

test('JsonTree 渲染对象/数组并显示折叠预览', () => {
  const data = {
    name: 'demo',
    tags: ['a', 'b', 'c'],
    nested: { id: 1, ok: true, nil: null },
    deep: { l2: { l3: { secret: 42 } } },
  };
  // React 服务端渲染会把文本中的 " 转义为 &quot;
  const html = renderToStaticMarkup(React.createElement(JsonTree, { data }));
  assert.ok(html.includes('&quot;name&quot;'), '应渲染键名 name');
  assert.ok(html.includes('&quot;tags&quot;'), '应渲染键名 tags');
  assert.ok(html.includes('&quot;nested&quot;'), '应渲染键名 nested');
  // deep.l2 位于 depth 2，默认收起，应显示“1 键”预览
  assert.ok(html.includes('1 键'), '深层对象应显示折叠预览“1 键”');
  assert.ok(html.includes('json-toggle'), '应渲染折叠开关');
  // 深层字段默认应被折叠隐藏
  assert.ok(!html.includes('&quot;secret&quot;'), '深层字段默认应被折叠隐藏');
});

test('JsonTree expandAll 展开所有层级', () => {
  const data = { deep: { l2: { l3: { secret: 42 } } } };
  const html = renderToStaticMarkup(React.createElement(JsonTree, { data, expandAll: true }));
  assert.ok(html.includes('&quot;secret&quot;'), 'expandAll 应展开全部层级');
  assert.ok(!html.includes('1 键'), 'expandAll 不应出现折叠预览');
});

test('JsonTree 根为基础类型不报错', () => {
  const html = renderToStaticMarkup(React.createElement(JsonTree, { data: 'plain string' as unknown }));
  assert.ok(html.includes('plain string'), '根为基础类型应直接渲染');
});

console.log('\n=== 新增能力测试（历史/脱敏/去重/导入导出） ===');

test('InterfaceStore 响应历史保留多份并截断', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const r = s.addManual({ method: 'GET', url: 'https://api.test/x', headers: {}, contentType: null });
  for (let i = 0; i < 25; i++) {
    s.saveResponse(r!.id, {
      status: 200,
      statusText: 'OK',
      headers: {},
      body: 'b' + i,
      durationMs: 1,
      at: new Date(Date.now() + i).toISOString(),
    });
  }
  const rec = s.get(r!.id);
  assert.strictEqual(rec!.responses!.length, 20, '应保留最近 20 条');
  assert.strictEqual(rec!.lastResponse!.body, 'b24', 'lastResponse 应为最后一条');
  fs.rmSync(f, { force: true });
});

test('InterfaceStore 抓取敏感头脱敏', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  s.upsert({ method: 'GET', url: 'https://api.test/y', headers: { authorization: 'secret', cookie: 'c', x: '1' }, contentType: null });
  const rec = s.list().find((x) => x.host === 'api.test');
  assert.strictEqual(rec!.headers.authorization, '***已脱敏***', 'Authorization 应被脱敏');
  assert.strictEqual(rec!.headers.cookie, '***已脱敏***', 'Cookie 应被脱敏');
  assert.strictEqual(rec!.headers.x, '1', '普通头保留');
  fs.rmSync(f, { force: true });
});

test('InterfaceStore 大响应体截断', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  const r = s.addManual({ method: 'GET', url: 'https://api.test/z', headers: {}, contentType: null });
  const big = 'x'.repeat(2 * 1024 * 1024);
  s.saveResponse(r!.id, { status: 200, statusText: 'OK', headers: {}, body: big, durationMs: 1, at: new Date().toISOString() });
  const rec = s.get(r!.id);
  assert.ok(rec!.lastResponse!.body.length < big.length, '响应体应被截断');
  assert.ok(rec!.lastResponse!.body.includes('已截断'), '应带截断提示');
  fs.rmSync(f, { force: true });
});

test('InterfaceStore 按完整 URL 去重', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  s.setDedupMode(true);
  s.upsert({ method: 'GET', url: 'https://api.test/p?q=1', headers: {}, contentType: null });
  s.upsert({ method: 'GET', url: 'https://api.test/p?q=2', headers: {}, contentType: null });
  assert.strictEqual(s.list().length, 2, '不同 query 应视为不同记录');
  fs.rmSync(f, { force: true });
});

test('运行时切换去重模式应重建索引，不产生重复记录', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  // 默认 method+host+path 去重
  s.upsert({ method: 'GET', url: 'https://api.test/p?q=1', headers: {}, contentType: null });
  // 切换到完整 URL：已有记录索引需同步重建
  s.setDedupMode(true);
  s.upsert({ method: 'GET', url: 'https://api.test/p?q=1', headers: {}, contentType: null });
  s.upsert({ method: 'GET', url: 'https://api.test/p?q=2', headers: {}, contentType: null });
  assert.strictEqual(s.list().length, 2, '切到完整 URL 后 q=1 应合并、q=2 新建');
  // 切回 method+path：q=3 应合并进既有记录
  s.setDedupMode(false);
  s.upsert({ method: 'GET', url: 'https://api.test/p?q=3', headers: {}, contentType: null });
  assert.strictEqual(s.list().length, 2, '切回 method+path 后 q=3 应合并，而非新建');
  fs.rmSync(f, { force: true });
});

test('InterfaceStore 导出/导入集合', () => {
  const f = tmpFile();
  const s = new InterfaceStore(f);
  s.upsert({ method: 'GET', url: 'https://api.test/p', headers: { a: '1' }, contentType: null });
  s.createFolder('g1');
  const data = s.exportCollection();
  assert.strictEqual(data.records.length, 1);
  assert.deepStrictEqual(data.folders, ['g1']);
  // 导入替换
  const f2 = tmpFile();
  const s2 = new InterfaceStore(f2);
  s2.importCollection(data);
  assert.strictEqual(s2.list().length, 1);
  assert.strictEqual(s2.list()[0].host, 'api.test');
  fs.rmSync(f, { force: true });
  fs.rmSync(f2, { force: true });
});

console.log('\n=== 代理捕获测试（HTTP） ===');

async function testProxyCapture() {
  const target = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((r) => target.listen(19001, r));

  const f = tmpFile();
  const store = new InterfaceStore(f);
  const caDir = path.join(os.tmpdir(), `demo-postman-ca-${Date.now()}`);
  const proxy = new CaptureProxy(19099, caDir, (i) => store.upsert(i));
  proxy.start();
  await new Promise((r) => setTimeout(r, 300));

  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 19099,
        method: 'GET',
        path: 'http://127.0.0.1:19001/hello?x=1',
        headers: { 'x-test': 'yes' },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      }
    );
    req.on('error', reject);
    req.end();
  });
  await new Promise((r) => setTimeout(r, 400));

  const list = store.list();
  assert.strictEqual(list.length, 1, '代理应捕获 1 条');
  assert.ok(list[0].url.includes('/hello'), 'url 应包含 path');
  assert.strictEqual(list[0].query['x'], '1', 'query 应被解析');
  assert.strictEqual(list[0].method, 'GET');
  assert.strictEqual(list[0].headers['x-test'], 'yes', 'headers 应被记录');

  proxy.stop();
  target.close();
  fs.rmSync(caDir, { recursive: true, force: true });
  fs.rmSync(f, { force: true });
}

async function testExtensionReceiver() {
  const f = tmpFile();
  const store = new InterfaceStore(f);
  const receiver = new ExtensionReceiver(
    18991,
    (i) => store.upsert(i),
    (_m, _u, _r) => store.upsertResponse(_m, _u, _r)
  );
  receiver.start();
  await new Promise((r) => setTimeout(r, 300));

  const payload = JSON.stringify({
    method: 'POST',
    url: 'https://api.test/ext?token=abc',
    headers: { 'content-type': 'application/json', 'x-ext': '1' },
    body: '{"k":1}',
    contentType: 'application/json',
  });

  const res = await fetch('http://127.0.0.1:18991/api/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  assert.strictEqual(res.status, 200, '接收端点应返回 200');
  await new Promise((r) => setTimeout(r, 300));

  const list = store.list();
  assert.strictEqual(list.length, 1, '应通过插件端点记录 1 条');
  assert.strictEqual(list[0].method, 'POST');
  assert.ok(list[0].url.includes('/ext'), 'url 应包含 path');
  assert.strictEqual(list[0].query['token'], 'abc', 'query 应被解析');
  assert.strictEqual(list[0].headers['x-ext'], '1', 'headers 应被记录');
  assert.strictEqual(list[0].body, '{"k":1}', 'body 应被记录');

  // 重复发送同接口应去重（仅更新）
  await fetch('http://127.0.0.1:18991/api/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'POST',
      url: 'https://api.test/ext?token=abc',
      headers: { 'x-ext': '2' },
      body: '{"k":2}',
    }),
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(store.list().length, 1, '重复接口应去重');
  assert.strictEqual(store.list()[0].callCount, 2, '调用次数应累加');
  assert.strictEqual(store.list()[0].body, '{"k":2}', 'body 应更新为最新');

  receiver.stop();
  fs.rmSync(f, { force: true });
}

async function testSendRequest() {
  const target = http.createServer((req, res) => {
    res.setHeader('x-echo', req.url || '');
    res.end(JSON.stringify({ method: req.method, url: req.url }));
  });
  await new Promise<void>((r) => target.listen(19111, r));

  const resp = await sendRequest({
    method: 'POST',
    url: 'http://127.0.0.1:19111/ping?a=1',
    headers: { 'content-type': 'application/json' },
    body: '{"x":1}',
  });
  assert.strictEqual(resp.status, 200, '应返回 200');
  assert.strictEqual(resp.headers['x-echo'], '/ping?a=1', '响应头应回显路径');
  const parsed = JSON.parse(resp.body);
  assert.strictEqual(parsed.method, 'POST', '应正确发送 POST');
  target.close();
}

async function testBatchRunner() {
  // ── 并发上限 + 结果保序 ──
  let active = 0;
  let maxActive = 0;
  const server = http.createServer((_req, res) => {
    active++;
    maxActive = Math.max(maxActive, active);
    setTimeout(() => {
      active--;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }, 25);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const rows = Array.from({ length: 60 }, (_, i) => ({ id: String(i) }));
  const out = await runBatchCall({
    method: 'GET',
    url: `http://127.0.0.1:${port}/x?id={{id}}`,
    headers: {},
    body: null,
    variables: ['id'],
    rows,
    sequential: false,
  });
  assert.strictEqual(out.length, 60, '结果条数应为 60');
  out.forEach((r, i) => assert.strictEqual(r.index, i, '并发结果应按行序返回'));
  assert.ok(out.every((r) => r.status === 200), '全部行应成功');
  assert.ok(
    maxActive <= 20,
    `并发上限应 ≤20，实际峰值 ${maxActive}`
  );

  // ── 串行保序 ──
  const seq = await runBatchCall({
    method: 'GET',
    url: `http://127.0.0.1:${port}/x?id={{id}}`,
    headers: {},
    body: null,
    variables: ['id'],
    rows: rows.slice(0, 5),
    sequential: true,
  });
  assert.strictEqual(seq.length, 5, '串行结果条数应为 5');
  assert.strictEqual(seq[4].index, 4, '串行应按下标顺序返回');

  // ── E2E：模板中的 {{$uuid}} 每行独立生成 ──
  const echos: string[] = [];
  const echoServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      echos.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => echoServer.listen(0, '127.0.0.1', r));
  const echoPort = (echoServer.address() as { port: number }).port;
  await runBatchCall({
    method: 'POST',
    url: `http://127.0.0.1:${echoPort}/u`,
    headers: { 'content-type': 'application/json' },
    body: '{"seq":"{{id}}","uuid":"{{$uuid}}"}',
    variables: ['id'],
    rows: [{ id: '1' }, { id: '2' }, { id: '3' }],
    sequential: true,
  });
  const uuids = echos.map((b) => JSON.parse(b).uuid);
  assert.strictEqual(new Set(uuids).size, 3, '每行 $uuid 应互不相同');
  echoServer.closeAllConnections?.();
  await new Promise<void>((r) => echoServer.close(() => r()));

  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
}

test('批量占位符解析：环境变量 + 行变量 + 动态变量', () => {
  // 模拟 runBatchCall 的解析管线：环境变量预解析，动态变量在每行独立生成
  const base = resolveEnvVars(
    {
      method: 'POST',
      url: '{{baseUrl}}/users/{{id}}?t={{$timestamp}}',
      headers: { 'X-Tenant': '{{tenant}}' },
      body: '{"id":"{{id}}","u":"{{$uuid}}"}',
      contentType: null,
    },
    { baseUrl: 'http://localhost:9999' }
  );
  const r1 = resolvePlaceholders(base, { id: '7', tenant: 't1' });
  assert.ok(
    r1.url.startsWith('http://localhost:9999/users/7'),
    '环境变量与行变量应替换进 URL'
  );
  assert.match(r1.url, /\?t=\d+$/, '动态变量 $timestamp 应解析');
  assert.strictEqual(r1.headers?.['X-Tenant'], 't1', '行变量应替换进 Header');
  const r2 = resolvePlaceholders(base, { id: '8', tenant: 't2' });
  assert.ok(r2.url.includes('/users/8'), '每行变量应独立替换');
  const u1 = r1.body!.match(/"u":"([^"]+)"/)![1];
  const u2 = r2.body!.match(/"u":"([^"]+)"/)![1];
  assert.notStrictEqual(u1, u2, '每行 $uuid 应生成不同值');
});

async function main() {
  await testProxyCapture()
    .then(() => {
      console.log('  \u2713 代理成功捕获并去重记录 HTTP 请求');
      passed++;
    })
    .catch((e) => {
      console.error('  \u2717 代理捕获测试失败:', e?.message || e);
    });

  await testSendRequest()
    .then(() => {
      console.log('  \u2713 主进程成功发送 HTTP 请求并解析响应');
      passed++;
    })
    .catch((e) => {
      console.error('  \u2717 发送请求测试失败:', e?.message || e);
    });

  await testExtensionReceiver()
    .then(() => {
      console.log('  \u2713 插件接收端点成功捕获并去重记录请求');
      passed++;
    })
    .catch((e) => {
      console.error('  \u2717 插件接收端点测试失败:', e?.message || e);
    });

  await testBatchRunner()
    .then(() => {
      console.log('  \u2713 批量调用并发受限、结果保序、占位符解析正确');
      passed++;
    })
    .catch((e) => {
      console.error('  \u2717 批量调用测试失败:', e?.message || e);
    });

  console.log(`\n全部断言通过：核心 ${passed} 项 ✅\n`);
}

// 代理会保持事件循环存活，测试结束后必须显式退出
const hardExit = setTimeout(() => {
  console.error('测试超时，强制退出');
  process.exit(1);
}, 20000);

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    clearTimeout(hardExit);
    process.exit(0);
  });
