<script lang="ts">
  import {fade, fly} from 'svelte/transition';
  import {X} from 'lucide-svelte';

  export let showHelpModal: boolean;
</script>

{#if showHelpModal}
  <div
    class="fixed inset-0 bg-lime-400 flex items-center justify-center z-50 p-4"
    transition:fade={{duration: 150}}
    on:click={() => (showHelpModal = false)}
  >
    <div
      class="bg-white rounded-lg p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)]"
      transition:fly={{y: 20, duration: 200}}
      on:click|stopPropagation
    >
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h2 class="text-2xl font-black italic">Tocify 使用指南</h2>

        <button
          on:click={() => (showHelpModal = false)}
          class="absolute top-4 right-4 md:relative md:top-auto md:right-auto p-2 border-2 border-transparent hover:border-black rounded hover:bg-gray-100 transition-all"
          aria-label="Close modal"
        >
          <X
            size={24}
            strokeWidth={3}
          />
        </button>
      </div>

      <div class="flex flex-col gap-6">
        <!-- 内嵌 README 使用说明（static/readme.html） -->
        <iframe
          src="/readme.html"
          class="w-full h-[70vh] rounded-md border-2 border-gray-200"
          title="Tocify 使用说明"
        ></iframe>
      </div>
    </div>
  </div>
{/if}
