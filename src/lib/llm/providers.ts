// 供应商与模型解析模块。
// 只负责“有哪些供应商、各自的 Base URL / 默认模型 / 模型字段怎么取”，
// 不包含网络请求与 URL 安全校验，避免与 request.ts、security.ts 形成循环依赖。

export type Provider = 'gemini' | 'qwen' | 'doubao' | 'zhipu' | 'opencode' | 'commandcode' | 'custom';

export interface ModelOverrides {
  geminiModel?: string;
  qwenTextModel?: string;
  qwenVisionModel?: string;
  zhipuTextModel?: string;
  zhipuVisionModel?: string;
  doubaoTextModel?: string;
  doubaoVisionModel?: string;
  opencodeModel?: string;
  commandcodeModel?: string;
  customModel?: string;
}

export const KNOWN_PROVIDER_MODELS: Record<'gemini' | 'qwen' | 'zhipu', { text: readonly string[]; vision: readonly string[] }> = {
  gemini: {
    text: ['gemini-2.5-flash'],
    vision: ['gemini-2.5-flash'],
  },
  qwen: {
    text: ['qwen-plus'],
    vision: ['qwen-vl-plus'],
  },
  zhipu: {
    text: ['glm-4-flash'],
    vision: ['glm-4v-flash'],
  },
} as const;

export interface DirectApiConfig {
  provider?: string;
  apiKey: string;
  customBaseUrl?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
  modelOverrides?: ModelOverrides;
  visionPrompt?: string;
}

export type OpenAiCompatProvider = Exclude<Provider, 'gemini'>;
export type BuiltInOpenAiCompatProvider = Exclude<OpenAiCompatProvider, 'custom'>;

export const MAX_CUSTOM_BASE_URL_LENGTH = 512;
export const MAX_CUSTOM_MODEL_LENGTH = 200;
const MAX_API_KEY_LENGTH = 4096;

// OpenCode Go 的接口强制要求 x-opencode-session 请求头，
// 缺失时会直接返回 400 MissingSessionID。该头只要求“稳定”，不需要真实会话 ID，
// 因此这里使用固定的本地标识常量，避免每次请求随机生成导致上游无法关联请求。
export const OPENCODE_SESSION_ID = 'tocify-local';
// 仅对 OpenCode 官方主机追加该请求头，其余 OpenAI 兼容提供商（qwen/zhipu/doubao 等）保持原有行为。
export const OPENCODE_HOSTNAME = 'opencode.ai';

export const DEFAULT_CUSTOM_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_CUSTOM_MODEL = 'gpt-5.4-mini';

// OpenCode Go 的固定 Base URL：作为预设供应商时由代码写死，UI 不提供编辑入口，
// 也不读取用户填写的 customBaseUrl，避免用户误填导致请求发往错误地址。
export const OPENCODE_BASE_URL = 'https://opencode.ai/inference/go/openai/v1';
// OpenCode Go 的默认模型，仅用于 UI 占位与用户未指定模型时的兜底。
export const DEFAULT_OPENCODE_MODEL = 'glm-5.3-flash';

// Command Code 的固定 Base URL：OpenAI Chat Completions 兼容端点。
// 注意它的 Claude 模型只能走 /messages，本项目统一使用 /chat/completions，
// 因此默认模型选择官方示例中的非 Claude 模型。
export const COMMANDCODE_BASE_URL = 'https://api.commandcode.ai/provider/v1';
export const DEFAULT_COMMANDCODE_MODEL = 'deepseek/deepseek-v4-flash';

export const BUILT_IN_OPENAI_COMPAT_BASE_URL: Record<BuiltInOpenAiCompatProvider, string> = {
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  opencode: OPENCODE_BASE_URL,
  commandcode: COMMANDCODE_BASE_URL,
};

export function providerLabel(provider: Provider): string {
  // 这两个供应商的官方写法不是首字母大写。
  if (provider === 'opencode') {
    return 'OpenCode Go';
  }

  if (provider === 'commandcode') {
    return 'Command Code';
  }

  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function normalizeProvider(provider?: string): Provider | undefined {
  const normalized = provider?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (
    normalized === 'gemini' ||
    normalized === 'qwen' ||
    normalized === 'doubao' ||
    normalized === 'zhipu' ||
    normalized === 'opencode' ||
    normalized === 'commandcode' ||
    normalized === 'custom'
  ) {
    return normalized;
  }

  throw new Error(`Unsupported provider: ${ provider }`);
}

export function requireProvider(provider?: string, missingMessage = 'Please select an LLM provider when using your own API key.'): Provider {
  const normalized = normalizeProvider(provider);

  if (!normalized) {
    throw new Error(missingMessage);
  }

  return normalized;
}

export function normalizeApiKeyForRequest(apiKey: string): string {
  const normalized = apiKey?.trim();

  if (!normalized) {
    throw new Error('API Key is missing.');
  }

  if (normalized.length > MAX_API_KEY_LENGTH) {
    throw new Error('API key is too long.');
  }

  return normalized;
}

function normalizeModelName(model?: string): string | undefined {
  const normalized = model?.trim();
  return normalized ? normalized : undefined;
}

export function normalizeModelOverrides(modelOverrides?: ModelOverrides): ModelOverrides | undefined {
  if (!modelOverrides) {
    return undefined;
  }

  const sanitized: ModelOverrides = {};

  for (const [key, value] of Object.entries(modelOverrides)) {
    const normalized = normalizeModelName(value);
    if (normalized) {
      sanitized[key as keyof ModelOverrides] = normalized;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function getCustomModel(config: { modelOverrides?: ModelOverrides }): string {
  const model = normalizeModelName(config.modelOverrides?.customModel) || DEFAULT_CUSTOM_MODEL;

  if (!model) {
    throw new Error('Custom model is required.');
  }

  if (model.length > MAX_CUSTOM_MODEL_LENGTH) {
    throw new Error('Custom model is too long.');
  }

  return model;
}

export function hasUnknownCustomModel(provider?: string, modelOverrides?: ModelOverrides): boolean {
  const normalizedProvider = normalizeProvider(provider);
  const sanitizedOverrides = normalizeModelOverrides(modelOverrides);

  if (!normalizedProvider || normalizedProvider === 'doubao') {
    return false;
  }

  if (normalizedProvider === 'custom') {
    return true;
  }

  // OpenCode / Command Code 的模型即使不在内置列表里也不需要额外提示——
  // 它们本来就要求用户自带 key，这个判断交给 requiresUserApiKeyForModel 处理。
  if (normalizedProvider === 'opencode' || normalizedProvider === 'commandcode') {
    return false;
  }

  if (!sanitizedOverrides) {
    return false;
  }

  switch (normalizedProvider) {
    case 'gemini': {
      const model = sanitizedOverrides.geminiModel;
      return Boolean(model && !KNOWN_PROVIDER_MODELS.gemini.text.includes(model));
    }
    case 'qwen': {
      const textModel = sanitizedOverrides.qwenTextModel;
      const visionModel = sanitizedOverrides.qwenVisionModel;

      if (textModel && visionModel && textModel === visionModel) {
        return !KNOWN_PROVIDER_MODELS.qwen.text.includes(textModel)
          && !KNOWN_PROVIDER_MODELS.qwen.vision.includes(textModel);
      }

      return Boolean(
        (textModel && !KNOWN_PROVIDER_MODELS.qwen.text.includes(textModel)) ||
        (visionModel && !KNOWN_PROVIDER_MODELS.qwen.vision.includes(visionModel))
      );
    }
    case 'zhipu': {
      const textModel = sanitizedOverrides.zhipuTextModel;
      const visionModel = sanitizedOverrides.zhipuVisionModel;

      if (textModel && visionModel && textModel === visionModel) {
        return !KNOWN_PROVIDER_MODELS.zhipu.text.includes(textModel)
          && !KNOWN_PROVIDER_MODELS.zhipu.vision.includes(textModel);
      }

      return Boolean(
        (textModel && !KNOWN_PROVIDER_MODELS.zhipu.text.includes(textModel)) ||
        (visionModel && !KNOWN_PROVIDER_MODELS.zhipu.vision.includes(visionModel))
      );
    }
  }
}

export function requiresUserApiKeyForModel(provider?: string, apiKey?: string, modelOverrides?: ModelOverrides): boolean {
  // OpenCode Go / Command Code 没有服务端默认 key（server.ts 的 resolveApiKey 返回空串），
  // 因此无论用户填的是哪个模型，只要没填 key 就要提示，而不是走“未知模型”判断。
  const normalizedProvider = normalizeProvider(provider);

  if (normalizedProvider === 'opencode' || normalizedProvider === 'commandcode') {
    return !apiKey?.trim();
  }

  return !apiKey?.trim() && hasUnknownCustomModel(provider, modelOverrides);
}

export function getGeminiModel(config: { modelOverrides?: ModelOverrides }): string {
  return config.modelOverrides?.geminiModel || 'gemini-2.5-flash';
}

export function getOpenAiCompatTextModel(provider: OpenAiCompatProvider, config: DirectApiConfig): string {
  switch (provider) {
    case 'qwen':
      return config.modelOverrides?.qwenTextModel || 'qwen-plus';
    case 'zhipu':
      return config.modelOverrides?.zhipuTextModel || 'glm-4-flash';
    case 'doubao':
      return config.doubaoEndpointIdText || config.modelOverrides?.doubaoTextModel || (() => {
        throw new Error('Doubao text Endpoint ID is required.');
      })();
    case 'opencode':
      return config.modelOverrides?.opencodeModel || DEFAULT_OPENCODE_MODEL;
    case 'commandcode':
      return config.modelOverrides?.commandcodeModel || DEFAULT_COMMANDCODE_MODEL;
    case 'custom':
      return getCustomModel(config);
  }
}

export function getOpenAiCompatVisionModel(provider: OpenAiCompatProvider, config: DirectApiConfig): string {
  switch (provider) {
    case 'qwen':
      return config.modelOverrides?.qwenVisionModel || 'qwen-vl-plus';
    case 'zhipu':
      return config.modelOverrides?.zhipuVisionModel || 'glm-4v-flash';
    case 'doubao':
      return config.doubaoEndpointIdVision || config.modelOverrides?.doubaoVisionModel || (() => {
        throw new Error('Doubao vision Endpoint ID is required.');
      })();
    case 'opencode':
      // OpenCode Go 的同一批模型同时支持文本与图像输入，因此复用同一个模型字段。
      return config.modelOverrides?.opencodeModel || DEFAULT_OPENCODE_MODEL;
    case 'commandcode':
      // Command Code 的模型同样区分视觉能力，由用户在同一个字段中指定支持图像的模型。
      return config.modelOverrides?.commandcodeModel || DEFAULT_COMMANDCODE_MODEL;
    case 'custom':
      return getCustomModel(config);
  }
}
