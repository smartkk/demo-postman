import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

// 可按照数据结构折叠的 JSON 树视图。
// 每个对象 / 数组节点可独立展开 / 收起，收起时显示条目数量预览。

type Json = unknown;

function isContainer(v: Json): v is Record<string, Json> | Json[] {
  return v !== null && typeof v === 'object';
}

function Primitive({ value }: { value: Json }) {
  if (value === null) return <span className="json-null">null</span>;
  switch (typeof value) {
    case 'string':
      return <span className="json-string">"{String(value)}"</span>;
    case 'number':
      return <span className="json-number">{String(value)}</span>;
    case 'boolean':
      return <span className="json-boolean">{String(value)}</span>;
    default:
      return <span className="json-null">{String(value)}</span>;
  }
}

interface NodeProps {
  name?: string;
  value: Json;
  depth: number;
  isLast: boolean;
  defaultExpandDepth: number;
  expandAll: boolean;
}

function JsonNode({ name, value, depth, isLast, defaultExpandDepth, expandAll }: NodeProps) {
  // Hooks 必须先于任何早退分支无条件执行（原始值分支用不到 open，但调用顺序需一致）
  const [open, setOpen] = useState(expandAll || depth < defaultExpandDepth);

  if (!isContainer(value)) {
    return (
      <div className="json-line">
        <span className="json-toggle-spacer" />
        {name !== undefined && <span className="json-key">"{name}"</span>}
        {name !== undefined && <span className="json-punc">: </span>}
        <Primitive value={value} />
        {!isLast && <span className="json-punc">,</span>}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as Json[]).map((v, i) => ({ key: String(i), value: v }))
    : Object.entries(value as Record<string, Json>).map(([k, v]) => ({ key: k, value: v }));
  const count = entries.length;

  return (
    <div className="json-line">
      <button
        className="json-toggle"
        onClick={() => setOpen((o) => !o)}
        title={open ? '收起' : '展开'}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {name !== undefined && <span className="json-key">"{name}"</span>}
      {name !== undefined && <span className="json-punc">: </span>}
      <span className="json-punc">{isArray ? '[' : '{'}</span>
      {!open && (
        <>
          <span className="json-collapsed">
            {' '}
            {isArray ? `${count} 项` : `${count} 键`}{' '}
          </span>
          <span className="json-punc">{isArray ? ']' : '}'}</span>
          {!isLast && <span className="json-punc">,</span>}
        </>
      )}
      {open && (
        <div className="json-children">
          {entries.map((e, i) => (
            <JsonNode
              key={e.key}
              name={isArray ? undefined : e.key}
              value={e.value}
              depth={depth + 1}
              isLast={i === count - 1}
              defaultExpandDepth={defaultExpandDepth}
              expandAll={expandAll}
            />
          ))}
          <div className="json-line">
            <span className="json-toggle-spacer" />
            <span className="json-punc">{isArray ? ']' : '}'}</span>
            {!isLast && <span className="json-punc">,</span>}
          </div>
        </div>
      )}
    </div>
  );
}

interface TreeProps {
  data: Json;
  defaultExpandDepth?: number;
  expandAll?: boolean;
}

export function JsonTree({ data, defaultExpandDepth = 2, expandAll = false }: TreeProps) {
  return (
    <div className="json-tree" data-select-block>
      <JsonNode
        value={data}
        depth={0}
        isLast
        defaultExpandDepth={defaultExpandDepth}
        expandAll={expandAll}
      />
    </div>
  );
}
