import type { BatchRow, FolderFile } from './types';

/**
 * 参数转换的纯函数集合（主/渲染进程共用，便于单元测试）：
 * - filesToRows：参数文件夹中的文件 -> 批量参数行
 * - rowsFromAiText：AI 预处理的回复文本 -> 批量参数行
 */

/** 单元格值字符串化：标量直接转字符串，对象/数组序列化为 JSON。 */
function stringifyCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function objectToCells(obj: Record<string, unknown>): BatchRow {
  const out: BatchRow = {};
  for (const [k, v] of Object.entries(obj)) out[k] = stringifyCell(v);
  return out;
}

/**
 * 把「文件夹中的文件」转换为批量参数行（顺序由调用方保证，通常为文件名排序）：
 * - 默认每个文件一行；
 * - 文件内容为 JSON 对象时，其键值合并进该行（嵌套结构序列化为 JSON 字符串）；
 * - 文件内容为 JSON 对象数组时，每个元素各生成一行（同一文件触发多次调用）；
 * - 解析失败或非 JSON 的文件，原始文本放入 fileContent，由模板按需引用；
 * - 每行自动附带 fileName（文件名）与 fileContent（原始文本）两个内置变量。
 */
export function filesToRows(files: FolderFile[]): BatchRow[] {
  const rows: BatchRow[] = [];
  for (const f of files) {
    const base: BatchRow = { fileName: f.name, fileContent: f.content };
    let parsed: unknown = null;
    const text = f.content.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        rows.push({
          ...base,
          ...(typeof item === 'object' && item !== null
            ? objectToCells(item as Record<string, unknown>)
            : { fileValue: stringifyCell(item) }),
        });
      }
      if (parsed.length === 0) rows.push({ ...base });
    } else if (typeof parsed === 'object' && parsed !== null) {
      rows.push({ ...base, ...objectToCells(parsed as Record<string, unknown>) });
    } else {
      rows.push(base);
    }
  }
  return rows;
}

/** 从文本中提取第一个 JSON 数组（容忍 markdown 代码块与前后说明文字）。 */
export function extractJsonArray(text: string): unknown[] | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  if (start === -1) return null;
  const end = candidate.lastIndexOf(']');
  if (end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** AI 回复文本 -> 批量参数行；解析不出 JSON 数组时返回 null（由调用方提示）。 */
export function rowsFromAiText(text: string): BatchRow[] | null {
  const arr = extractJsonArray(text);
  if (!arr) return null;
  const rows: BatchRow[] = [];
  for (const item of arr) {
    if (typeof item === 'object' && item !== null) {
      rows.push(objectToCells(item as Record<string, unknown>));
    } else {
      rows.push({ value: stringifyCell(item) });
    }
  }
  return rows;
}
