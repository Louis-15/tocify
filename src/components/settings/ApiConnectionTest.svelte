<script lang="ts">
  import {Loader2, Wifi} from 'lucide-svelte';
  import {t} from 'svelte-i18n';

  import {normalizeModelOverrides, type UiApiConfig} from '$lib/llm/core';

  // 只读取父组件的配置，不修改它；测试结果完全封装在本组件内部。
  export let config: UiApiConfig;

  // 连通性测试状态：idle 未测试、testing 请求中、success 成功、error 失败。
  let testStatus: 'idle' | 'testing' | 'success' | 'error' = 'idle';
  let testMessage = '';
  let testLatencyMs = 0;
  // 请求序号：配置变化或重新测试时递增，用来丢弃已经过期的慢请求结果。
  let testRequestId = 0;

  // 父组件在配置变化时调用，避免旧的测试结果继续误导用户。
  export function reset() {
    testRequestId += 1;
    testStatus = 'idle';
    testMessage = '';
    testLatencyMs = 0;
  }

  async function testConnection() {
    if (!config.provider || testStatus === 'testing') {
      return;
    }

    const requestId = ++testRequestId;
    testStatus = 'testing';
    testMessage = '';
    testLatencyMs = 0;

    try {
      const response = await fetch('/api/test-llm', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          provider: config.provider,
          apiKey: config.apiKey,
          customBaseUrl: config.customBaseUrl,
          doubaoEndpointIdText: config.doubaoEndpointIdText,
          doubaoEndpointIdVision: config.doubaoEndpointIdVision,
          modelOverrides: normalizeModelOverrides(config.modelOverrides),
        }),
      });

      const data: any = await response.json().catch(() => ({}));

      if (requestId !== testRequestId) {
        return;
      }

      if (!response.ok || !data.ok) {
        testStatus = 'error';
        testMessage = data.message || data.error || `HTTP ${response.status}`;
        return;
      }

      testStatus = 'success';
      testMessage = data.message || '';
      testLatencyMs = Number(data.latencyMs) || 0;
    } catch (err: any) {
      if (requestId !== testRequestId) {
        return;
      }

      testStatus = 'error';
      testMessage = err?.message || 'Connection test failed.';
    }
  }
</script>

<div class="mt-2 flex flex-wrap items-center gap-2">
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded border-2 border-black px-2 py-1 text-xs font-bold transition-colors
      disabled:cursor-not-allowed disabled:opacity-50
      {testStatus === 'success' ? 'bg-lime-400' : 'bg-white hover:bg-gray-100'}"
    disabled={!config.provider || testStatus === 'testing'}
    on:click={testConnection}
  >
    {#if testStatus === 'testing'}
      <Loader2 size={13} class="animate-spin" />
      {$t('settings.test_connection_testing') || 'Testing...'}
    {:else}
      <Wifi size={13} strokeWidth={2.5} />
      {$t('settings.test_connection') || 'Test connection'}
    {/if}
  </button>

  {#if testStatus === 'success'}
    <span class="text-xs font-semibold text-green-600">
      {$t('settings.test_connection_success') || 'Connection OK'}{testLatencyMs ? ` · ${testLatencyMs} ms` : ''}
    </span>
  {:else if testStatus === 'error'}
    <span class="min-w-0 break-all text-xs font-semibold text-red-600">{testMessage}</span>
  {/if}
</div>
