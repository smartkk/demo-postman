export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS';

/** 记录/响应来源：浏览器抓取（插件/代理）或手动发送/录入。 */
export type RecordSource = 'captured' | 'manual';

/** 抓取过滤与自动分组设置（主进程持久化，作用于代理 + 插件两条抓取路径）。 */
export interface CaptureSettings {
  /** 仅捕获这些主机（空=不过滤）；支持 *.example.com 通配与精确/子域匹配。 */
  includeHosts: string[];
  /** 排除这些主机。 */
  excludeHosts: string[];
  /** 抓取请求是否按域名（hostname）自动建分组。 */
  autoGroup: boolean;
  /** 去重键是否包含 query 参数（true=按完整 URL 去重，false=仅 method+host+path）。 */
  dedupByFullUrl?: boolean;
  /** 环境变量集合：环境名 -> { 变量名: 变量值 }。 */
  environments?: Record<string, Record<string, string>>;
  /** 当前激活的环境名。 */
  activeEnv?: string;
}

export interface InterfaceRecord {
  id: string;
  method: string;
  url: string; // base url (scheme://host/path)，不含 query
  host: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string | null;
  contentType: string | null;
  lastResponse: ResponseRecord | null;
  createdAt: string;
  lastUpdated: string;
  callCount: number;
  source: RecordSource; // 该接口记录是如何产生的
  name?: string; // 显示名称，缺省时回退到 path
  folder?: string; // 所属分组，空字符串表示「未分组」
  pinned?: boolean; // 是否收藏置顶
  responses?: ResponseRecord[]; // 历史响应（最近若干条，最新在末尾）
  /** 最后一次实际「发送请求」的时间（ISO），编辑/重命名等不触发更新。 */
  lastSentAt?: string;
}

export interface ResponseRecord {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  at: string; // ISO 时间
  source?: RecordSource; // 该响应是如何产生的
}

export interface CaptureInput {
  method: string;
  url: string; // 完整 url（可含 query）
  headers?: Record<string, string>;
  body?: string | null;
  contentType?: string | null;
}

export interface ProxyStatus {
  running: boolean;
  port: number;
  caPath: string | null;
}

export interface ExtensionStatus {
  running: boolean;
  port: number;
}

/** 定时调度配置：以固定间隔自动调用某个接口或链式任务。 */
export interface ScheduleConfig {
  id: string;
  name: string;
  input: CaptureInput;
  /** 若设置，则定时执行该链式任务（ChainProject.id）；此时 input 不生效。 */
  chainId?: string;
  /** 调用间隔（秒）。 */
  intervalSeconds: number;
  enabled: boolean;
  /** 首次执行时间（ISO 字符串）。留空则保存后立即按间隔调度；设置未来时间则等待到该刻首次执行。 */
  startAt?: string;
  createdAt: string;
  lastRunAt?: string;
  lastResult?: ScheduleRunResult;
  runCount: number;
  /** 执行历史（最近 N 条，最新在末尾）。最多保留 50 条。 */
  history?: ScheduleRunResult[];
}

/** 定时调度单次运行结果。 */
export interface ScheduleRunResult {
  status: number;
  statusText: string;
  durationMs: number;
  error?: string;
  /** 响应体（可能截断，便于在历史中查看）。 */
  body?: string | null;
  /** 被调度触发（开始发送）的时间。 */
  firedAt: string;
  /** 响应完成时间（含重定向/网络耗时）。 */
  at: string;
}

/** 批量调用单行参数：变量名 -> 变量值。 */
export type BatchRow = Record<string, string>;

/** 批量调用单次结果（与 ResponseRecord 类似，但携带行序号与发送时间）。 */
export interface BatchCallResult {
  /** 行序号（从 0 开始）。 */
  index: number;
  /** 该行用于替换的变量值（便于回溯）。 */
  vars: BatchRow;
  status: number;
  statusText: string;
  durationMs: number;
  error?: string;
  body: string;
  /** 实际发送的请求（占位符已替换）。 */
  request: CaptureInput;
  /** 实际发送时间（ISO）。 */
  sentAt: string;
  /** 响应完成时间（ISO）。 */
  at: string;
}

/** 批量调用请求体：基础请求模板 + 变量名列表 + 每行变量值。 */
export interface BatchCallInput {
  method: string;
  url: string; // 可含 {{var}} 占位符
  headers: Record<string, string>; // 值可含 {{var}}
  body: string | null; // 可含 {{var}}
  /** 变量名列表（与模板中的 {{var}} 对应）。 */
  variables: string[];
  /** 每行变量值（顺序对应 variables）。 */
  rows: BatchRow[];
  /** 是否串行执行（true=逐条，false=并发）。 */
  sequential?: boolean;
}

/** 持久化的批量调用任务（「项目」）：可保存、按文件夹分组，关闭弹窗不丢失。 */
export interface BatchProject {
  id: string;
  name: string; // 显示名称
  method: string;
  url: string; // 可含 {{var}} 占位符
  headers: Record<string, string>;
  body: string | null;
  variables: string[];
  rows: BatchRow[];
  sequential: boolean;
  folder: string; // 所属文件夹，空串表示「未分组」
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string; // 最近一次运行时间
  results?: BatchCallResult[]; // 最近一次运行结果（可选持久化）
}

/* ───────────────────────────────────────────────────────────
 * 链式请求（Chain）：把多个接口按顺序串成一个工作流，
 * 上一步的响应结果可作为后续步骤的参数（变量注入）。
 * 适合「先登录拿 token → 用 token 调业务接口」这类场景。
 * ─────────────────────────────────────────────────────────── */

/** 链式请求中的单个步骤（一个独立 HTTP 请求）。 */
export interface ChainStep {
  /** 步骤唯一 id（同链内唯一），用于被后续步骤引用其结果。 */
  id: string;
  /** 步骤显示名（同时也是引用键，例如「login」）。 */
  name: string;
  method: string;
  url: string; // 可含 {{var}} / {{上一步.name.字段}} 占位符
  headers: Record<string, string>; // 值可含占位符
  body: string | null; // 可含占位符
  /**
   * 从本步骤响应中提取的字段映射：
   *   输出变量名 -> JSONPath（点路径，如 "data.token" 或 "id"）
   * 提取后可通过 {{本步骤name.变量名}} 在后续步骤引用。
   */
  extract: Record<string, string>;
}

/** 链式请求整体配置（可持久化保存，按文件夹分组）。 */
export interface ChainProject {
  id: string;
  name: string;
  steps: ChainStep[]; // 顺序即调用顺序，可上下调整
  folder: string; // 所属文件夹，空串表示「未分组」
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  results?: ChainRunResult[]; // 最近一次运行结果（按步骤顺序）
}

/** 链式请求单步运行结果。 */
export interface ChainRunResult {
  stepId: string;
  name: string;
  index: number;
  status: number;
  statusText: string;
  durationMs: number;
  error?: string;
  /** 实际发送的请求（占位符已替换）。 */
  request: CaptureInput;
  /** 从头步提取得到的变量（key -> value），便于回溯。 */
  extracted: Record<string, string>;
  /** 响应体（失败后可能为空）。 */
  body: string;
  sentAt: string;
  at: string;
}
