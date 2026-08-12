import { useState } from 'react';
import { X, ChevronDown, ChevronUp, Code2 } from 'lucide-react';
import type { CaptureInput } from '../../../shared/types';
import { parseCurl } from '../../../shared/curl';
import { KeyValueEditor } from './KeyValueEditor';

interface Props {
  onClose: () => void;
  onSubmit: (input: CaptureInput) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

export function ManualEntry({ onClose, onSubmit }: Props) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [query, setQuery] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');

  const [showCurl, setShowCurl] = useState(false);
  const [curlText, setCurlText] = useState('');
  const [curlError, setCurlError] = useState('');
  const [urlError, setUrlError] = useState('');

  // 实时校验 URL 合法性，避免在 submit 中 new URL() 抛错导致崩溃。
  const handleUrl = (text: string) => {
    setUrl(text);
    if (!text.trim()) {
      setUrlError('');
      return;
    }
    try {
      new URL(text.trim());
      setUrlError('');
    } catch {
      setUrlError('URL 格式不正确（需包含 http:// 或 https://）');
    }
  };

  const applyCurl = (direct: boolean) => {
    const text = curlText.trim();
    if (!text) {
      setCurlError('请粘贴 curl 命令');
      return;
    }
    try {
      const parsed = parseCurl(text);
      if (!parsed.url) {
        setCurlError('未能从命令中解析出 URL');
        return;
      }
      if (!direct) {
        setMethod(parsed.method);
        setUrl(parsed.url);
        setHeaders(parsed.headers);
        setQuery(parsed.query);
        setBody(parsed.body ?? '');
        setCurlError('');
        setShowCurl(false);
        return;
      }
      // 直接保存：合并 query 到 URL 后提交
      const u = new URL(parsed.url);
      for (const [k, v] of Object.entries(parsed.query)) {
        if (!u.searchParams.has(k)) u.searchParams.set(k, v);
      }
      onSubmit({
        method: parsed.method,
        url: u.toString(),
        headers: parsed.headers,
        body: parsed.body ? parsed.body : null,
        contentType: parsed.headers['content-type'] || null,
      });
    } catch (e) {
      setCurlError('解析失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const submit = () => {
    const text = url.trim();
    if (!text) return;
    let u: URL;
    try {
      u = new URL(text);
    } catch {
      setUrlError('URL 格式不正确（需包含 http:// 或 https://）');
      return;
    }
    for (const [k, v] of Object.entries(query)) {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    onSubmit({
      method,
      url: u.toString(),
      headers,
      body: body.trim() ? body : null,
      contentType: headers['content-type'] || null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="glass w-full max-w-lg rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-slate-100">手动录入接口</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          {/* 从 curl 导入 */}
          <div className="rounded-xl border border-slate-700/40 bg-slate-800/30">
            <button
              onClick={() => setShowCurl((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-[13px] text-slate-200 transition hover:bg-slate-700/30 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Code2 size={15} className="text-brand-light" /> 从 curl 导入
              </span>
              {showCurl ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {showCurl && (
              <div className="space-y-2 px-3 pb-3">
                <textarea
                  value={curlText}
                  onChange={(e) => setCurlText(e.target.value)}
                  rows={4}
                  placeholder={'curl -X POST https://api.example.com/users \\\n  -H "Content-Type: application/json" \\\n  -d \'{"name":"demo"}\''}
                  className="w-full resize-none rounded-md border border-slate-700/50 bg-slate-900/60 px-3 py-2 font-mono text-[12px] outline-none focus:border-brand/60"
                />
                {curlError && <div className="text-[12px] text-rose-400">{curlError}</div>}
                <div className="flex gap-2">
                  <button
                    onClick={() => applyCurl(false)}
                    className="rounded-lg bg-brand/20 px-3 py-1.5 text-[12.5px] font-medium text-brand-light transition hover:bg-brand/30 cursor-pointer"
                  >
                    解析并填充
                  </button>
                  <button
                    onClick={() => applyCurl(true)}
                    className="rounded-lg bg-gradient-to-br from-brand to-brand-light px-3 py-1.5 text-[12.5px] font-medium text-white shadow-lg shadow-brand/30 transition hover:brightness-110 cursor-pointer"
                  >
                    解析并直接保存
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-md border border-slate-700/50 bg-slate-800/40 px-2.5 py-2 text-[13px] outline-none focus:border-brand/60"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              value={url}
              onChange={(e) => handleUrl(e.target.value)}
              placeholder="https://api.example.com/users"
              className={
                'min-w-0 flex-1 rounded-md border bg-slate-800/40 px-3 py-2 text-[13px] outline-none ' +
                (urlError
                  ? 'border-rose-500/60 focus:border-rose-500'
                  : 'border-slate-700/50 focus:border-brand/60')
              }
            />
          </div>
          {urlError && <div className="text-[12px] text-rose-400">{urlError}</div>}

          <Section title="Headers">
            <KeyValueEditor value={headers} onChange={setHeaders} />
          </Section>
          <Section title="Query 参数">
            <KeyValueEditor
              value={query}
              onChange={setQuery}
              placeholderKey="param"
            />
          </Section>
          <Section title="Body">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder='{
  "key": "value"
}'
              className="w-full resize-none rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-brand/60"
            />
          </Section>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[13px] text-slate-300 transition hover:bg-slate-700/50 cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!url.trim() || !!urlError}
            className="rounded-lg bg-gradient-to-br from-brand to-brand-light px-4 py-2 text-[13px] font-medium text-white shadow-lg shadow-brand/30 transition hover:brightness-110 disabled:opacity-40 cursor-pointer"
          >
            保存（自动去重）
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-slate-400">{title}</div>
      {children}
    </div>
  );
}
