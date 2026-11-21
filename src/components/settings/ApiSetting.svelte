<script lang="ts">
  import {createEventDispatcher, onMount} from 'svelte';
  import {slide} from 'svelte/transition';
  import {t} from 'svelte-i18n';
  import {ExternalLink, Eye, EyeOff, KeyRound, Sparkles} from 'lucide-svelte';

  import {
    createEmptyApiConfig,
    requiresUserApiKeyForModel,
    type UiApiConfig,
  } from '$lib/llm/core';

  import ApiConnectionTest from './ApiConnectionTest.svelte';
  import ProviderFields from './ProviderFields.svelte';
  import VisionPromptPanel from './VisionPromptPanel.svelte';
  import {
    loadStoredApiConfig,
    persistApiConfig,
    resolveStoredApiKeys,
    withCurrentApiKeyRemembered,
    getApiKeySlot,
  } from './api-config-storage';
  import {normalizeVisionPromptTemplates} from './vision-prompt-templates';

  export let isExpanded = false;

  const dispatch = createEventDispatcher();

  let config = createEmptyApiConfig();

  let isSaved = false;
  let showApiKey = false;
  let showCustomModelNotice = false;
  let customModelNoticeVersion = 0;
  // 子组件的连通性测试状态由其自身管理，这里只保留实例引用以便配置变化时重置。
  let connectionTest: ApiConnectionTest;

  const providerLinks = {
    gemini: {
      label: 'Gemini',
      href: 'https://aistudio.google.com/app/apikey',
    },
    qwen: {
      label: 'Qwen',
      href: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    },
    doubao: {
      label: 'Doubao',
      href: 'https://www.volcengine.com/docs/82379/1541594?lang=zh',
    },
    zhipu: {
      label: 'Zhipu',
      href: 'https://open.bigmodel.cn/usercenter/apikeys',
    },
    opencode: {
      label: 'OpenCode Go',
      href: 'https://opencode.ai/console',
    },
    commandcode: {
      label: 'Command Code',
      href: 'https://commandcode.ai/studio',
    },
  };

  function getEffectiveConfig() {
    const effectiveConfig = {
      provider: config.provider,
      apiKey: config.apiKey,
      apiKeys: {...config.apiKeys},
      customBaseUrl: config.customBaseUrl,
      doubaoEndpointIdText: config.doubaoEndpointIdText,
      doubaoEndpointIdVision: config.doubaoEndpointIdVision,
      modelOverrides: config.modelOverrides,
      visionPrompt: config.visionPrompt,
    };

    if (!config.provider) {
      return {
        ...effectiveConfig,
        modelOverrides: undefined,
      };
    }

    return effectiveConfig;
  }

  function getVisibleProviderLinks() {
    if (config.provider && config.provider in providerLinks) {
      return [providerLinks[config.provider as keyof typeof providerLinks]];
    }

    return [];
  }

  function handleProviderChange(event: Event) {
    const nextProvider = (event.currentTarget as HTMLSelectElement).value;
    // 先把旧供应商已输入的 key 收进映射，再切换到新供应商对应的 key。
    const apiKeys = withCurrentApiKeyRemembered(config);

    config = {
      ...config,
      provider: nextProvider,
      apiKeys,
      apiKey: apiKeys[getApiKeySlot(nextProvider)] || '',
    };

    markDirty();
  }

  function markDirty() {
    isSaved = false;
    showCustomModelNotice = false;
    // 配置一旦变化，之前的连通性测试结果就不再可信。
    connectionTest?.reset();
  }

  // 子组件直接修改了 config 的属性，这里重新赋值以触发 Svelte 的响应式更新。
  function handleChildDirty() {
    config = {...config};
    markDirty();
  }

  function save() {
    showCustomModelNotice = customModelNeedsUserApiKey;
    if (customModelNeedsUserApiKey) {
      customModelNoticeVersion += 1;
    }

    // 保存前把当前输入框里的 key 收进按供应商分组的映射，确保切换供应商后仍能找回。
    config = {...config, apiKeys: withCurrentApiKeyRemembered(config)};
    persistApiConfig(config);
    isSaved = true;
    const effectiveConfig = getEffectiveConfig();
    dispatch('save', effectiveConfig);
    dispatch('change', effectiveConfig);

    setTimeout(() => {
      isSaved = false;
    }, 1000);

    setTimeout(() => {
      if (!showCustomModelNotice) {
        isExpanded = false;
      }
    }, 400);
  }

  onMount(() => {
    const parsed = loadStoredApiConfig();
    if (!parsed) {
      return;
    }

    const defaultConfig = createEmptyApiConfig();
    const {templates, activeId, activePrompt} = normalizeVisionPromptTemplates(
      parsed,
      $t('settings.vision_prompt_untitled'),
    );
    const {apiKeys, apiKey} = resolveStoredApiKeys(parsed);

    config = {
      ...defaultConfig,
      ...parsed,
      apiKeys,
      apiKey,
      customBaseUrl: parsed.customBaseUrl?.trim() || defaultConfig.customBaseUrl,
      modelOverrides: {
        ...defaultConfig.modelOverrides,
        ...(parsed.modelOverrides || {}),
        customModel: parsed.modelOverrides?.customModel?.trim() || defaultConfig.modelOverrides.customModel,
        opencodeModel: parsed.modelOverrides?.opencodeModel?.trim() || defaultConfig.modelOverrides.opencodeModel,
        commandcodeModel: parsed.modelOverrides?.commandcodeModel?.trim() || defaultConfig.modelOverrides.commandcodeModel,
      },
      visionPrompt: activePrompt,
      visionPromptTemplateId: activeId,
      visionPromptTemplates: templates,
    };

    dispatch('change', getEffectiveConfig());
  });

  $: customModelNeedsUserApiKey = requiresUserApiKeyForModel(
    config.provider,
    config.apiKey,
    config.modelOverrides,
  );
</script>

<div class="border-black border-2 rounded-lg p-2 my-4 shadow-[2px_2px_0px_rgba(0,0,0,1)] bg-white">
  <div class="flex justify-between items-center">
    <div class="flex items-center gap-2">
      <h2>
        {$t('settings.api_settings_title') || 'API Settings'}
      </h2>
    </div>
    <button
      class="w-6 h-6 flex items-center justify-center transition-transform duration-200"
      class:rotate-180={isExpanded}
      on:click={() => (isExpanded = !isExpanded)}
      aria-label="Toggle API Settings"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
      >
    </button>
  </div>

  {#if isExpanded}
    <div
      class="mt-3"
      transition:slide={{duration: 200}}
    >
      <div class="flex flex-col gap-3">
        <div class="border-black border-2 rounded-md p-2 w-full">
          <label
            class="font-bold mb-1 text-sm flex items-center"
            for="llm_provider">
            <Sparkles size={14} strokeWidth={3} class="inline-block mr-1"/>LLM Provider</label
          >
          <div class="flex items-center gap-3">
            <select
              id="llm_provider"
              class="w-full bg-white outline-none text-sm"
              value={config.provider}
              on:change={handleProviderChange}
            >
              <option value="">Auto</option>
              <option value="gemini">Gemini</option>
              <option value="qwen">Qwen</option>
              <option value="doubao">Doubao</option>
              <option value="zhipu">Zhipu</option>
              <option value="opencode">OpenCode Go</option>
              <option value="commandcode">Command Code</option>
              <option value="custom">Custom / OpenAI Compatible</option>
            </select>

            {#each getVisibleProviderLinks() as providerLink}
              <a
                href={providerLink.href}
                target="_blank"
                rel="noreferrer"
                class="shrink-0 inline-flex items-center gap-1 text-xs text-gray-600 hover:text-black"
              >
                <span>Get Key</span>
                <ExternalLink size={12} strokeWidth={2.5} />
              </a>
            {/each}
          </div>
        </div>

        <ProviderFields {config} on:dirty={handleChildDirty} />

        {#if config.provider}
          <div class="border-black border-2 rounded-md p-2 w-full">
            <label
              class="flex items-center gap-1.5 font-bold mb-1 text-sm"
              for="api_key"
              title="Your LLM provider key (stored locally only)"
            >
              <KeyRound size={14} strokeWidth={3} />
             Key
              <span class="font-normal text-gray-400 text-[11px] ml-2">{$t('settings.api_key_hint')}</span>
            </label>
            <div class="flex items-center gap-2">
              <input
                id="api_key"
                type="text"
                name="tocify-provider-api-token"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                data-form-type="other"
                data-1p-ignore="true"
                data-lpignore="true"
                class:text-security-disc={!showApiKey && Boolean(config.apiKey)}
                class="min-w-0 flex-1 outline-none placeholder:text-gray-400 placeholder:italic [&::placeholder]:text-xs "
                placeholder={$t('settings.api_key_placeholder')}
                bind:value={config.apiKey}
                on:input={markDirty}
              />
              <button
                type="button"
                class="shrink-0 text-gray-500 hover:text-black transition-colors"
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                title={showApiKey ? 'Hide API key' : 'Show API key'}
                on:click={() => (showApiKey = !showApiKey)}
              >
                {#if showApiKey}
                  <EyeOff size={16} strokeWidth={2.5} />
                {:else}
                  <Eye size={16} strokeWidth={2.5} />
                {/if}
              </button>
            </div>
            {#if showCustomModelNotice}
              {#key customModelNoticeVersion}
                <p class="mt-2 rounded-md py-1.5 text-xs text-stone-600 animate-notice-shake">
                  {config.provider === 'opencode'
                    ? $t('error.opencode_api_key_required')
                    : config.provider === 'commandcode'
                      ? $t('error.commandcode_api_key_required')
                      : $t('error.custom_model_needs_api_key')}
                </p>
              {/key}
            {/if}

            <ApiConnectionTest bind:this={connectionTest} {config} />
          </div>
        {/if}

        <VisionPromptPanel {config} on:dirty={handleChildDirty} />

        <button
          class="w-full font-bold transition-all duration-200 text-black border-2 border-black rounded px-3 py-2
          {isSaved ? 'bg-lime-400' : 'bg-yellow-400 hover:bg-yellow-300'}"
          on:click={save}
        >
          {isSaved ? $t('btn.saved') : $t('btn.save')}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .animate-notice-shake {
    animation: notice-shake 0.32s ease-in-out;
    transform-origin: center;
  }

  .text-security-disc {
    -webkit-text-security: disc;
  }

  @keyframes notice-shake {
    0% {
      transform: translateX(0);
    }
    20% {
      transform: translateX(-3px);
    }
    40% {
      transform: translateX(3px);
    }
    60% {
      transform: translateX(-2px);
    }
    80% {
      transform: translateX(2px);
    }
    100% {
      transform: translateX(0);
    }
  }
</style>
