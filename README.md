# Demo Postman

类 Postman 的桌面 API 调试与录制工具，基于 **Electron + React + TypeScript + Tailwind CSS** 构建。自动抓取并记录浏览器接口，按 `method + URL` 去重并保留最新请求参数，支持手动发送、定时调度、链式工作流与批量调用。

## 功能特性

- **接口自动录制**
  - 通过本地代理（`http-mitm-proxy`）或浏览器扩展抓取请求
  - 按 `method + host + path` 去重，自动更新为最新参数
  - 支持按域名自动分组、收藏置顶、自定义显示名与文件夹归类
- **手动发送与编辑**：表单化编辑 Header / Query / Body，支持 cURL 一键导入
- **链式请求（Chain）**：把多个接口串成工作流，上一步响应可经 JSONPath 提取后注入后续步骤（`{{stepName.field}}`），适合「登录拿 token → 调业务接口」等场景
- **批量调用**：模板 + `{{var}}` 占位符，逐行变量替换，支持串行 / 并发
- **定时调度**：固定间隔自动调用单接口或链式任务；可指定未来首次执行时间（`startAt` 相位锚定），支持编辑、启停与执行历史查看
- **响应查看**：超大响应自动截断并支持展开，定时 / 批量 / 链式结果均可在历史中回看
- **抓取过滤**：按主机 include / exclude 过滤，环境变量（`{{env}}`）注入

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
| `npm run test` | 运行 `test/` 下的测试（tsx） |
| `npm run pack` | 免安装打包（electron-builder --dir） |
| `npm run dist` | 产出可分发包（Windows portable） |

## 使用说明

1. 在顶部 **代理栏** 启动本地代理，并将系统 / 浏览器流量指向该代理（首次需信任内置 CA 证书）。
2. 正常访问网页，捕获到的接口会实时出现在左侧列表，按来源分组。
3. 点击任一接口可在右侧查看 / 编辑请求与最近响应；支持手动重发。
4. **链式请求**：新建 Chain，按序添加步骤并配置 `extract`（JSONPath 提取），后续步骤用 `{{stepName.field}}` 引用。
5. **定时调度**：新建调度，选择单接口或某个链式任务，设置间隔与可选的开始时间，保存后即可在历史上查看每次执行的状态与响应。
6. **批量调用**：编写请求模板并填入变量行，逐行 / 并发执行。

## 目录结构

```
src/
  main/                主进程（代理、调度、IPC handlers、store）
    scheduler/         定时调度管理器（相位锚定、链式执行）
    ipc/               IPC 处理器
  renderer/            渲染进程（React 组件）
    components/        ProxyBar / Sidebar / DetailPanel / ChainPanel / SchedulePanel ...
    lib/               格式化、文本选择等工具
    store/             接口状态
  shared/              主 / 渲染共享类型定义
  preload/            预加载脚本（window.api）
test/                  测试脚本
```

## 构建产物与配置

- 应用标识：`com.demo.postman`，产品名 `Demo Postman`
- 打包输出目录：`dist/`（Windows 目标为 portable）
- `http-mitm-proxy` 在主进程构建中作为外部依赖不参与打包

## 许可

MIT
