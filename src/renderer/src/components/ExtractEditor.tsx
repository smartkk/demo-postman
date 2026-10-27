import { useState } from 'react';
import { Plus, Trash2, Eye } from 'lucide-react';

/**
 * JSONPath 提取规则编辑器（ChainPanel 单步配置场景）。
 * 支持「输出变量名 → JSON 路径」配对编辑，并可粘贴示例响应实时验证路径解析结果
 * （解析逻辑与主进程 getPath 一致，支持数组下标）。
 */
export function ExtractEditor({
  value,
  onChange,
  stepName,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  stepName: string;
}) {
  const [sample, setSample] = useState('');
  const entries = Object.entries(value);
  const setAt = (i: number, outKey: string, jsonPath: string) => {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], idx) => {
      if (idx === i) next[outKey] = jsonPath;
      else next[k] = v;
    });
    onChange(next);
  };
  const add = () => onChange({ ...value, '': '' });
  const remove = (k: string) => {
    const next = { ...value };
    delete next[k];
    onChange(next);
  };

  // 预览：用示例响应实时解析每条路径（与主进程 getPath 逻辑一致，支持数组下标）
  const tryParse = (() => {
    try {
      return sample.trim() ? JSON.parse(sample) : undefined;
    } catch {
      return null; // 解析失败标记
    }
  })();
  const resolvePath = (obj: unknown, path: string): string | undefined => {
    const tokens = path.match(/[^.[\]]+|\[\d+\]/g);
    if (!tokens) return undefined;
    let cur: unknown = obj;
    for (const raw of tokens) {
      if (cur == null) return undefined;
      if (raw.startsWith('[')) {
        const idx = parseInt(raw.slice(1, -1), 10);
        if (!Array.isArray(cur) || idx < 0 || idx >= cur.length) return undefined;
        cur = cur[idx];
      } else {
        cur = (cur as Record<string, unknown>)[raw];
      }
    }
    if (cur == null) return undefined;
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
  };

  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={k}
            onChange={(e) => setAt(i, e.target.value, v)}
            placeholder="输出变量名"
            className="w-[35%] rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand/60"
          />
          <span className="text-slate-500">→</span>
          <input
            value={v}
            onChange={(e) => setAt(i, k, e.target.value)}
            placeholder="JSON 路径，如 data.token 或 page.data.records[0].id"
            className="flex-1 rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand/60"
          />
          <button
            onClick={() => remove(k)}
            className="text-slate-500 transition hover:text-rose-400 cursor-pointer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="text-[10.5px] text-slate-500">
        提取后在后续步骤用{' '}
        <code className="text-brand-light">
          {'{{' + (stepName?.trim() || '本步骤名') + '.变量名}}'}
        </code>{' '}
        引用
      </div>

      {/* 提取预览：粘贴示例响应实时验证路径 */}
      <div className="rounded-lg border border-slate-700/40 bg-slate-900/30 p-2">
        <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-400">
          <Eye size={12} /> 提取预览（粘贴示例响应 JSON 实时验证）
        </div>
        <textarea
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder={'{\n  "page": { "data": { "records": [ { "id": "abc" } ] } }\n}'}
          spellCheck={false}
          rows={4}
          className="w-full resize-y rounded border border-slate-700/50 bg-slate-800/40 p-2 font-mono text-[11px] outline-none focus:border-brand/60"
        />
        {sample.trim() !== '' && (
          <div className="mt-1.5 space-y-1">
            {tryParse === null ? (
              <div className="text-[11px] text-rose-400">示例响应不是合法 JSON</div>
            ) : entries.length === 0 ? (
              <div className="text-[11px] text-slate-500">先添加提取规则</div>
            ) : (
              entries.map(([k, v]) => {
                const p = k.trim() || '(未命名)';
                const res = v.trim() ? resolvePath(tryParse, v.trim()) : undefined;
                return (
                  <div key={k} className="flex items-start gap-1.5 text-[11px]">
                    <span className="shrink-0 font-mono text-brand-light">{'{{' + stepName + '.' + p + '}}'}</span>
                    <span className="text-slate-500">=</span>
                    {res === undefined ? (
                      <span className="text-amber-400/80">路径未匹配：{v}</span>
                    ) : (
                      <span className="min-w-0 flex-1 break-all font-mono text-emerald-300">{res}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <button
        onClick={add}
        className="flex items-center gap-1 text-[11px] text-slate-400 transition hover:text-slate-200 cursor-pointer"
      >
        <Plus size={12} /> 添加提取
      </button>
    </div>
  );
}
