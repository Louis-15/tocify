// API 设置的本地存储与“按供应商保存 Key”逻辑。
// 抽成纯 TS 模块，方便单独测试，也避免组件继续膨胀。

import type { UiApiConfig } from '$lib/llm/core';

export const API_CONFIG_STORAGE_KEY = 'tocify_api_config';

// 未选择供应商（Auto）时也保留独立槽位，避免它的 key 与具体供应商的 key 互相覆盖。
export function getApiKeySlot(provider: string): string {
  return provider || 'auto';
}

// 取出当前输入框里的 key，并与已有映射合并：切换供应商/保存前都要先“记下来”。
export function withCurrentApiKeyRemembered(config: UiApiConfig): Record<string, string> {
  return {...config.apiKeys, [getApiKeySlot(config.provider)]: config.apiKey};
}

export function normalizeStoredApiKeys(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 从存档中解析出按供应商分组的 key。
 * 兼容旧版本：旧存档只保存了一个全局 apiKey，这里把它迁到当时选中的供应商槽位，
 * 用户升级后不需要重新输入当前供应商的 key。
 */
export function resolveStoredApiKeys(parsed: any): { apiKeys: Record<string, string>; apiKey: string } {
  const currentSlot = getApiKeySlot(typeof parsed?.provider === 'string' ? parsed.provider : '');
  const apiKeys = normalizeStoredApiKeys(parsed?.apiKeys);

  if (!apiKeys[currentSlot] && typeof parsed?.apiKey === 'string' && parsed.apiKey.trim()) {
    apiKeys[currentSlot] = parsed.apiKey;
  }

  return { apiKeys, apiKey: apiKeys[currentSlot] || '' };
}

export function loadStoredApiConfig(): any {
  try {
    const raw = localStorage.getItem(API_CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('Failed to parse api config', e);
    return null;
  }
}

export function persistApiConfig(config: UiApiConfig): void {
  localStorage.setItem(API_CONFIG_STORAGE_KEY, JSON.stringify(config));
}
