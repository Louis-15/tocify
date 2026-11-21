// 网络请求层：构造鉴权头、调用 Gemini / OpenAI 兼容接口，以及连通性测试。
// 所有出站请求都集中在这里，便于统一处理超时、错误消息与供应商专属请求头。

import {
  BUILT_IN_OPENAI_COMPAT_BASE_URL,
  OPENCODE_HOSTNAME,
  OPENCODE_SESSION_ID,
  getGeminiModel,
  getOpenAiCompatTextModel,
  normalizeApiKeyForRequest,
  providerLabel,
  requireProvider,
  type DirectApiConfig,
  type OpenAiCompatProvider,
} from './providers';
import { normalizeCustomBaseUrl } from './security';

export function getOpenAiCompatBaseUrl(provider: OpenAiCompatProvider, config: { customBaseUrl?: string }): string {
  if (provider === 'custom') {
    return normalizeCustomBaseUrl(config.customBaseUrl);
  }

  // 内置提供商（含预设的 opencode）一律使用代码里的固定地址，
  // 完全忽略前端传来的 customBaseUrl，保证预设地址不可被改写。
  return BUILT_IN_OPENAI_COMPAT_BASE_URL[provider];
}

export async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    return data?.error?.message || data?.error?.details || data?.message || data?.msg || fallback;
  } catch {
    return fallback;
  }
}

// 构造 OpenAI 兼容请求头。抽成独立函数，让正式请求与连通性测试共用同一套鉴权逻辑，
// 避免以后新增提供商专属请求头时两处不一致。
export function buildOpenAiCompatHeaders(baseUrl: string, requestApiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ requestApiKey }`,
  };

  // OpenCode 的接口强制要求稳定的会话标识，缺失会返回 400 MissingSessionID。
  // hostname 由 URL 解析器统一小写化，因此大小写混写也能正确命中。
  if (new URL(baseUrl).hostname === OPENCODE_HOSTNAME) {
    headers['x-opencode-session'] = OPENCODE_SESSION_ID;
  }

  return headers;
}

export async function fetchGeminiJson(
  model: string,
  apiKey: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
): Promise<string> {
  const requestApiKey = normalizeApiKeyForRequest(apiKey);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${ encodeURIComponent(model) }:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': requestApiKey,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, fallbackMessage));
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function fetchOpenAiCompatJson(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
): Promise<string> {
  const requestApiKey = normalizeApiKeyForRequest(apiKey);
  const response = await fetch(`${ baseUrl }/chat/completions`, {
    method: 'POST',
    headers: buildOpenAiCompatHeaders(baseUrl, requestApiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, fallbackMessage));
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '[]';
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

/**
 * 测试当前配置能否真正打通供应商：发送一次极小的真实请求（输出上限 1 token），
 * 因此它不仅验证网络与鉴权，也能发现模型名 / Endpoint ID 填错的问题。
 * 失败时把上游返回的错误消息原样带回，方便用户直接排错。
 * 该函数不抛异常，统一用 { ok } 表达结果，便于服务端路由直接透传。
 */
export async function testProviderConnection(config: DirectApiConfig): Promise<ConnectionTestResult> {
  const provider = requireProvider(config.provider);
  const startedAt = Date.now();

  try {
    const requestApiKey = normalizeApiKeyForRequest(config.apiKey);

    if (provider === 'gemini') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${ encodeURIComponent(getGeminiModel(config)) }:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': requestApiKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            generationConfig: { maxOutputTokens: 1 },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, `${ providerLabel(provider) } connection test failed.`));
      }
    } else {
      const baseUrl = getOpenAiCompatBaseUrl(provider, config);
      const response = await fetch(`${ baseUrl }/chat/completions`, {
        method: 'POST',
        headers: buildOpenAiCompatHeaders(baseUrl, requestApiKey),
        body: JSON.stringify({
          model: getOpenAiCompatTextModel(provider, config),
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, `${ providerLabel(provider) } connection test failed.`));
      }
    }

    return {
      ok: true,
      message: `${ providerLabel(provider) } connection OK.`,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Connection test failed.',
      latencyMs: Date.now() - startedAt,
    };
  }
}
