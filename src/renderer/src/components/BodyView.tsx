import { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Download, Search, Code2, ListTree } from 'lucide-react';
import {
  detectKind,
  tryPrettyJson,
  parseJsonSafe,
  parseFormUrlEncoded,
  syntaxHighlightJson,
  byteSize,
  formatSize,
  hardTruncate,
} from '../lib/format';
import { KVTable } from './KVTable';
import { JsonTree } from './JsonTree';
import { selectPreOnClick } from '../lib/select';

interface Props {
  body: string | null;
  contentType?: string | null;
  emptyHint?: string;
  collapsible?: boolean;
}

const COLLAPSE_LINES = 60;
const COLLAPSE_BYTES = 30 * 1024;

/** 在文本中高亮搜索词（返回 React 节点）。 */
function highlight(text: string, term: string): React.ReactNode {
  const t = term.trim();
  if (!t) return text;
  const lower = text.toLowerCase();
  const lt = t.toLowerCase();
  const idxs: number[] = [];
  let i = 0;
  while ((i = lower.indexOf(lt, i)) !== -1) {
    idxs.push(i);
    i += lt.length;
  }
  if (!idxs.length) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  idxs.forEach((start, n) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={n}
        className="rounded bg-amber-400/30 text-amber-200"
      >
        {text.slice(start, start + t.length)}
      </mark>
    );
    cursor = start + t.length;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/**
 * 美化后的请求/响应体视图：
 * - JSON：可折叠树 / 原始文本切换，语法高亮 + 搜索高亮
 * - form-urlencoded：解析为键值表
 * - 其它：原样展示（长行自动换行）
 * 顶部提供类型徽标、体积、树展开/折叠、搜索、下载、复制。
 * 内容过长（>60 行或 >30KB）默认折叠，可展开查看全部。
 */
export function BodyView({
  body,
  contentType,
  emptyHint = '无数据',
  collapsible = true,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [treeExpandAll, setTreeExpandAll] = useState(false);
  const [treeKey, setTreeKey] = useState(0);
  const [raw, setRaw] = useState(false);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  if (body == null || body.trim() === '') {
    return (
      <div className="py-8 text-center text-[12px] text-slate-600">{emptyHint}</div>
    );
  }

  // 超大响应体硬截断：超过阈值时默认只渲染前 N 字符，避免大 DOM 卡顿。
  const trunc = hardTruncate(body);
  const effectiveBody = showAll ? body : trunc.preview;

  const kind = detectKind(contentType, effectiveBody);
  const size = byteSize(effectiveBody);
  const lineCount = effectiveBody.split('\n').length;
  const isLong = collapsible && (lineCount > COLLAPSE_LINES || size > COLLAPSE_BYTES);
  const searching = search.trim() !== '';

  const copyText = () => {
    const text = kind === 'json' ? tryPrettyJson(effectiveBody) || effectiveBody : effectiveBody;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([body], { type: contentType || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `response.${kind === 'json' ? 'json' : 'txt'}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const header = (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-y-2">
      <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-slate-400">
        {kind}
      </span>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span>{formatSize(size)}</span>
        {(kind === 'json' || kind === 'text') && (
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索内容"
              className="w-32 rounded-md border border-slate-700/50 bg-slate-800/40 py-1 pl-7 pr-2 text-[11px] text-slate-200 outline-none focus:border-brand/60"
            />
          </div>
        )}
        {kind === 'json' && !searching && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setTreeExpandAll(true);
                setTreeKey((k) => k + 1);
              }}
              className="text-slate-400 transition hover:text-slate-200 cursor-pointer"
              title="展开所有层级"
            >
              展开全部
            </button>
            <button
              onClick={() => {
                setTreeExpandAll(false);
                setTreeKey((k) => k + 1);
              }}
              className="text-slate-400 transition hover:text-slate-200 cursor-pointer"
              title="折叠到默认层级"
            >
              折叠全部
            </button>
          </div>
        )}
        {kind === 'json' && (
          <button
            onClick={() => setRaw((v) => !v)}
            className="flex items-center gap-1 text-slate-400 transition hover:text-slate-200 cursor-pointer"
            title={raw ? '切换为折叠树' : '切换为原始文本'}
          >
            {raw ? <ListTree size={12} /> : <Code2 size={12} />}
            {raw ? '树视图' : '原始'}
          </button>
        )}
        {isLong && !searching && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-slate-400 transition hover:text-slate-200 cursor-pointer"
          >
            {expanded ? (
              <>
                <ChevronUp size={12} /> 收起
              </>
            ) : (
              <>
                <ChevronDown size={12} /> 展开
              </>
            )}
          </button>
        )}
        <button
          onClick={download}
          className="flex items-center gap-1 text-slate-400 transition hover:text-slate-200 cursor-pointer"
          title="下载响应体"
        >
          <Download size={12} /> 下载
        </button>
        <button
          onClick={copyText}
          className="flex items-center gap-1 text-slate-400 transition hover:text-slate-200 cursor-pointer"
        >
          {copied ? (
            <>
              <Check size={12} /> 已复制
            </>
          ) : (
            <>
              <Copy size={12} /> 复制
            </>
          )}
        </button>
      </div>
    </div>
  );

  let content: React.ReactNode;
  if (kind === 'form') {
    content = <KVTable data={parseFormUrlEncoded(effectiveBody)} />;
  } else if (kind === 'json' && !raw && !searching) {
    const parsed = parseJsonSafe(effectiveBody);
    content = parsed !== null ? (
      <div className="overflow-x-auto rounded-lg border border-slate-700/40 bg-slate-900/60 p-4">
        <JsonTree key={treeKey} data={parsed} expandAll={treeExpandAll} />
      </div>
    ) : (
      <pre
        onClick={selectPreOnClick}
        className="overflow-x-auto rounded-lg border border-slate-700/40 bg-slate-900/60 p-4 text-[12.5px] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(tryPrettyJson(effectiveBody) || effectiveBody) }}
      />
    );
  } else {
    const display = kind === 'json' ? tryPrettyJson(effectiveBody) || effectiveBody : effectiveBody;
    content = (
      <pre
        onClick={selectPreOnClick}
        className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-slate-700/40 bg-slate-900/60 p-4 text-[12.5px] leading-relaxed text-slate-300"
      >
        {highlight(display, search)}
      </pre>
    );
  }

  const truncatedNote = trunc.truncated && !showAll && (
    <div className="mb-1.5 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
      <span>
        响应过大，已截断显示前 {formatSize(trunc.preview.length)}（共 {formatSize(body.length)}），剩余 {trunc.restChars.toLocaleString()} 字符未渲染。
      </span>
      <button
        onClick={() => setShowAll(true)}
        className="ml-auto shrink-0 rounded bg-amber-500/20 px-2 py-0.5 text-amber-200 transition hover:bg-amber-500/30 cursor-pointer"
      >
        展开全部
      </button>
    </div>
  );

  if (!isLong || expanded || searching) {
    return (
      <div>
        {header}
        {truncatedNote}
        {content}
      </div>
    );
  }

  return (
    <div>
      {header}
      {truncatedNote}
      <div className="relative max-h-[320px] overflow-hidden">
        {content}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t from-slate-900 to-transparent pb-2">
          <button
            onClick={() => setExpanded(true)}
            className="pointer-events-auto rounded-md bg-slate-800/90 px-3 py-1 text-[11px] text-slate-300 shadow-lg transition hover:text-slate-100 cursor-pointer"
          >
            展开全部（{lineCount} 行）
          </button>
        </div>
      </div>
    </div>
  );
}
