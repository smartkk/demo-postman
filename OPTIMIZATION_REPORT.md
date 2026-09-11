# Demo Postman 启动与优化审查报告

审查日期：2026-09-02 · 代码规模：约 9,800 行（50 个源文件）

---

## 一、启动过程

### 1.1 启动结果：已成功

```
[proxy] 捕获代理已启动: 127.0.0.1:8899
[extension] 插件接收端点已启动: http://127.0.0.1:8891/api/capture
```

| 服务 | 端口 | 状态 |
| --- | --- | --- |
| Vite 渲染进程 | 5173 | 监听中 |
| 捕获代理 | 8899 | 监听中 |
| 插件接收端点 | 8891 | 监听中 |
| 界面渲染 | — | 正常（`dom-ready` → `did-finish-load`，React 已挂载） |

端到端冒烟测试（已通过，测试数据已清理）：

- 抓取写入 → 166 条
- 去重累加 → 同一 `method+host+path` 二次抓取后 `callCount=2`，body 更新为最新值
- 自动分组 → `folder="api.onewo.com"`
- 响应关联 → `lastResponse.status=200`
- 敏感头脱敏 → `authorization` 存储为 `***已脱敏***`

`npx tsc --noEmit` 全量类型检查通过，无类型错误。

### 1.2 启动中遇到并解决的三个阻塞问题

**① `ELECTRON_RUN_AS_NODE=1` 导致启动即崩溃**

当前 shell 环境设置了该变量，Electron 会以纯 Node 模式运行，`require('electron')` 不返回 Electron API：

```
TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')
    at Object.<anonymous> (out/main/index.js:1958:19)
```

规避方式：`env -u ELECTRON_RUN_AS_NODE npm run dev`

**② 5 天前的残留实例占用端口**

PID 10124 等 4 个 Electron 进程（8/28 启动）持续占用 8899/8891/5173，新实例因单实例锁生效而自动退出（属正常设计）。已清理。

**③ GPU 进程反复崩溃导致应用自杀**

无 GPU / 受限环境下 Chromium GPU 进程无法启动，达到阈值后直接终止应用：

```
[ERROR:gpu_process_host.cc] GPU process exited unexpectedly: exit_code=1   (重复 9 次)
[FATAL:gpu_data_manager_impl_private.cc(449)] GPU process isn't usable. Goodbye.
```

已验证 `ELECTRON_EXTRA_LAUNCH_ARGS` 无法被 electron-vite 透传，`app.disableHardwareAcceleration()` 单独使用也不足以解决——根本原因是 GPU 子进程无法 fork。

**④ 窗口黑屏：渲染进程被杀死**（在上述问题修复后暴露）

服务全部就绪、端口正常监听、Vite 页面 curl 能正常返回转译结果，但窗口一片黑（显示的是 `backgroundColor: '#0F172A'`）。

加生命周期探针后定位到：

```
LOAD target=http://localhost:5173
EVENT did-start-loading
EVENT render-process-gone {"reason":"killed","exitCode":1}    ← 开始加载 12 秒后被杀
```

`exitCode: 1` + `reason: "killed"` 与 GPU 进程崩溃是**同一个根因**——这个环境不允许 Chromium fork 子进程。`in-process-gpu` 只救了 GPU，渲染进程仍会 fork 失败，于是窗口只剩背景色。

**已做的代码改动**（`src/main/index.ts`，仅在设置 `DISABLE_GPU=1` 时生效，对正常环境零影响）：

```ts
if (process.env.DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  // 某些受限环境（容器 / 沙箱）连 GPU 子进程都无法 fork，
  // 此时把 GPU 相关逻辑收进浏览器进程内执行。
  app.commandLine.appendSwitch('in-process-gpu');
  // 同一个受限环境下渲染进程同样会因沙箱初始化失败而被杀（exitCode=1），
  // 表现为窗口黑屏；关闭 Chromium 沙箱后渲染进程可正常启动。
  app.commandLine.appendSwitch('no-sandbox');
}
```

同时在 `createWindow()` 内加了一组**生命周期诊断探针**（`did-start-loading` / `dom-ready` / `did-finish-load` / `did-fail-load` / `preload-error` / `render-process-gone` / `unresponsive`），写入 `render_console.log`。开销极小，只在事件发生时落盘，以后再遇到黑屏能一眼定位，建议保留。

启动命令：

```bash
env -u ELECTRON_RUN_AS_NODE DISABLE_GPU=1 npm run dev
```

修复后的完整加载链路：

```
LOAD target=http://localhost:5173
EVENT did-start-loading
[vite] connecting... → [vite] connected.
React DevTools 提示                    ← React 已挂载
EVENT dom-ready → EVENT did-finish-load
Electron Security Warning (CSP)        ← 应用已正常运行
```

> **两点提醒**
>
> 1. `start-dev.bat` 建议加一行 `set ELECTRON_RUN_AS_NODE=`，避免该环境变量污染导致启动即崩。
> 2. **改动 `src/main/**` 后 `electron-vite` 不会自动重建重启**（v2.3 实测如此）。日志看着正常、端口也在监听，但跑的是旧产物。改完 main 侧代码务必手动停任务 → 杀 electron → 重新 `npm run dev`，否则会对着旧产物排查半天。本次排查就在这个坑上白耗了一轮。

---

## 二、性能问题（按影响排序）

### P0-1 每次抓取都全量推送 13MB 数据到渲染进程

**这是当前最严重的性能瓶颈。**

链路：`InterfaceStore.emitChange()` → `src/main/ipc/handlers.ts:418`

```ts
store.onChange(() => {
  getWin()?.webContents.send('store:updated', store.list(), store.listFolders());
});
```

问题在于：**写盘有 300ms 防抖（`scheduleSave`），但推送没有任何节流**。每捕获一条请求就触发一次全量列表的跨进程结构化克隆。

实测数据（当前 `interfaces.json`）：

| 指标 | 实测值 |
| --- | --- |
| 文件大小 | 13.33 MB |
| 记录条数 | 166 条 |
| `JSON.parse` | 48 ms |
| `JSON.stringify` | 82 ms |
| 历史响应总条数 | 277 条 |
| 响应体 > 100KB 的记录 | 11 条 |

抓包时每秒可能数十条请求，意味着每秒数十次 13MB 级别的序列化 + IPC 传输，界面必然卡死。

**建议**：

1. 给 `emitChange` 加 150~300ms 节流（与 `scheduleSave` 同频或略高），这是投入产出比最高的一改；
2. 中期改为增量推送——只推送本次变更的那一条记录（新增 / 更新 / 删除），渲染进程本地合并；
3. `store.list()` 每次都执行 `[...values].sort()`，排序结果可缓存到下次变更。

### P0-2 搜索与过滤全量重算，无防抖

`src/renderer/src/store/useInterfaces.ts:108`，`filtered` 的 `useMemo` 依赖整个 `list`：

```ts
const hay = [
  it.method, it.url, it.host, it.name || '',
  it.body || '',
  it.lastResponse?.body || '',        // ← 单条最大 1MB
  JSON.stringify(it.query),
  JSON.stringify(it.headers),
].join(' ').toLowerCase();
```

实测一次全量拼接耗时 **27ms**（166 条）。搜索框每敲一个字符触发一次，且随数据量线性恶化——记录数翻 10 倍就是 270ms/次，`list` 一变还要再来一次。

**建议**：

1. `keyword` 输入加 200ms 防抖（当前 `setKeyword` 直接同步入 state）；
2. 搜索范围排除 `lastResponse.body`，或截断到前 4KB——响应体偶尔搜一下用，不值得每次全量拼；
3. 预建小写搜索索引，在 `list` 变化时构建一次而非每次按键构建。

### P1-3 Sidebar 分组渲染是 O(分组数 × 记录数)

`src/renderer/src/components/Sidebar.tsx:496`，对每个分组做一次全量 `filter`：

```ts
groupOrder.map((f) => {
  const items = filtered.filter((it) => (it.folder || '') === f);
```

**建议**：一次遍历完成分桶（`Map<folder, items[]>`）。记录上千后还需引入虚拟滚动（当前 166 条无感，但配合 P0-1 的高频更新会放大开销）。

### P1-4 响应回传走全表线性扫描

`src/main/storage/interfaceStore.ts:497`，`captureIndex` 未命中时退化为 O(n) 全表扫描：

```ts
for (const r of this.records.values()) {
  if (r.method.toUpperCase() === m && r.host.toLowerCase() === host.toLowerCase() && r.path === p) {
```

响应回传是高频路径（每次页面请求都有），166 条尚可，涨到数千条后每次响应都要全扫一遍。

**建议**：建立 `method|host|path` → id 的次级索引，与 `captureIndex` 同步维护。

### P1-5 删除记录时清理索引是全扫描

`interfaceStore.ts:268 / 336 / 350`，三处都是遍历整个 `captureIndex` 找目标 id：

```ts
for (const [k, v] of this.captureIndex) {
  if (v === id) this.captureIndex.delete(k);
}
```

**建议**：维护 `id → key` 的反向映射，删除时 O(1) 清理。

---

## 三、正确性与健壮性

### P1-6 代理启动的 try/catch 抓不到异步错误

`src/main/proxy/captureProxy.ts:106`：

```ts
try {
  proxy.listen({ port: this.port, sslCaDir: this.caDir });
  this.proxy = proxy;
  console.log(`[proxy] 捕获代理已启动: 127.0.0.1:${this.port}`);
} catch (err) {
  console.error('[proxy] 启动失败', err);
}
```

`listen` 的失败是异步抛出的，`try/catch` 完全无效。**本次启动已实测到这个 bug**：端口被占时日志照样打印"捕获代理已启动"，实际监听失败，而同样的 `EADDRINUSE` 在 `ExtensionReceiver` 那边（有 `server.on('error')`）才如实报出来。

**建议**：改用 `proxy.listen(...)` 的回调或监听 `error` 事件，失败时把 `this.proxy` 置空并向上层上报，让 UI 能显示真实的代理状态。

### P1-7 代理模式不捕获响应（功能缺失）

`captureProxy.ts` 只挂了 `onRequest` / `onRequestData` / `onRequestEnd`，**没有响应钩子**。而 `onResponse` 回调只有 `ExtensionReceiver` 会调用。

后果：走系统代理抓的接口，永远只有请求没有响应，右侧"响应"面板始终为空——README 里的"响应查看"能力只在浏览器扩展路径下成立。

**建议**：补上 `proxy.onResponse(...)` / `onResponseData` / `onResponseEnd`，按 `ctx` 上挂的 `_capture` 关联到同一条记录。

### P1-8 响应体超限时泄漏 abort 监听

`src/main/request/sender.ts:100`：

```ts
if (size > MAX_BODY) {
  req.destroy();
  reject(new Error('响应体过大（超过 8MB）'));
  return;
}
```

这个分支既没有 `signal?.removeEventListener('abort', onAbort)`，也没有 `res.resume()`。而同文件的重定向分支（79 行）和正常结束分支（108 行）都做了清理——唯独这里漏了，说明是遗漏而非有意为之。

**建议**：补上两行清理，保持与其他分支一致。

### P1-9 导入集合后去重索引键不一致

`interfaceStore.ts:437`（`importCollection`）与 `buildKey` 的调用方式不一致：

```ts
// importCollection 中：未传 search
this.captureIndex.set(this.buildKey(r.method, r.host, r.path), r.id);

// setDedupMode 中：传了 search
this.captureIndex.set(this.buildKey(r.method, r.host, r.path, search), r.id);
```

当前用户设置 `dedupByFullUrl: true`，此时导入的记录索引键与查询键不匹配，后续抓取会重复新建记录。

**建议**：抽出统一的 `rebuildIndex()`，`load` / `importCollection` / `setDedupMode` 三处共用同一套建键逻辑，消除这类漂移。

### P1-10 代理请求体无大小上限

`captureProxy.ts` 的 `cap.chunks` 无限 push：

```ts
proxy.onRequestData((ctx, chunk, callback) => {
  if (cap) cap.chunks.push(chunk);
```

对比：`ExtensionReceiver` 有 5MB 上限，`sender` 有 8MB 上限，**唯独代理没有**。抓到一个大文件上传就会把主进程内存顶上去。

**建议**：加累计上限，超限时丢弃 body 但保留请求元信息（method/url/headers），与另两处保持一致。

### P2-11 请求没有超时（注释说是刻意设计）

`sender.ts:12` 明确写了不设超时。手动调试场景合理，但**批量调用和定时调度场景会累积挂起请求**——服务不可达时，20 并发的批量任务或周期性定时任务会不断堆积永不释放的连接。

**建议**：保留手动发送不超时，给批量/定时/链式场景加可配置超时（如 30s）。

---

## 四、安全

### P2-12 插件接收端点无鉴权且 `Access-Control-Allow-Origin: *`

`src/main/extension/extensionReceiver.ts:42`：

```ts
res.setHeader('Access-Control-Allow-Origin', '*');
```

监听在 127.0.0.1 且对任意来源放行，意味着**你浏览的任何网页都能向 8891 端口 POST 伪造的接口记录**，污染抓取数据（配合 DNS rebinding 风险更高）。

**建议**：校验 `Origin` 为 `chrome-extension://` 开头，或要求一个首次启动时生成的本地 token；同时绑定 `Host: 127.0.0.1` 校验。

### P2-13 渲染进程未设置 CSP

Electron 启动日志中的官方警告：

```
Electron Security Warning (Insecure Content-Security-Policy)
This renderer process has either no Content-Security-Policy set or a policy with "unsafe-eval" enabled.
```

`src/renderer/index.html` 中未找到 CSP 配置。

**建议**：加一个 `<meta http-equiv="Content-Security-Policy">`，仅允许 `self` 与 dev 模式的 `localhost:5173` + `unsafe-inline`（Vite HMR 需要）。

### P2-14 `rejectUnauthorized` 已做成设置项 ✅

~~`sender.ts:52` 关闭了证书校验。~~ 已改为读取 `CaptureSettings.verifyTls`：默认 `false`（保持旧行为，接受自签名 / 内网证书，适合调试），UI「严格校验 TLS 证书」开关开启后变为 `true`（严格校验，自签名证书会被拒绝）。`Settings` 实例在 `index.ts` 创建后通过 `bindSettingsInstance` 注入，`sender.ts` 经 `getActiveSettings()` 读取，无需层层透传；读取处用 `?.get().verifyTls ?? false` 兜底，实例未绑定时也不会崩溃（回退到接受自签名证书的旧行为）。

### 已确认安全

- `browser-extension.pem` / `.crx` 从未被 git 追踪，`git log --diff-filter=A` 历史中也无记录，私钥未泄露。

---

## 五、工程与代码质量

### P2-15 组件体量过大

| 文件 | 行数 |
| --- | --- |
| `ChainPanel.tsx` | 920 |
| `BatchPanel.tsx` | 706 |
| `DetailPanel.tsx` | 682 |
| `Sidebar.tsx` | 581 |
| `SchedulePanel.tsx` | 552 |

`ChainPanel` 与 `BatchPanel` 存在大段几乎相同的逻辑：项目列表渲染、文件夹增删改移、重命名、运行与结果展示。

**建议**：抽取 `useFolderCrud` / `useProjectList` 之类的自定义 hook，两个面板的重复代码可以消掉一半以上。

### P2-16 三份 Store 的文件夹管理逻辑重复

`interfaceStore` / `batchStore` / `chainStore` 各自实现了 `createFolder` / `deleteFolder` / `listFolders` / `moveFolder`，实现基本一致。

**建议**：抽一个 `FolderMixin` 或基类。

### P3-17 依赖分类问题

`lucide-react`、`react-icons`、`tailwind-merge` 被放在 `devDependencies`，但它们在渲染代码中被直接 import。Vite 会把它们打进产物所以运行时不报错，但分类是错的，且 `http-mitm-proxy`（真正的运行时依赖）被 external 后依赖 electron-builder 的自动依赖收集。

另外同时装了 `lucide-react` 与 `react-icons` 两套图标库，建议统一。

### P3-18 仓库根目录临时文件已清理 ✅

~~17 个构建/调试残留文件（`app.log`、`_build.txt`、`_tsc.txt`、`err_s.txt`、`dev_out*.log`、`inst*.log` 等）。`.gitignore` 已覆盖大部分，但文件实体仍在本地。~~ 已删除 18 个构建/调试残留文件（`_build.txt`、`_commitmsg.txt`、`_tsc.txt`、`app.err`、`app.log`、`build.log`、`build_err.txt`、`dev.log`、`dev_boot.log`、`dev_live.log`、`dev_out.log`、`dev_out2.log`、`err_s.txt`、`inst.err`、`inst.log`、`inst_status.txt`、`out_s.txt`、`status.txt`）；`dist/`（336MB，electron-builder 产物，可 `npm run dist` 重生）也已删除。保留全部辅助脚本（`_dev_bg.bat`、`_kill.js`、`launch.bat`、`start-dev.bat`）、真实配置、源码目录与 `browser-extension.pem`（私钥）/`.crx`。全部文件均在 `.gitignore` 的忽略清单内，删除不影响版本库。

### P3-19 React key 警告

运行日志中捕获到：

```
Warning: Each child in a list should have a unique "key" prop.
Check the render method of `SchedulePanel`.
```

建议顺手修掉，避免后续列表更新出现渲染错乱。

### 测试现状

`test/run.ts` 813 行 + `live-tests/` 2 个文件（137 行）。覆盖不算充分，P0/P1 的性能与索引类改动建议同步补测试（尤其是 `buildKey` 索引一致性，P1-9 就是这类 bug）。

---

## 六、建议的修复顺序

| 优先级 | 项目 | 预估收益 |
| --- | --- | --- |
| 1 | P0-1 推送节流 | 抓包卡顿的根因，改动最小（约 10 行） |
| 2 | P0-2 搜索防抖 + 缩小搜索范围 | 输入流畅度，改动小 |
| 3 | P1-7 代理响应捕获 | 补齐核心功能缺口 |
| 4 | P1-6 / P1-8 / P1-9 | 三处明确 bug，各几行 |
| 5 | P2-12 / P2-13 | 安全加固 |
| 6 | P1-3 / P1-4 / P1-5 | 数据量增长后的性能储备 |
| 7 | P2-15 / P2-16 | 可维护性重构 |

---

## 七、修复进展（2026-09-10 更新）

### 已完成并验证

| 编号 | 问题 | 处理方式 |
| --- | --- | --- |
| P0-1 | 每次抓取全量推送 13MB | `emitChange()` 节流 200ms；`list()` 排序结果缓存，数据变更时失效 |
| P0-2 | 搜索无防抖、全量重算 | 关键字防抖 200ms（`queryKeyword`）；响应体搜索截断到 2KB |
| P1-3 | Sidebar 分桶 O(分组 × 记录) | `useMemo` 一次遍历建 `Map<folder, items[]>`，顺带合并来源计数 |
| P1-4 | 响应回传全表扫描 | 新增 `pathIndex`（method\|host\|path → id 集合），覆盖全部记录；未命中 captureIndex 时 O(1) 定位 |
| P1-5 | 删除时索引全扫描 | 统一走 `rebuildIndexes()`，消除三处重复逻辑与 O(n²) 删除 |
| P1-6 | 代理启动错误抓不到 | 用 `listening` 标志区分启动期与运行期错误 |
| P1-7 | 代理不捕获响应 | 补 `onResponse` / `onResponseData` / `onResponseEnd`；gzip/deflate/br 解压；请求响应体各限 2MB |
| P1-8 | 响应超限时泄漏 abort 监听 | 超限分支先摘监听再销毁，并 `res.resume()` 排空 |
| P1-9 | 导入后去重键不一致 | 抽出 `searchOf()` + `rebuildCaptureIndex()`，所有建索引路径共用 |
| P1-10 | 代理请求体无上限 | 请求/响应体均限 2MB |
| P2-11 | 自动场景无超时 | 新增 `AUTO_TIMEOUT_MS = 30s`，批量 / 链式 / 定时接入；手动发送保持不超时（可取消）。超时随重定向链传递 |
| P2-12 | 插件端点 CORS `*` | 校验 `Origin`（chrome-extension:// 或本机）与 `Host`（挡 DNS rebinding）；CORS 改为回显可信来源 + `Vary` |
| P2-13 | 无 CSP | 加 meta CSP；`unsafe-eval` 仅 dev 保留，构建期由 `tightenCspForBuild()` 插件摘除 |
| P3-19 | SchedulePanel key 警告 | `key` 移到 `Fragment` 上（原先错放在内层 `<tr>`）；顺带改用响应时间戳做身份，修掉「新记录插入后展开行错位」 |
| P2-15 | 组件体量过大 / 重复文件夹逻辑 | 抽 `useFolderCrud` hook（folders/newFolderName/addFolder/refreshFolders），ChainList·BatchList·ChainPanel·BatchPanel 四个组件共用，删掉 4 份重复状态与 `addFolder` |
| P2-16 | 三份 Store 文件夹逻辑重复 | 抽 `FolderManager` 类（create/delete/list/setAll + 删组清空 item.folder）+ `atomicWriteJson`（.tmp→rename→.bak），interface/batch/chain 三 store 委托 |
| P3-17 | 双图标库 / 依赖分类错误 | 确认图标 100% 来自 `lucide-react`；删除从未引用的 `react-icons`、`tailwind-merge` 死依赖；`lucide-react` 由 devDeps 移到 dependencies |
| P2-14 | `rejectUnauthorized` 硬编码 | 新增 `verifyTls` 设置项（默认 `false`，接受自签名/内网证书）；UI 增加「严格校验 TLS 证书」开关；`sender.ts` 经 `getActiveSettings()` 读取，`Settings` 实例由 `index.ts` 创建后 `bindSettingsInstance` 注入 |
| P3-18 | 根目录临时文件 + `dist/` | 删除 18 个构建/调试残留文件与 `dist/`（336MB，可 `npm run dist` 重生）；保留辅助脚本、配置、源码与扩展私钥 |

### 验证结果

- `tsc --noEmit` 通过（0 错误）。
- 应用启动正常：`dom-ready` → `did-finish-load`，无 `render-process-gone`、无 React key 警告。
- 扩展端点冒烟：无 Origin → 200；`chrome-extension://` → 200；`https://evil.example.com` → **403 forbidden origin**，且数据未落库。
- 代理端到端：通过代理请求本地 gzip 服务，记录正确入库、`callCount` 累加、响应体**解压正确**（明文 JSON 非乱码）、历史累积 3 条。
- 生产构建：`npm run build` 通过，`out/renderer/index.html` 的 CSP 已无 `unsafe-eval`，dev 源码保留。
- 测试数据已清理，`interfaces.json` 回到 **166 条**基线。
- 第三批（P2-15/16/17）：`tsc` 0 错误；生产 / `dev` 构建均通过；对 `FolderManager` / `atomicWriteJson` 跑了一组临时单测（15 项全过，已删除）；干净启动无报错，扩展端点 8891 + 捕获代理 8899 正常监听。
- 第四批（P2-14 / P3-18）：`tsc --noEmit` 0 错误；`npm run build` 通过（main 67.9KB / preload 5.9KB / renderer 495KB）；对 `bindSettingsInstance` / `getActiveSettings` / 默认 `verifyTls` 跑了一组临时单测（6 项全过，已删除）；根目录清理后保留文件/目录全部完好（`_dev_bg.bat`、`_kill.js`、`package.json`、源码目录、`browser-extension.pem` 等）。
- **专项单测（P1-3 / P1-4 / P1-5 / P1-9 / P1-10）**：`npm test` 全量通过（52 项），其中新增 6 项：
  - P1-3 `buildFolderBuckets` 纯函数：分桶无遗漏/无重复，capturedCount 正确；已抽到 `src/renderer/src/utils/groupByFolder.ts`，Sidebar 直接调用。
  - P1-4 `pathIndex` 次级索引：多记录同 host 不同 path 不串号；手动记录（captureIndex 未命中）也能通过 pathIndex 关联响应。
  - P1-5 `deleteOne` 索引清理：删除后 `upsertResponse` 不再找到已删记录，而是新建一条（callCount=1，总数回到删除前）。
  - P1-9 导入去重一致性：`dedupByFullUrl` 下 export→import→rebuildIndexes→再抓同一 query 仍正确合并（不重复新建）。
  - P1-10 代理体上限：3MB POST 请求体经代理后 `body=null`（超限丢弃），但 method/url/headers 保留；小请求体（5B）原样保留。

### 仍未处理

无（报告所列项已全部处理）。

### 顺带发现

- `src/renderer/index.html` 外链 Google Fonts 的 `<link rel="stylesheet">` 是**渲染阻塞**的。内网/离线环境下会挂住首屏，已改为非阻塞加载（`media="print"` + `onload` 切回 `all`）；Poppins 本身仍有 `system-ui` / `Segoe UI` 兜底，取不到字体也不影响使用。

---

### 复现验证时的注意事项

1. **改 `src/main/**` 后 `npm run dev` 不会自动重建**，必须手动停掉再启动，否则改动不生效。
2. 启动命令需清掉 shell 里的 `ELECTRON_RUN_AS_NODE`，否则 Electron 会以纯 Node 模式运行：
   ```bash
   env -u ELECTRON_RUN_AS_NODE DISABLE_GPU=1 npm run dev
   ```
3. 代理默认只抓 `*.onewo.com`（见 `settings.json` 的 `includeHosts`）。要验证代理链路，需临时把目标 host 加进白名单并重启。
