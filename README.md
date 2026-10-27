# Demo Postman

类 Postman 的桌面 API 调试与录制工具，基于 **Electron + React + TypeScript + Tailwind CSS** 构建。自动抓取并记录浏览器接口，按 `method + URL` 去重并保留最新请求参数，支持手动发送、定时调度、链式工作流与批量调用。

## 功能特性

- **接口自动录制**
  - 通过本地代理（`http-mitm-proxy`）或浏览器扩展抓取**请求与响应**（代理路径已支持 gzip / deflate / br 自动解压，无需手动处理编码）
  - 按 `method + host + path` 去重，自动更新为最新参数
  - 支持按域名自动分组、收藏置顶、自定义显示名与文件夹归类
  - 抓取来源的 `Authorization` / `Proxy-Authorization` / `Cookie` 等敏感头在落库时**自动脱敏**（`***已脱敏***`），手动录入则保留真实值以便重发
- **手动发送与编辑**：表单化编辑 Header / Query / Body，支持 cURL 一键导入；发送过程中可随时**取消**
- **接口管理**：一键**复制**接口、按来源（抓取 / 手动）**批量删除**、收藏置顶、自定义显示名与文件夹归类
- **集合导入 / 导出**：将全部接口记录一键导出为 JSON 文件，或从文件导入（导入时按当前去重规则合并，不重复新建）
- **链式请求（Chain）**：把多个接口串成工作流，上一步响应可经 JSONPath 提取后注入后续步骤（`{{stepName.field}}`），适合「登录拿 token → 调业务接口」等场景；步骤内也支持 `{{$timestamp}}` 等动态变量
- **批量调用**：模板 + `{{var}}` 占位符，逐行变量替换，支持串行 / 并发
  - **动态变量**：`{{$timestamp}}`、`{{$datetime}}`、`{{$date}}`、`{{$time}}`、`{{$uuid}}`、`{{$random(1,100)}}` 等，逐行自动生成，便于构造唯一数据
  - **参数文件夹**：绑定文件夹后，执行时按文件名顺序**实时读取**其中所有文件依次发送（每个文件一次调用，内容增删无需重新保存）；JSON 对象键值自动映射为变量，JSON 数组文件展开为多行，每行附 `fileName` / `fileContent` 内置变量
  - **AI 预处理**：在设置中配置任意 OpenAI 兼容接口（OpenAI / DeepSeek / Kimi / 通义 / 智谱 / Ollama 等），把日志、文档等原始数据交给 AI 整理成结构化参数；结果默认**写入参数文件夹**（每行一个 JSON 文件，存于数据目录 `batch-params/` 下）并自动绑定，也可填充到参数行手动编辑
  - **断点续跑与暂停**：执行进度持久化（已完成行 + 结果 + 参数签名校验），可中途暂停 / 取消，关掉弹窗或重启应用后也能从断点继续跑剩余行；执行过程中**边跑边出结果**
- **定时调度**：固定间隔自动调用单接口或链式任务；可指定未来首次执行时间（`startAt` 相位锚定），支持编辑、启停、**立即执行一次**与执行历史查看
- **响应查看**：超大响应自动截断并支持展开，定时 / 批量 / 链式结果均可在历史中回看
- **明暗主题**：一键切换深 / 浅色主题，偏好持久化在本地
- **抓取与设置**（「设置」面板）
  - 按主机 include / exclude 过滤（支持 `*.example.com` 通配，同时作用于代理与扩展两条路径）
  - **按完整 URL 去重**开关：开启后不同 query 参数的同接口会分别记录
  - **严格校验 TLS 证书**开关：关闭时接受自签名 / 内网证书（默认，适合调试）；开启后拒绝自签名证书
  - **多套环境变量**与一键切换，变量经 `{{env}}` 注入
  - **文件保存位置**：可自定义数据目录，修改后数据自动迁移、重启生效

## 技术栈

| 层 | 技术 |
| --- | --- |
| 主进程 | Electron (electron-vite) + TypeScript |
| 渲染进程 | React 18 + Tailwind CSS + lucide-react |
| 代理 | http-mitm-proxy |
| 通信 | 预加载脚本 `window.api` → IPC → 主进程 store |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式（同时拉起主进程与渲染进程热更新）
npm run dev
# 或 Windows 下使用内置脚本
start-dev.bat
```

## 脚本说明

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式启动（electron-vite dev） |
| `npm run build` | 构建到 `out/` |
| `npm run preview` | 预览构建产物 |
| `npm run start` | 直接运行 `electron .` |
| `npm run typecheck` | TypeScript 类型检查（tsc --noEmit） |
| `npm run lint` | ESLint 检查 |
| `npm run test` | 运行 `test/` 下的测试（tsx） |
| `npm run pack` | 免安装打包（electron-builder --dir） |
| `npm run dist` | 产出可分发包（Windows portable） |

> CI：`.github/workflows/ci.yml` 在 push / PR 时自动跑 `typecheck + lint + test`。

## 使用说明

1. 在顶部 **代理栏** 启动本地代理，并将系统 / 浏览器流量指向该代理（首次需信任内置 CA 证书）。
2. 正常访问网页，捕获到的接口会实时出现在左侧列表，按来源分组。
3. 点击任一接口可在右侧查看 / 编辑请求与最近响应；支持手动重发。
4. **链式请求**：新建 Chain，按序添加步骤并配置 `extract`（JSONPath 提取），后续步骤用 `{{stepName.field}}` 引用。
5. **定时调度**：新建调度，选择单接口或某个链式任务，设置间隔与可选的开始时间，保存后即可在历史上查看每次执行的状态与响应。
6. **批量调用**：编写请求模板并填入变量行，逐行 / 并发执行。参数来源三选一：手动参数行（CSV/JSON 粘贴）、「绑定文件夹」（执行时按文件名顺序实时读取，每个文件一次调用）或「AI 预处理」（结果默认写入参数文件夹并绑定，也可填充到参数行；需先在 **设置 → AI 预处理设置** 中填写 OpenAI 兼容的接口地址 / API Key / 模型名）。

## 使用提示

- **主题切换**：顶栏右上角的太阳 / 月亮图标可一键切换深 / 浅色主题，选择会记住并在下次启动沿用。
- **集合导入 / 导出**：左侧列表顶部的菜单提供「导出集合」（全部接口导出为 JSON）与「导入集合」（从历史文件恢复并按去重规则合并）。
- **接口管理**：在列表项上可复制接口；顶部「管理」可按来源批量清空（仅抓取 / 仅手动），误抓的数据一键清理。
- **全局快捷键**：`Ctrl / Cmd + K` 聚焦搜索框，`Esc` 清空搜索（或取消当前选择）。
- **侧栏宽度**：拖动列表与详情之间的分隔条可调整侧栏宽度，适配不同屏宽。
- **断点续跑**：批量调用中途暂停或关闭弹窗后，已完成的行会保留进度；重新打开任务即可继续跑剩余行（参数行被改动时断点自动失效，避免错乱）。
- **数据目录**：在 **设置 → 文件保存位置** 可更改接口记录 / 定时任务 / 设置的存放目录，修改后数据自动迁移，点击「重启应用」生效。
- **隐私**：抓取来源的请求与响应会落盘到本地数据目录（默认应用数据目录，可自定义），全程无账号、无云同步；敏感头（Authorization / Cookie 等）在抓取入库时即脱敏存储；AI 预处理使用的 API Key 经系统密钥链（Windows DPAPI）加密后落盘。
- **浏览器扩展鉴权**：插件接收端（8891 端口）要求写入请求携带 `x-demo-token` 头，防止本机其他程序灌入伪造记录。Token 随机生成并持久化在数据目录，点击顶栏「插件 Token」按钮即可复制，粘贴到 `browser-extension/` 扩展弹窗的「鉴权 Token」输入框即可（重装扩展后只需重新粘贴一次）。

## 目录结构

```
src/
  main/                主进程（代理、调度、IPC handlers、store）
    scheduler/         定时调度管理器（相位锚定、链式执行）
    ai/                AI 预处理客户端（OpenAI 兼容接口）
    storage/           接口 / 批量 / 链式存储与 FolderManager（原子写、索引维护）
    ipc/               IPC 处理器
    extension/         浏览器扩展接收端点（token 鉴权）
    proxy/             捕获代理与 http-mitm-proxy 最小类型声明
  renderer/            渲染进程（React 组件）
    components/        ProxyBar(主题切换·Token) / Sidebar(导入导出·管理·虚拟列表) / DetailPanel / ManualEntry / BatchPanel / ChainPanel / SchedulePanel ...
    lib/               格式化、文本选择等工具
    store/             接口状态（摘要列表 + 详情按需拉取）
  shared/              主 / 渲染共享类型定义与参数转换纯函数（params.ts，含 RendererApi 单一声明）
  preload/             预加载脚本（window.api）
test/                  测试脚本
browser-extension/     Chrome 扩展（MV3，DevTools 协议捕获）
```

## 构建产物与配置

- 应用标识：`com.demo.postman`，产品名 `Demo Postman`
- 打包输出目录：`dist/`（Windows 目标为 portable）
- `http-mitm-proxy` 在主进程构建中作为外部依赖不参与打包

## 许可

MIT
