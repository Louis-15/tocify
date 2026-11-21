<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {ChevronDown, Plus, RotateCcw, Trash2} from 'lucide-svelte';
  import {t} from 'svelte-i18n';

  import {
    DEFAULT_VISION_PROMPT_TEMPLATE,
    DEFAULT_VISION_PROMPT_TEMPLATE_ID,
    createDefaultVisionPromptTemplate,
    type UiApiConfig,
    type VisionPromptTemplate,
  } from '$lib/llm/core';

  import {createTemplateId, getUniqueVisionTemplateName} from './vision-prompt-templates';

  // 直接修改父组件传入的 config，再通过 dirty 事件让父组件重新赋值以触发响应式更新。
  export let config: UiApiConfig;

  const dispatch = createEventDispatcher<{dirty: void}>();

  let visionTemplateName = '';
  let showVisionTemplateMenu = false;
  let lastTemplateId = '';

  $: activeVisionTemplate = config.visionPromptTemplates.find(
    (template) => template.id === config.visionPromptTemplateId,
  );
  $: canDeleteVisionTemplate = Boolean(activeVisionTemplate && !activeVisionTemplate.isDefault);

  // 父组件加载存档或恢复默认模板后会改变 id，此时同步输入框显示的名称。
  $: if (config.visionPromptTemplateId !== lastTemplateId) {
    lastTemplateId = config.visionPromptTemplateId;
    visionTemplateName = activeVisionTemplate ? getDisplayName(activeVisionTemplate) : '';
  }

  function getDisplayName(template: VisionPromptTemplate) {
    return template.isDefault ? $t('settings.vision_prompt_default_template') : template.name;
  }

  // 把输入框里的模板名与提示词写回当前选中的自定义模板（默认模板不保存修改）。
  function syncActiveCustomTemplate() {
    const activeTemplate = activeVisionTemplate;
    if (!activeTemplate || activeTemplate.isDefault) return;

    const name = visionTemplateName.trim() || activeTemplate.name;
    config.visionPromptTemplates = config.visionPromptTemplates.map((template) =>
      template.id === activeTemplate.id
        ? {...template, name, prompt: config.visionPrompt.trim() || DEFAULT_VISION_PROMPT_TEMPLATE}
        : template,
    );
    visionTemplateName = name;
  }

  function handleNameInput(event: Event) {
    visionTemplateName = (event.currentTarget as HTMLInputElement).value;
    showVisionTemplateMenu = false;
    syncActiveCustomTemplate();
    dispatch('dirty');
  }

  function handlePromptInput() {
    syncActiveCustomTemplate();
    dispatch('dirty');
  }

  function selectTemplate(template: VisionPromptTemplate) {
    config.visionPromptTemplateId = template.id;
    config.visionPrompt = template.prompt;
    visionTemplateName = getDisplayName(template);
    showVisionTemplateMenu = false;
    dispatch('dirty');
  }

  function createTemplate() {
    const defaultName = $t('settings.vision_prompt_default_template');
    const currentName = visionTemplateName.trim();
    const baseName =
      !currentName || activeVisionTemplate?.isDefault || currentName === defaultName
        ? $t('settings.vision_prompt_untitled')
        : currentName;
    const name = getUniqueVisionTemplateName(
      config.visionPromptTemplates.map((template) => template.name),
      baseName,
    );
    const template: VisionPromptTemplate = {
      id: createTemplateId(),
      name,
      prompt: config.visionPrompt.trim() || DEFAULT_VISION_PROMPT_TEMPLATE,
    };

    config.visionPromptTemplates = [...config.visionPromptTemplates, template];
    config.visionPromptTemplateId = template.id;
    config.visionPrompt = template.prompt;
    visionTemplateName = template.name;
    showVisionTemplateMenu = false;
    dispatch('dirty');
  }

  function deleteActiveTemplate() {
    const activeTemplate = activeVisionTemplate;
    if (!activeTemplate || activeTemplate.isDefault) return;

    config.visionPromptTemplates = config.visionPromptTemplates.filter(
      (template) => template.id !== activeTemplate.id,
    );
    config.visionPromptTemplateId = DEFAULT_VISION_PROMPT_TEMPLATE_ID;
    config.visionPrompt = DEFAULT_VISION_PROMPT_TEMPLATE;
    visionTemplateName = $t('settings.vision_prompt_default_template');
    showVisionTemplateMenu = false;
    dispatch('dirty');
  }

  function resetTemplate() {
    config.visionPromptTemplateId = DEFAULT_VISION_PROMPT_TEMPLATE_ID;
    config.visionPrompt = DEFAULT_VISION_PROMPT_TEMPLATE;
    config.visionPromptTemplates = [
      createDefaultVisionPromptTemplate(),
      ...config.visionPromptTemplates.filter((template) => !template.isDefault),
    ];
    visionTemplateName = $t('settings.vision_prompt_default_template');
    dispatch('dirty');
  }
</script>

<div class="border-black border-2 rounded-md p-2 w-full">
  <div class="mb-1 flex items-center justify-between gap-2">
    <label
      class="block font-bold text-sm"
      for="vision_prompt">{$t('settings.vision_prompt_label')}</label
    >
    <button
      type="button"
      class="inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-black"
      on:click={resetTemplate}
      aria-label={$t('settings.vision_prompt_reset')}
      title={$t('settings.vision_prompt_reset')}
    >
      <RotateCcw size={13} />
    </button>
  </div>

  <div class="mb-2">
    <div class="flex items-center gap-1">
      <div class="relative min-w-0 flex-1">
        <input
          type="text"
          value={visionTemplateName}
          on:input={handleNameInput}
          autocomplete="off"
          class="w-full border border-gray-300 rounded px-2 py-1 pr-8 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400"
          placeholder={$t('settings.vision_prompt_template_name_placeholder')}
          aria-label={$t('settings.vision_prompt_template_select')}
        />
        <button
          type="button"
          class="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-black"
          on:click={() => (showVisionTemplateMenu = !showVisionTemplateMenu)}
          aria-label={$t('settings.vision_prompt_template_select')}
          title={$t('settings.vision_prompt_template_select')}
        >
          <ChevronDown size={14} />
        </button>

        {#if showVisionTemplateMenu}
          <div class="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border border-gray-300 bg-white shadow-lg">
            {#each config.visionPromptTemplates as template}
              <button
                type="button"
                class="block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-gray-100 {template.id === config.visionPromptTemplateId ? 'bg-blue-50 font-semibold' : ''}"
                on:click={() => selectTemplate(template)}
              >
                {getDisplayName(template)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-50"
        on:click={createTemplate}
        aria-label={$t('settings.vision_prompt_save_as_template')}
        title={$t('settings.vision_prompt_save_as_template')}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 bg-white text-gray-500 hover:bg-gray-50 hover:text-black {canDeleteVisionTemplate ? '' : 'opacity-40'}"
        on:click={deleteActiveTemplate}
        aria-label={$t('settings.vision_prompt_delete_template')}
        title={$t('settings.vision_prompt_delete_template')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  </div>

  <textarea
    id="vision_prompt"
    bind:value={config.visionPrompt}
    on:input={handlePromptInput}
    rows="10"
    class="w-full border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y placeholder:text-gray-400"
    placeholder={$t('settings.vision_prompt_placeholder')}
  ></textarea>
</div>
