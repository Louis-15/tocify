// 目录识别 / 知识图谱的业务编排层。
// 供应商与模型解析见 providers.ts，URL 安全校验见 security.ts，
// 网络请求与连通性测试见 request.ts，JSON 修复见 json.ts。
// 本文件继续 re-export 这些能力，保持现有 `$lib/llm/core` 的导入路径不变。

import {
  SYSTEM_PROMPT_GRAPH,
  SYSTEM_PROMPT_TEXT,
  SYSTEM_PROMPT_VISION,
  normalizeToc,
} from '$lib/utils/toc';

import { parseJsonPayload } from './json';
import {
  DEFAULT_COMMANDCODE_MODEL,
  DEFAULT_CUSTOM_BASE_URL,
  DEFAULT_CUSTOM_MODEL,
  DEFAULT_OPENCODE_MODEL,
  getCustomModel,
  getGeminiModel,
  getOpenAiCompatTextModel,
  getOpenAiCompatVisionModel,
  normalizeApiKeyForRequest,
  providerLabel,
  requireProvider,
  type DirectApiConfig,
  type ModelOverrides,
  type Provider,
} from './providers';
import { fetchGeminiJson, fetchOpenAiCompatJson, getOpenAiCompatBaseUrl } from './request';
import { normalizeCustomBaseUrl } from './security';

export { parseJsonPayload } from './json';
export {
  COMMANDCODE_BASE_URL,
  DEFAULT_COMMANDCODE_MODEL,
  DEFAULT_CUSTOM_BASE_URL,
  DEFAULT_CUSTOM_MODEL,
  DEFAULT_OPENCODE_MODEL,
  KNOWN_PROVIDER_MODELS,
  OPENCODE_BASE_URL,
  hasUnknownCustomModel,
  normalizeModelOverrides,
  normalizeProvider,
  requireProvider,
  requiresUserApiKeyForModel,
  type DirectApiConfig,
  type ModelOverrides,
  type Provider,
} from './providers';
export { isBlockedIpAddress, normalizeCustomBaseUrl } from './security';
export { testProviderConnection, type ConnectionTestResult } from './request';

export const DEFAULT_VISION_PROMPT_TEMPLATE = SYSTEM_PROMPT_VISION.trim();
export const DEFAULT_VISION_PROMPT_TEMPLATE_ID = 'tocify-default';

export interface VisionPromptTemplate {
  id: string;
  name: string;
  prompt: string;
  isDefault?: boolean;
}

export function createDefaultVisionPromptTemplate(): VisionPromptTemplate {
  return {
    id: DEFAULT_VISION_PROMPT_TEMPLATE_ID,
    name: 'Tocify Default',
    prompt: DEFAULT_VISION_PROMPT_TEMPLATE,
    isDefault: true,
  };
}

export interface UiApiConfig extends DirectApiConfig {
  provider: string;
  apiKey: string;
  /**
   * 按供应商独立保存的 API Key 映射，键为 provider 名（未选择供应商时用 'auto'）。
   * 切换供应商时从该映射恢复对应的 key，避免用户反复输入。
   * 注意：这是纯前端存储结构，不会随请求发送到服务端。
   */
  apiKeys: Record<string, string>;
  customBaseUrl: string;
  doubaoEndpointIdText: string;
  doubaoEndpointIdVision: string;
  modelOverrides: ModelOverrides;
  visionPrompt: string;
  visionPromptTemplateId: string;
  visionPromptTemplates: VisionPromptTemplate[];
}

export interface TocInputConfig extends DirectApiConfig {
  images?: string[];
  text?: string;
}

export interface GraphNodeInput {
  id: string | number;
  title: string;
  page?: number | null;
}

export interface GraphResponse {
  nodes: Array<{
    id: string;
    title: string;
    isInferred: boolean;
    page: number | null;
    cluster: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: string;
    label: string;
  }>;
}

export function validateCustomProviderConfig(config: {
  apiKey?: string;
  customBaseUrl?: string;
  modelOverrides?: ModelOverrides;
}): { apiKey: string; baseUrl: string; model: string } {
  return {
    apiKey: normalizeApiKeyForRequest(config.apiKey || ''),
    baseUrl: normalizeCustomBaseUrl(config.customBaseUrl),
    model: getCustomModel(config),
  };
}

export function createEmptyApiConfig(): UiApiConfig {
  return {
    provider: '',
    apiKey: '',
    apiKeys: {},
    customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
    doubaoEndpointIdText: '',
    doubaoEndpointIdVision: '',
    modelOverrides: {
      geminiModel: '',
      qwenTextModel: '',
      qwenVisionModel: '',
      zhipuTextModel: '',
      zhipuVisionModel: '',
      opencodeModel: DEFAULT_OPENCODE_MODEL,
      commandcodeModel: DEFAULT_COMMANDCODE_MODEL,
      customModel: DEFAULT_CUSTOM_MODEL,
    },
    visionPrompt: DEFAULT_VISION_PROMPT_TEMPLATE,
    visionPromptTemplateId: DEFAULT_VISION_PROMPT_TEMPLATE_ID,
    visionPromptTemplates: [createDefaultVisionPromptTemplate()],
  };
}

function normalizeImageUrl(image: string): string {
  if (image.startsWith('data:image/')) {
    return image;
  }

  return `data:image/png;base64,${ image }`;
}

async function requestTextJson(config: DirectApiConfig, systemPrompt: string, userText: string): Promise<string> {
  const provider = requireProvider(config.provider);

  if (provider === 'gemini') {
    return fetchGeminiJson(
      getGeminiModel(config),
      config.apiKey,
      {
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [{
          role: 'user',
          parts: [{ text: userText }],
        }],
      },
      `${ providerLabel(provider) } request failed.`,
    );
  }

  const textBody: Record<string, unknown> = {
    model: getOpenAiCompatTextModel(provider, config),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
  };

  if (provider !== 'zhipu') {
    textBody.max_completion_tokens = 4096;
  }

  return fetchOpenAiCompatJson(
    getOpenAiCompatBaseUrl(provider, config),
    config.apiKey,
    textBody,
    `${ providerLabel(provider) } request failed.`,
  );
}

async function requestVisionJson(config: DirectApiConfig, systemPrompt: string, promptText: string, images: string[]): Promise<string> {
  const provider = requireProvider(config.provider);

  if (provider === 'gemini') {
    const parts = images.map((image) => {
      const normalized = normalizeImageUrl(image);
      const [meta, data] = normalized.split(',');
      const mimeType = meta.match(/data:(.*?);base64/)?.[1] || 'image/png';

      return {
        inlineData: {
          mimeType,
          data,
        },
      };
    });

    return fetchGeminiJson(
      getGeminiModel(config),
      config.apiKey,
      {
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [{
          role: 'user',
          parts: [
            { text: promptText },
            ...parts,
          ],
        }],
      },
      `${ providerLabel(provider) } request failed.`,
    );
  }

  const visionBody: Record<string, unknown> = {
    model: getOpenAiCompatVisionModel(provider, config),
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          ...images.map((image) => ({
            type: 'image_url',
            image_url: { url: normalizeImageUrl(image) },
          })),
        ],
      },
    ],
  };

  // 不设置 max_completion_tokens：让模型使用其自身的默认输出上限，
  // 与 Gemini 分支保持一致。旧版硬编码 4096（后改 16384）会导致长目录被截断，
  // 只识别出一部分。去掉限制后，由各模型 API 自行按其能力上限输出，
  // 主流视觉模型默认上限远大于 4096，足以覆盖大目录。

  return fetchOpenAiCompatJson(
    getOpenAiCompatBaseUrl(provider, config),
    config.apiKey,
    visionBody,
    `${ providerLabel(provider) } request failed.`,
  );
}

export async function processToc(config: TocInputConfig) {
  const provider = requireProvider(config.provider);

  if (config.text?.trim()) {
    const jsonText = await requestTextJson(config, SYSTEM_PROMPT_TEXT, config.text);
    return normalizeToc(parseJsonPayload<any[]>(jsonText, 'array'));
  }

  if (!config.images?.length) {
    throw new Error('No images provided.');
  }

  const visionPrompt = config.visionPrompt?.trim() || DEFAULT_VISION_PROMPT_TEMPLATE;

  try {
    const jsonText = await requestVisionJson(
      config,
      visionPrompt,
      'Analyze these Table of Contents images and return the single structured JSON.',
      config.images,
    );
    return normalizeToc(parseJsonPayload<any[]>(jsonText, 'array'));
  } catch (err: any) {
    if (provider === 'zhipu' && typeof err?.message === 'string' && err.message.includes('context_length_exceeded')) {
      throw new Error('图片总大小超出了智谱 Flash 模型的限制，请尝试减少图片数量或切换到付费模型 glm-4v');
    }
    throw err;
  }
}

export async function generateBoard(tocItems: GraphNodeInput[], config: DirectApiConfig): Promise<GraphResponse> {
  const provider = requireProvider(config.provider);
  const tocText = tocItems
    .map((item) => `[ID:${ item.id }] ${ item.title } (Page: ${ item.page || 'N/A' })`)
    .join('\n');

  const jsonText = provider === 'gemini'
    ? await fetchGeminiJson(
      getGeminiModel(config),
      config.apiKey,
      {
        generationConfig: {
          responseMimeType: 'application/json',
        },
        contents: [{
          role: 'user',
          parts: [{ text: `${ SYSTEM_PROMPT_GRAPH }\n\nToC Data:\n${ tocText }` }],
        }],
      },
      `${ providerLabel(provider) } request failed.`,
    )
    : await fetchOpenAiCompatJson(
      getOpenAiCompatBaseUrl(provider, config),
      config.apiKey,
      {
        model: getOpenAiCompatTextModel(provider, config),
        ...(provider !== 'zhipu' && { max_completion_tokens: 4096 }),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_GRAPH },
          { role: 'user', content: `ToC Data:\n${ tocText }` },
        ],
      },
      `${ providerLabel(provider) } request failed.`,
    );

  const aiData = parseJsonPayload<{
    nodes?: Array<{ id: string; label?: string; cluster?: string; page?: number | null }>;
    edges?: Array<{ source: string; target: string; type: string; label: string }>;
  }>(jsonText, 'object');

  return {
    nodes: (aiData.nodes || []).map((aiNode) => {
      const match = tocItems.find((item) => String(item.id) === String(aiNode.id));
      const page = aiNode.page !== undefined ? aiNode.page : (match?.page ?? null);

      return {
        id: aiNode.id,
        title: aiNode.label || String(aiNode.id),
        isInferred: !page,
        page,
        cluster: aiNode.cluster || 'Unclassified',
      };
    }),
    edges: aiData.edges || [],
  };
}
