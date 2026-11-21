// 目录识别模板的纯逻辑：ID 生成、存档规范化、重名处理。

import {
  DEFAULT_VISION_PROMPT_TEMPLATE,
  DEFAULT_VISION_PROMPT_TEMPLATE_ID,
  createDefaultVisionPromptTemplate,
  type VisionPromptTemplate,
} from '$lib/llm/core';

export function createTemplateId(): string {
  return `vision-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 把存档里的模板数组整理成“默认模板 + 自定义模板”的结构。
 * untitledLabel 由调用方从 i18n 传入，避免本模块依赖 svelte-i18n。
 */
export function normalizeVisionPromptTemplates(parsed: any, untitledLabel: string): {
  templates: VisionPromptTemplate[];
  activeId: string;
  activePrompt: string;
} {
  const defaultTemplate = createDefaultVisionPromptTemplate();
  const rawTemplates = Array.isArray(parsed?.visionPromptTemplates)
    ? parsed.visionPromptTemplates
    : [];
  const sanitizedTemplates = rawTemplates
    .map((template: any) => ({
      id: String(template?.id || createTemplateId()),
      name: String(template?.name || untitledLabel),
      prompt: String(template?.prompt || ''),
      isDefault: template?.id === DEFAULT_VISION_PROMPT_TEMPLATE_ID || Boolean(template?.isDefault),
    }))
    .filter((template: VisionPromptTemplate) => template.prompt.trim());

  const customTemplates = sanitizedTemplates.filter(
    (template: VisionPromptTemplate) => template.id !== DEFAULT_VISION_PROMPT_TEMPLATE_ID,
  );
  const templates = [defaultTemplate, ...customTemplates];
  const parsedActiveId = String(parsed?.visionPromptTemplateId || DEFAULT_VISION_PROMPT_TEMPLATE_ID);
  const activeTemplate = templates.find((template) => template.id === parsedActiveId);

  if (activeTemplate) {
    return {
      templates,
      activeId: activeTemplate.id,
      activePrompt: parsed?.visionPrompt || activeTemplate.prompt,
    };
  }

  return {
    templates,
    activeId: DEFAULT_VISION_PROMPT_TEMPLATE_ID,
    activePrompt: parsed?.visionPrompt || DEFAULT_VISION_PROMPT_TEMPLATE,
  };
}

export function getUniqueVisionTemplateName(existingNames: Iterable<string>, baseName: string): string {
  const names = new Set(existingNames);
  if (!names.has(baseName)) return baseName;

  let index = 2;
  let nextName = `${baseName} ${index}`;
  while (names.has(nextName)) {
    index += 1;
    nextName = `${baseName} ${index}`;
  }
  return nextName;
}
