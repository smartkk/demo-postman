import { useState } from 'react';
import { Copy, ServerCrash, Pencil, Check, X, Send, Trash2, Folder, Star, Ban } from 'lucide-react';
import type { CaptureInput, InterfaceRecord, ResponseRecord } from '../../../shared/types';
import { methodColor, relTime } from './method';
import { api } from '../api/client';
import { KeyValueEditor } from './KeyValueEditor';
import { KVTable } from './KVTable';
import { BodyView } from './BodyView';
import { ConfirmDialog } from './ConfirmDialog';
import { tryPrettyJson, buildCurl, detectKind, parseFormUrlEncoded } from '../lib/format';

interface Props {
  record: InterfaceRecord | null;
  store: ReturnType<typeof import('../store/useInterfaces').useInterfaces>;
}

type Tab = 'headers' | 'query' | 'params' | 'body' | 'response';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

function copy(text: string) {
  navigator.clipboard?.writeText(text);
}

function statusColor(status: number): string {
  if (status === 0) return 'text-rose-400';
  if (status >= 200 && status < 300) return 'text-emerald-300';
  if (status >= 300 && status < 400) return 'text-amber-300';
  if (status >= 400) return 'text-rose-400';
  return 'text-slate-300';
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800/60">
        <ServerCrash size={26} className="text-slate-500" />
      </div>
      <h3 className="mb-2 text-[15px] font-medium text-slate-300">
        还没有选中的接口
      </h3>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-slate-500">
        开启顶部「代理」后，将浏览器或系统的 HTTP 代理指向
        <span className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-brand-light">
          127.0.0.1:8899
        </span>
        ，经过的请求会被自动记录。同一接口只会保留一条记录，并始终更新为最新参数。
      </p>
    </div>
  );
}

export function DetailPanel({ record, store }: Props) {
  const [tab, setTab] = useState<Tab>('headers');
  const [editing, setEditing] = useState(false);
  const [editMethod, setEditMethod] = useState('GET');
  const [editUrl, setEditUrl] = useState('');
  const [editHeaders, setEditHeaders] = useState<Record<string, string>>({});
  const [editQuery, setEditQuery] = useState<Record<string, string>>({});
  const [editBody, setEditBody] = useState('');
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [curlCopied, setCurlCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'basic'>('none');
  const [authToken, setAuthToken] = useState('');
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');

  if (!record) {
    if (editing) setEditing(false);
    return <main className="flex flex-1 bg-[#0F172A]"><EmptyState /></main>;
  }

  const fullUrlOf = (r: InterfaceRecord) =>
    r.url +
    (Object.keys(r.query).length
      ? '?' + new URLSearchParams(r.query).toString()
      : '');

  const startEdit = () => {
    setEditMethod(record.method);
    setEditUrl(fullUrlOf(record));
    setEditHeaders(record.headers);
    setEditQuery(record.query);
    setEditBody(record.body ?? '');
    setEditName(record.name || record.path);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editUrl.trim()) return;
    setSaving(true);
    try {
      const u = new URL(editUrl.trim());
      for (const [k, v] of Object.entries(editQuery)) {
        if (!u.searchParams.has(k)) u.searchParams.set(k, v);
      }
      const input: CaptureInput = {
        method: editMethod,
        url: u.toString(),
        headers: editHeaders,
        body: editBody.trim() ? editBody : null,
        contentType: editHeaders['content-type'] || null,
      };
      await api.update(record.id, input);
      const newName = editName.trim();
      if (newName && newName !== (record.name || record.path)) {
        await store.rename(record.id, newName);
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    setDuplicating(true);
    try {
      await store.duplicate(record.id);
    } finally {
      setDuplicating(false);
    }
  };

  const doDelete = async () => {
    await store.deleteOne(record.id);
    setConfirmDelete(false);
  };

  const send = async () => {
    const input: CaptureInput = editing
      ? (() => {
          const u = new URL(editUrl.trim());
          for (const [k, v] of Object.entries(editQuery)) {
            if (!u.searchParams.has(k)) u.searchParams.set(k, v);
          }
          return {
            method: editMethod,
            url: u.toString(),
            headers: editHeaders,
            body: editBody.trim() ? editBody : null,
            contentType: editHeaders['content-type'] || null,
          } as CaptureInput;
        })()
      : {
          method: record.method,
          url: fullUrlOf(record),
          headers: record.headers,
          body: record.body,
          contentType: record.contentType,
        };
    setSending(true);
    setSendError('');
    try {
      await api.sendRequest(record.id, input);
      if (editing) setEditing(false);
      setHistoryIdx(null);
      setTab('response');
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const cancel = async () => {
    await api.cancelRequest(record.id);
    setSending(false);
    setSendError('请求已取消');
  };

  const copyCurl = () => {
    const curl = buildCurl({
      method: record.method,
      url: fullUrlOf(record),
      headers: record.headers,
      query: record.query,
      body: record.body,
      contentType: record.contentType,
    });
    navigator.clipboard?.writeText(curl);
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 1500);
  };

  const fullUrl = fullUrlOf(record);
  const history: ResponseRecord[] =
    record.responses && record.responses.length
      ? record.responses
      : record.lastResponse
        ? [record.lastResponse]
        : [];
  const activeIdx =
    historyIdx != null && historyIdx < history.length
      ? historyIdx
      : history.length - 1;
  const displayResponse: ResponseRecord | null = history[activeIdx] ?? null;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'headers', label: `Headers (${Object.keys(record.headers).length})` },
    { key: 'query', label: `Query (${Object.keys(record.query).length})` },
    { key: 'params', label: '参数' },
    { key: 'body', label: 'Body' },
    { key: 'response', label: '响应' },
  ];

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-[#0F172A]">
      <div className="border-b border-slate-700/40 px-5 py-4">
        {editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <select
                value={editMethod}
                onChange={(e) => setEditMethod(e.target.value)}
                className="rounded-md border border-slate-700/50 bg-slate-800/40 px-2 py-1.5 text-[13px] outline-none focus:border-brand/60"
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder="https://api.example.com/users"
                className="min-w-0 flex-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-1.5 text-[13px] outline-none focus:border-brand/60"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={sending ? cancel : send}
                disabled={!sending && !editUrl.trim()}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition cursor-pointer ${
                  sending
                    ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40'
                }`}
              >
                {sending ? (
                  <>
                    <Ban size={13} /> 取消
                  </>
                ) : (
                  <>
                    <Send size={13} /> 发送
                  </>
                )}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] text-slate-300 transition hover:bg-slate-700/50 cursor-pointer"
              >
                <X size={13} /> 取消
              </button>
              <button
                onClick={saveEdit}
                disabled={!editUrl.trim() || saving}
                className="flex items-center gap-1 rounded-lg bg-gradient-to-br from-brand to-brand-light px-3 py-1.5 text-[12.5px] font-medium text-white shadow-lg shadow-brand/30 transition hover:brightness-110 disabled:opacity-40 cursor-pointer"
              >
                <Check size={13} /> 保存修改
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <span
              className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${methodColor(
                record.method
              )}`}
            >
              {record.method}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-100">
              {fullUrl}
            </span>
            <button
              onClick={sending ? cancel : send}
              disabled={false}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                sending
                  ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
              }`}
            >
              {sending ? (
                <>
                  <Ban size={12} /> 取消
                </>
              ) : (
                <>
                  <Send size={12} /> 发送
                </>
              )}
            </button>
            <button
              onClick={() => copy(fullUrl)}
              className="flex items-center gap-1 rounded-md bg-slate-800/50 px-2 py-1 text-[11px] text-slate-400 transition hover:text-slate-200 cursor-pointer"
            >
              <Copy size={12} /> 复制
            </button>
            <button
              onClick={copyCurl}
              className="flex items-center gap-1 rounded-md bg-slate-800/50 px-2 py-1 text-[11px] text-slate-400 transition hover:text-slate-200 cursor-pointer"
            >
              {curlCopied ? <Check size={12} /> : <Copy size={12} />}
              {curlCopied ? '已复制' : 'cURL'}
            </button>
            <button
              onClick={startEdit}
              className="flex items-center gap-1 rounded-md bg-slate-800/50 px-2 py-1 text-[11px] text-slate-400 transition hover:text-slate-200 cursor-pointer"
            >
              <Pencil size={12} /> 编辑
            </button>
            <button
              onClick={() => store.togglePin(record.id)}
              title={record.pinned ? '取消收藏' : '收藏置顶'}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition cursor-pointer ${
                record.pinned
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Star size={12} fill={record.pinned ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={duplicate}
              disabled={duplicating}
              title="复制接口"
              className="flex items-center gap-1 rounded-md bg-slate-800/50 px-2 py-1 text-[11px] text-slate-400 transition hover:text-slate-200 disabled:opacity-40 cursor-pointer"
            >
              <Copy size={12} /> 复制
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              title="删除接口"
              className="flex items-center gap-1 rounded-md bg-slate-800/50 px-2 py-1 text-[11px] text-rose-400/80 transition hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer"
            >
              <Trash2 size={12} /> 删除
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <Folder size={13} className="text-slate-500" />
            <select
              value={record.folder || ''}
              onChange={(e) => store.moveFolder(record.id, e.target.value)}
              className="rounded-md border border-slate-700/50 bg-slate-800/40 px-2 py-1 text-[11.5px] text-slate-300 outline-none focus:border-brand/60 cursor-pointer"
            >
              <option value="">未分组</option>
              {store.folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                record.source === 'manual'
                  ? 'bg-brand/15 text-brand-light'
                  : 'bg-slate-700/50 text-slate-400'
              }`}
            >
              {record.source === 'manual' ? '手动创建' : '浏览器抓取'}
            </span>
          </div>
          </div>
        )}
      </div>

      {editing ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <Section title="名称（可选，留空则用路径）">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={record.path}
              className="w-full rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-[12.5px] outline-none focus:border-brand/60"
            />
          </Section>
          <Section title="Headers">
            <KeyValueEditor value={editHeaders} onChange={setEditHeaders} />
          </Section>
          <Section title="Query 参数">
            <KeyValueEditor
              value={editQuery}
              onChange={setEditQuery}
              placeholderKey="param"
            />
          </Section>
          <Section
            title="Body"
            action={
              <button
                onClick={() => {
                  const p = tryPrettyJson(editBody);
                  if (p) setEditBody(p);
                }}
                className="rounded-md bg-slate-800/50 px-2 py-0.5 text-[11px] text-slate-400 transition hover:text-slate-200 cursor-pointer"
              >
                格式化 JSON
              </button>
            }
          >
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={6}
              placeholder='{
  "key": "value"
}'
              className="w-full resize-none rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-brand/60"
            />
          </Section>
          <Section title="鉴权（自动写入 Authorization 头）">
            <div className="space-y-2">
              <select
                value={authType}
                onChange={(e) => {
                  const t = e.target.value as typeof authType;
                  setAuthType(t);
                  if (t === 'none') {
                    const h = { ...editHeaders };
                    delete h['authorization'];
                    setEditHeaders(h);
                  }
                }}
                className="w-full rounded-md border border-slate-700/50 bg-slate-800/40 px-2 py-1.5 text-[12.5px] outline-none focus:border-brand/60 cursor-pointer"
              >
                <option value="none">无</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
              </select>
              {authType === 'bearer' && (
                <input
                  value={authToken}
                  onChange={(e) => {
                    setAuthToken(e.target.value);
                    setEditHeaders((h) => ({
                      ...h,
                      authorization: `Bearer ${e.target.value}`,
                    }));
                  }}
                  placeholder="粘贴 token"
                  className="w-full rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-brand/60"
                />
              )}
              {authType === 'basic' && (
                <div className="flex gap-2">
                  <input
                    value={authUser}
                    onChange={(e) => {
                      setAuthUser(e.target.value);
                      setEditHeaders((h) => ({
                        ...h,
                        authorization:
                          'Basic ' +
                          btoa(`${e.target.value}:${authPass}`),
                      }));
                    }}
                    placeholder="用户名"
                    className="flex-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-[12.5px] outline-none focus:border-brand/60"
                  />
                  <input
                    value={authPass}
                    type="password"
                    onChange={(e) => {
                      setAuthPass(e.target.value);
                      setEditHeaders((h) => ({
                        ...h,
                        authorization:
                          'Basic ' +
                          btoa(`${authUser}:${e.target.value}`),
                      }));
                    }}
                    placeholder="密码"
                    className="flex-1 rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-[12.5px] outline-none focus:border-brand/60"
                  />
                </div>
              )}
            </div>
          </Section>
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-slate-700/40 px-5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative px-3 py-2 text-[12.5px] font-medium transition cursor-pointer ${
                  tab === t.key ? 'text-brand-light' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
                {tab === t.key && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-brand" />
                )}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {tab === 'headers' && <KVTable data={record.headers} />}
            {tab === 'query' && <KVTable data={record.query} />}
            {tab === 'params' && <ParamsView record={record} />}
            {tab === 'body' && (
              <BodyView
                body={record.body}
                contentType={record.contentType}
                emptyHint="该请求无 Body"
              />
            )}
            {tab === 'response' && (
              <>
                {history.length > 1 && (
                  <div className="mb-3 flex items-center gap-2 text-[11.5px] text-slate-500">
                    <span>历史响应</span>
                    <select
                      value={activeIdx}
                      onChange={(e) => setHistoryIdx(Number(e.target.value))}
                      className="rounded-md border border-slate-700/50 bg-slate-800/40 px-2 py-1 text-[11.5px] text-slate-300 outline-none focus:border-brand/60 cursor-pointer"
                    >
                      {history
                        .map((r, i) => ({ r, i }))
                        .reverse()
                        .map(({ r, i }) => (
                          <option key={i} value={i}>
                            #{history.length - i} · {r.status || '失败'} ·{' '}
                            {relTime(r.at)}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <ResponseView response={displayResponse} error={sendError} />
              </>
            )}
          </div>
        </>
      )}

      <div className="grid grid-cols-3 gap-3 border-t border-slate-700/40 px-5 py-3 text-[11.5px]">
        <Stat label="调用次数" value={String(record.callCount)} />
        <Stat label="创建时间" value={relTime(record.createdAt)} />
        <Stat label="最近更新" value={relTime(record.lastUpdated)} />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="删除接口"
        message={`确认删除接口「${record.name || record.path}」？该操作不可撤销。${
          record.source === 'manual'
            ? '（手动创建的接口删除前需二次确认）'
            : ''
        }`}
        confirmText="删除"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </main>
  );
}

function ParamsView({ record }: { record: InterfaceRecord }) {
  const rows: { src: string; k: string; v: string }[] = [];
  for (const [k, v] of Object.entries(record.query)) {
    rows.push({ src: 'Query', k, v });
  }
  if (record.body && detectKind(record.contentType, record.body) === 'form') {
    for (const [k, v] of Object.entries(parseFormUrlEncoded(record.body))) {
      rows.push({ src: 'Body', k, v });
    }
  }
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-[12px] text-slate-600">
        无参数（Query 与表单 Body 均为空）
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700/40">
      {rows.map((r, i) => (
        <div
          key={i}
          className={`flex gap-3 px-3 py-2 text-[12.5px] ${
            i % 2 ? 'bg-slate-800/30' : 'bg-transparent'
          }`}
        >
          <span className="w-14 shrink-0 self-center rounded bg-slate-800/60 px-1.5 py-0.5 text-center text-[10.5px] text-slate-400">
            {r.src}
          </span>
          <span className="w-1/3 shrink-0 break-all font-medium text-brand-light">
            {r.k}
          </span>
          <span className="min-w-0 flex-1 break-all text-slate-300">{r.v}</span>
        </div>
      ))}
    </div>
  );
}

function ResponseView({ response, error }: { response: ResponseRecord | null; error: string }) {
  if (error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-[12.5px] text-rose-300">
        发送失败：{error}
      </div>
    );
  }
  if (!response) {
    return (
      <div className="py-8 text-center text-[12px] text-slate-600">
        尚未发送请求，点击右上角「发送」按钮即可发送并查看结果
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
        <span className={`font-semibold ${statusColor(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="text-slate-500">{response.durationMs} ms</span>
        <span className="text-slate-500">{relTime(response.at)}</span>
        {response.source && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              response.source === 'manual'
                ? 'bg-brand/15 text-brand-light'
                : 'bg-slate-700/50 text-slate-300'
            }`}
          >
            {response.source === 'manual' ? '手动发送' : '浏览器抓取'}
          </span>
        )}
      </div>
      <Section title="响应 Headers">
        <KVTable data={response.headers} />
      </Section>
      <Section title="响应 Body">
        <BodyView
          body={response.body}
          contentType={response.headers['content-type']}
          emptyHint="(空)"
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-medium text-slate-400">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/40 px-3 py-2">
      <div className="text-[10.5px] text-slate-500">{label}</div>
      <div className="mt-0.5 truncate font-medium text-slate-200">{value}</div>
    </div>
  );
}
