<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {slide} from 'svelte/transition';
  import {t} from 'svelte-i18n';

  import {
    COMMANDCODE_BASE_URL,
    DEFAULT_COMMANDCODE_MODEL,
    DEFAULT_CUSTOM_BASE_URL,
    DEFAULT_CUSTOM_MODEL,
    DEFAULT_OPENCODE_MODEL,
    KNOWN_PROVIDER_MODELS,
    OPENCODE_BASE_URL,
    type UiApiConfig,
  } from '$lib/llm/core';

  // 直接修改父组件传入的 config 对象，再通过 dirty 事件让父组件重新赋值以触发响应式更新。
  export let config: UiApiConfig;

  const dispatch = createEventDispatcher<{dirty: void}>();

  function getSingleModelValue(provider: string) {
    switch (provider) {
      case 'gemini':
        return config.modelOverrides.geminiModel;
      case 'qwen':
        return config.modelOverrides.qwenVisionModel || config.modelOverrides.qwenTextModel;
      case 'zhipu':
        return config.modelOverrides.zhipuVisionModel || config.modelOverrides.zhipuTextModel;
      case 'opencode':
        return config.modelOverrides.opencodeModel;
      case 'commandcode':
        return config.modelOverrides.commandcodeModel;
      case 'custom':
        return config.modelOverrides.customModel;
      default:
        return '';
    }
  }

  function setSingleModelValue(provider: string, value: string) {
    if (provider === 'gemini') {
      config.modelOverrides.geminiModel = value;
    } else if (provider === 'qwen') {
      // Qwen 的文本/视觉模型在 UI 上共用一个输入框，填一次同时生效。
      config.modelOverrides.qwenTextModel = value;
      config.modelOverrides.qwenVisionModel = value;
    } else if (provider === 'zhipu') {
      config.modelOverrides.zhipuTextModel = value;
      config.modelOverrides.zhipuVisionModel = value;
    } else if (provider === 'opencode') {
      // OpenCode Go 的同一批模型同时支持文本与图像，只维护一个模型字段。
      config.modelOverrides.opencodeModel = value;
    } else if (provider === 'commandcode') {
      // Command Code 的文本/图像能力取决于所选模型，同样只维护一个字段。
      config.modelOverrides.commandcodeModel = value;
    } else if (provider === 'custom') {
      config.modelOverrides.customModel = value;
    }

    dispatch('dirty');
  }

  function handleModelInput(provider: string, event: Event) {
    setSingleModelValue(provider, (event.currentTarget as HTMLInputElement).value);
  }

  function markDirty() {
    dispatch('dirty');
  }
</script>

{#if config.provider === 'gemini'}
  <div
    class="border-black border-2 rounded-md p-2 w-full"
    transition:slide={{duration: 200}}
  >
    <label
      class="block font-bold mb-1 text-sm"
      for="gemini_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
    >
    <input
      id="gemini_model"
      type="text"
      name="gemini-model-input"
      autocomplete="new-password"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      data-1p-ignore="true"
      data-lpignore="true"
      class="w-full outline-none text-sm placeholder-gray-400"
      placeholder={KNOWN_PROVIDER_MODELS.gemini.text[0]}
      value={getSingleModelValue('gemini')}
      on:input={(e) => handleModelInput('gemini', e)}
    />
  </div>
{/if}

{#if config.provider === 'qwen'}
  <div class="border-black border-2 rounded-md p-2 w-full" transition:slide={{duration: 200}}>
    <label
      class="block font-bold mb-1 text-sm"
      for="qwen_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
    >
    <input
      id="qwen_model"
      type="text"
      name="qwen-model-input"
      autocomplete="new-password"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      data-1p-ignore="true"
      data-lpignore="true"
      class="w-full outline-none text-sm placeholder-gray-400"
      placeholder={KNOWN_PROVIDER_MODELS.qwen.vision[0]}
      value={getSingleModelValue('qwen')}
      on:input={(e) => handleModelInput('qwen', e)}
    />
  </div>
{/if}

{#if config.provider === 'zhipu'}
  <div class="border-black border-2 rounded-md p-2 w-full" transition:slide={{duration: 200}}>
    <label
      class="block font-bold mb-1 text-sm"
      for="zhipu_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
    >
    <input
      id="zhipu_model"
      type="text"
      name="zhipu-model-input"
      autocomplete="new-password"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      data-1p-ignore="true"
      data-lpignore="true"
      class="w-full outline-none text-sm placeholder-gray-400"
      placeholder={KNOWN_PROVIDER_MODELS.zhipu.vision[0]}
      value={getSingleModelValue('zhipu')}
      on:input={(e) => handleModelInput('zhipu', e)}
    />
  </div>
{/if}

{#if config.provider === 'opencode'}
  <!-- OpenCode Go 的 Base URL 由代码写死（OPENCODE_BASE_URL），此处只做只读展示，
       不绑定 config.customBaseUrl，确保用户无法修改预设地址。 -->
  <div class="border-black border-2 rounded-md p-2 w-full">
    <label
      class="flex items-center gap-1.5 font-bold mb-1 text-sm"
      for="opencode_base_url"
    >
      {$t('settings.custom_base_url_label') || 'Base URL'}
      <span class="font-normal text-gray-400 text-[11px]">
        {$t('settings.opencode_base_url_hint') || 'Preset, not editable'}
      </span>
    </label>
    <input
      id="opencode_base_url"
      type="text"
      name="opencode-base-url"
      readonly
      tabindex="-1"
      aria-readonly="true"
      class="w-full cursor-not-allowed bg-gray-100 text-gray-600 outline-none text-sm"
      value={OPENCODE_BASE_URL}
    />
  </div>

  <div class="border-black border-2 rounded-md p-2 w-full">
    <label
      class="block font-bold mb-1 text-sm"
      for="opencode_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
    >
    <input
      id="opencode_model"
      type="text"
      name="opencode-model-input"
      autocomplete="new-password"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      data-1p-ignore="true"
      data-lpignore="true"
      class="w-full outline-none text-sm placeholder-gray-400"
      placeholder={DEFAULT_OPENCODE_MODEL}
      maxlength="200"
      value={getSingleModelValue('opencode')}
      on:input={(e) => handleModelInput('opencode', e)}
    />
    <p class="mt-1 text-[11px] text-gray-500">
      {$t('settings.opencode_model_hint') || 'e.g. glm-5.3-flash, deepseek-v4.1-flash, minimax-m3'}
    </p>
  </div>
{/if}

{#if config.provider === 'commandcode'}
  <!-- Command Code 的 Base URL 同样由代码写死，UI 只做只读展示。 -->
  <div class="border-black border-2 rounded-md p-2 w-full" transition:slide={{duration: 200}}>
    <label
      class="flex items-center gap-1.5 font-bold mb-1 text-sm"
      for="commandcode_base_url"
    >
      {$t('settings.custom_base_url_label') || 'Base URL'}
      <span class="font-normal text-gray-400 text-[11px]">
        {$t('settings.commandcode_base_url_hint') || 'Preset, not editable'}
      </span>
    </label>
    <input
      id="commandcode_base_url"
      type="text"
      name="commandcode-base-url"
      readonly
      tabindex="-1"
      aria-readonly="true"
      class="w-full cursor-not-allowed bg-gray-100 text-gray-600 outline-none text-sm"
      value={COMMANDCODE_BASE_URL}
    />
  </div>

  <div class="border-black border-2 rounded-md p-2 w-full" transition:slide={{duration: 200}}>
    <label
      class="block font-bold mb-1 text-sm"
      for="commandcode_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
    >
    <input
      id="commandcode_model"
      type="text"
      name="commandcode-model-input"
      autocomplete="new-password"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      data-1p-ignore="true"
      data-lpignore="true"
      class="w-full outline-none text-sm placeholder-gray-400"
      placeholder={DEFAULT_COMMANDCODE_MODEL}
      maxlength="200"
      value={getSingleModelValue('commandcode')}
      on:input={(e) => handleModelInput('commandcode', e)}
    />
    <p class="mt-1 text-[11px] text-gray-500">
      {$t('settings.commandcode_model_hint') || 'e.g. deepseek/deepseek-v4-flash；识别目录请选择支持图像的模型'}
    </p>
  </div>
{/if}

{#if config.provider === 'custom'}
  <div class="border-black border-2 rounded-md p-2 w-full">
    <label
      class="block font-bold mb-1 text-sm"
      for="custom_base_url">{$t('settings.custom_base_url_label') || 'Base URL'}</label
    >
    <input
      id="custom_base_url"
      type="url"
      name="custom-base-url-input"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      class="w-full outline-none text-sm placeholder-gray-400"
      placeholder={$t('settings.custom_base_url_placeholder') || DEFAULT_CUSTOM_BASE_URL}
      maxlength="512"
      bind:value={config.customBaseUrl}
      on:input={markDirty}
    />
  </div>

  <div class="border-black border-2 rounded-md p-2 w-full">
    <label
      class="block font-bold mb-1 text-sm"
      for="custom_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
    >
    <input
      id="custom_model"
      type="text"
      name="custom-model-input"
      autocomplete="new-password"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      data-1p-ignore="true"
      data-lpignore="true"
      class="w-full outline-none text-sm placeholder-gray-400"
      placeholder={DEFAULT_CUSTOM_MODEL}
      maxlength="200"
      value={getSingleModelValue('custom')}
      on:input={(e) => handleModelInput('custom', e)}
    />
  </div>
{/if}

{#if config.provider === 'doubao'}
  <div class="border-black border-2 rounded-md p-2 w-full">
    <label
      class="block font-bold mb-1 text-sm"
      for="doubao_ep_text">Endpoint ID (Text/Lite)</label
    >
    <input
      id="doubao_ep_text"
      type="text"
      class="w-full outline-none text-sm placeholder-gray-400"
      placeholder="ep-..."
      bind:value={config.doubaoEndpointIdText}
      on:input={markDirty}
    />
  </div>

  <div class="border-black border-2 rounded-md p-2 w-full">
    <label
      class="block font-bold mb-1 text-sm"
      for="doubao_ep_vision">Endpoint ID (Vision/Pro)</label
    >
    <input
      id="doubao_ep_vision"
      type="text"
      class="w-full outline-none text-sm placeholder-gray-400"
      placeholder="ep-..."
      bind:value={config.doubaoEndpointIdVision}
      on:input={markDirty}
    />
  </div>
{/if}
