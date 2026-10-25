import { sendRequest } from '../request/sender';
import type { AiSettings } from '../../shared/types';

/**
 * AI 预处理客户端：调用任意 OpenAI 兼容的 chat/completions 接口，
 * 把用户提供的原始数据整理成结构化的批量请求参数（JSON 数组）。
 */

export const AI_PREPROCESS_SYSTEM_PROMPT =
  '你是接口调试工具中的数据预处理助手。把用户提供的原始数据整理成结构化的批量请求参数。' +
  '只输出一个 JSON 数组：数组中每个对象对应一次调用，对象的键是简短参数名（与数据字段含义一致），值统一为字符串。' +
  '不要输出任何解释文字、markdown 代码块或多余内容。';

/** 由基础地址推导 chat/completions 完整地址（容忍末尾斜杠与已带路径的写法）。 */
export function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

export async function preprocessWithAi(
  data: string,
  instruction: string,
  ai: AiSettings
): Promise<{ content: string; model: string; durationMs: number }> {
  if (!ai?.baseUrl?.trim() || !ai?.model?.trim()) {
    throw new Error('尚未配置 AI 接口：请在「设置 → AI 预处理设置」中填写接口地址与模型');
  }
  const userContent = instruction.trim()
    ? `【整理要求】${instruction.trim()}\n\n【原始数据】\n${data}`
    : `【原始数据】\n${data}`;
  const res = await sendRequest(
    {
      method: 'POST',
      url: chatCompletionsUrl(ai.baseUrl),
      headers: {
        'content-type': 'application/json',
        ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: 'system', content: AI_PREPROCESS_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
      }),
    },
    0,
    undefined,
    // AI 生成可能较慢，批量/链式默认的 30s 不够用
    120_000
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `AI 接口返回 ${res.status} ${res.statusText}：${res.body.slice(0, 200)}`
    );
  }
  let content = '';
  try {
    const json = JSON.parse(res.body);
    content = String(json?.choices?.[0]?.message?.content ?? '');
  } catch {
    throw new Error('AI 接口响应不是合法 JSON：' + res.body.slice(0, 200));
  }
  if (!content.trim()) throw new Error('AI 未返回任何内容');
  return { content, model: ai.model, durationMs: res.durationMs };
}
