import { env } from '$env/dynamic/private';
import { lookup } from 'node:dns/promises';

import {
  generateBoard,
  isBlockedIpAddress,
  normalizeCustomBaseUrl,
  requiresUserApiKeyForModel,
  normalizeModelOverrides,
  normalizeProvider,
  processToc,
  testProviderConnection,
  validateCustomProviderConfig,
  type ConnectionTestResult,
  type GraphNodeInput,
  type ModelOverrides,
  type Provider,
} from '$lib/llm/core';

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function determineProvider(request: Request, userProvider?: string): Provider {
  const normalizedUserProvider = normalizeProvider(userProvider);
  if (normalizedUserProvider) {
    return normalizedUserProvider;
  }

  const envProvider = normalizeProvider(env.AI_PROVIDER);
  if (envProvider) {
    return envProvider;
  }

  return randomChoice(['gemini', 'qwen', 'doubao', 'zhipu']);
}

function resolveApiKey(provider: Provider, userKey?: string): string {
  if (userKey) {
    return userKey;
  }

  switch (provider) {
    case 'gemini':
      return env.GOOGLE_API_KEY || '';
    case 'qwen':
      return env.DASHSCOPE_API_KEY || '';
    case 'zhipu':
      return env.ZHIPU_API_KEY || '';
    case 'doubao':
      return env.DOUBAO_API_KEY || '';
    case 'opencode':
      // OpenCode Go 不提供公共/环境变量默认 key，必须由用户填写自己的 key，
      // 这里返回空串，让调用方走统一的 “API Key is missing” 流程。
      return '';
    case 'commandcode':
      // Command Code 同样需要用户自备 key（与 CLI 共用同一个 key）。
      return '';
    case 'custom':
      return '';
  }
}

function providerLabel(provider: Provider): string {
  // 与 core.ts 保持一致：OpenCode 的官方写法不是首字母大写。
  if (provider === 'opencode') {
    return 'OpenCode Go';
  }

  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function createBadRequest(message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  return error;
}

// 缺少 API Key 时的提示语：OpenCode Go 是内置预设供应商（Base URL 固定），
// 但它没有服务端共享 key，所以提示语要与“自定义模型”区分开，避免用户误解。
function userApiKeyRequiredMessage(provider: Provider): string {
  if (provider === 'opencode') {
    return 'OpenCode Go requires your own API key.';
  }

  if (provider === 'commandcode') {
    return 'Command Code requires your own API key.';
  }

  return 'Custom models outside the built-in list require your own API key.';
}

async function assertCustomBaseUrlResolvesSafely(customBaseUrl?: string) {
  const baseUrl = normalizeCustomBaseUrl(customBaseUrl);
  const hostname = new URL(baseUrl).hostname.replace(/^\[(.*)\]$/, '$1');

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });

    if (addresses.some(({ address }) => isBlockedIpAddress(address))) {
      throw createBadRequest('Custom base URL resolves to a private network address.');
    }
  } catch (err: any) {
    if (err?.status) {
      throw err;
    }

    throw createBadRequest('Unable to validate custom base URL host.');
  }
}

async function validateCustomProviderOnServer(
  provider: Provider,
  apiKey: string | undefined,
  customBaseUrl: string | undefined,
  modelOverrides: ModelOverrides | undefined,
) {
  if (provider !== 'custom') {
    return;
  }

  try {
    validateCustomProviderConfig({
      apiKey,
      customBaseUrl,
      modelOverrides,
    });
  } catch (err: any) {
    throw createBadRequest(err?.message || 'Invalid custom provider configuration.');
  }

  await assertCustomBaseUrlResolvesSafely(customBaseUrl);
}

/**
 * 服务端执行“测试连通性”：复用与正式请求完全相同的供应商解析、key 解析和
 * 自定义 URL 安全校验，避免测试通道绕过 SSRF 防护。
 * 与正式请求不同，这里必须显式选择供应商（不使用 determineProvider 的随机兜底）。
 */
export async function testProviderConnectionOnServer({
  provider,
  apiKey,
  customBaseUrl,
  doubaoEndpointIdText,
  doubaoEndpointIdVision,
  modelOverrides,
}: {
  provider?: string;
  apiKey?: string;
  customBaseUrl?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
  modelOverrides?: ModelOverrides;
}): Promise<ConnectionTestResult> {
  const resolvedProvider = normalizeProvider(provider);

  if (!resolvedProvider) {
    throw createBadRequest('Please select an LLM provider before testing.');
  }

  const normalizedModelOverrides = normalizeModelOverrides(modelOverrides);

  if (requiresUserApiKeyForModel(resolvedProvider, apiKey, normalizedModelOverrides)) {
    throw createBadRequest(userApiKeyRequiredMessage(resolvedProvider));
  }

  await validateCustomProviderOnServer(resolvedProvider, apiKey, customBaseUrl, normalizedModelOverrides);

  const resolvedApiKey = resolveApiKey(resolvedProvider, apiKey);

  if (!resolvedApiKey) {
    throw new Error(`[${ providerLabel(resolvedProvider) }] API Key is missing.`);
  }

  return testProviderConnection({
    provider: resolvedProvider,
    apiKey: resolvedApiKey,
    customBaseUrl,
    doubaoEndpointIdText: doubaoEndpointIdText || env.DOUBAO_ENDPOINT_ID_TEXT,
    doubaoEndpointIdVision: doubaoEndpointIdVision || env.DOUBAO_ENDPOINT_ID_VISION,
    modelOverrides: normalizedModelOverrides,
  });
}

export async function processTocOnServer({
  request,
  images,
  text,
  apiKey,
  provider,
  customBaseUrl,
  doubaoEndpointIdText,
  doubaoEndpointIdVision,
  modelOverrides,
  visionPrompt,
}: {
  request: Request;
  images?: string[];
  text?: string;
  apiKey?: string;
  provider?: string;
  customBaseUrl?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
  modelOverrides?: ModelOverrides;
  visionPrompt?: string;
}) {
  const resolvedProvider = determineProvider(request, provider);
  const normalizedModelOverrides = normalizeModelOverrides(modelOverrides);

  if (requiresUserApiKeyForModel(resolvedProvider, apiKey, normalizedModelOverrides)) {
    throw createBadRequest(userApiKeyRequiredMessage(resolvedProvider));
  }

  await validateCustomProviderOnServer(resolvedProvider, apiKey, customBaseUrl, normalizedModelOverrides);

  const resolvedApiKey = resolveApiKey(resolvedProvider, apiKey);

  if (!resolvedApiKey) {
    throw new Error(`[${ providerLabel(resolvedProvider) }] API Key is missing.`);
  }

  return processToc({
    provider: resolvedProvider,
    apiKey: resolvedApiKey,
    customBaseUrl,
    images,
    text,
    doubaoEndpointIdText: doubaoEndpointIdText || env.DOUBAO_ENDPOINT_ID_TEXT,
    doubaoEndpointIdVision: doubaoEndpointIdVision || env.DOUBAO_ENDPOINT_ID_VISION,
    visionPrompt,
    modelOverrides: {
      geminiModel: 'gemini-2.5-flash',
      qwenVisionModel: env.QWEN_VL_MODEL || 'qwen-vl-plus',
      qwenTextModel: 'qwen-plus',
      zhipuTextModel: 'glm-4-flash',
      zhipuVisionModel: 'glm-4v-flash',
      doubaoTextModel: env.DOUBAO_ENDPOINT_ID_TEXT,
      doubaoVisionModel: env.DOUBAO_ENDPOINT_ID_VISION,
      customModel: normalizedModelOverrides?.customModel,
      ...normalizedModelOverrides,
    },
  });
}

export async function generateBoardOnServer({
  request,
  tocItems,
  apiKey,
  provider,
  customBaseUrl,
  doubaoEndpointIdText,
  modelOverrides,
}: {
  request: Request;
  tocItems: GraphNodeInput[];
  apiKey?: string;
  provider?: string;
  customBaseUrl?: string;
  doubaoEndpointIdText?: string;
  modelOverrides?: ModelOverrides;
}) {
  const resolvedProvider = determineProvider(request, provider);
  const normalizedModelOverrides = normalizeModelOverrides(modelOverrides);

  if (requiresUserApiKeyForModel(resolvedProvider, apiKey, normalizedModelOverrides)) {
    throw createBadRequest(userApiKeyRequiredMessage(resolvedProvider));
  }

  await validateCustomProviderOnServer(resolvedProvider, apiKey, customBaseUrl, normalizedModelOverrides);

  const resolvedApiKey = resolveApiKey(resolvedProvider, apiKey);

  if (!resolvedApiKey) {
    throw new Error(`[${ providerLabel(resolvedProvider) }] API Key is missing.`);
  }

  return generateBoard(tocItems, {
    provider: resolvedProvider,
    apiKey: resolvedApiKey,
    customBaseUrl,
    doubaoEndpointIdText: doubaoEndpointIdText || env.DOUBAO_ENDPOINT_ID_TEXT,
    modelOverrides: {
      geminiModel: 'gemini-2.5-flash',
      qwenTextModel: 'qwen-plus',
      zhipuTextModel: 'glm-4-flash',
      doubaoTextModel: env.DOUBAO_ENDPOINT_ID_TEXT,
      customModel: normalizedModelOverrides?.customModel,
      ...normalizedModelOverrides,
    },
  });
}
