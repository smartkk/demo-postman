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

/** 定时调度配置：以固定间隔自动调用某个接口。 */
export interface ScheduleConfig {
  id: string;
  name: string;
  input: CaptureInput;
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
  at: string;
}
