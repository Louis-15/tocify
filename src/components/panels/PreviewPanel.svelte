<script lang="ts">
  import {fade} from 'svelte/transition';
  import {t} from 'svelte-i18n';
  import {createEventDispatcher} from 'svelte';
  import Dropzone from 'svelte-file-dropzone';

  import DropzoneView from '../DropzoneView.svelte';
  import PDFViewer from '../PDFViewer.svelte';
  import PDFControls from '../PDFControls.svelte';
  import type {RecognitionIgnoreRegion} from '$lib/pdf/recognition-ignore';

  export let isFileLoading = false;
  export let isDragging = false;
  export let pdfState: any;
  export let originalPdfInstance: any;
  export let tocPdfInstance: any;

  export let isPreviewMode = false;
  export let isPreviewLoading = false;

  export let tocRanges: {start: number; end: number; id: string}[];
  export let tocSelectionPageNumbers: number[] = [];
  export let recognitionIgnoreRegions: RecognitionIgnoreRegion[] = [];
  export let activeRangeIndex: number;
  export let addPhysicalTocPage: boolean;
  export let tocPageCount: number;
  export let currentTocPath: any[] = []; // TocItem[]
  export let prefetchPageNum: number = 0;
  export let highlightPageNum = 0;

  export let jumpToTocPage: () => Promise<void>;

  const dispatch = createEventDispatcher();
  let fileInputRef: HTMLInputElement;


  function handleFileInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      dispatch('fileselect', target.files[0]);
      target.value = '';
    }
  }

  /**
   * Dropzone 覆盖层自己的 drop 处理。
   *
   * 为什么外层已经处理了 drop，这里还要保留？
   * svelte-file-dropzone 内部对 dragenter/dragover/dragleave/drop 都调用了
   * stopPropagation + stopImmediatePropagation（见其 onDropCb 等实现），
   * 事件不会继续冒泡到外层容器。因此：
   *   - 未加载 PDF 时，拖拽落点在 Dropzone 覆盖层内 → 只有这里能收到，必须由它接管；
   *   - 已加载 PDF 时，拖拽落点在 z-10 的 PDFViewer 上（不经过 Dropzone）→ 由外层容器接管。
   * 两者天然互斥，不会重复派发 fileselect。
   */
  function handleDrop(e: CustomEvent) {
    isDragging = false;
    // 归零外层拖拽深度，避免"从外层进入、却在覆盖层内落下"时计数残留，
    // 导致下次拖拽的 dragleave 无法归零、遮罩卡住不消失
    dragDepth = 0;
    const {acceptedFiles} = e.detail;
    if (acceptedFiles.length) {
      dispatch('fileselect', acceptedFiles[0]);
    }
  }

  // ---- 拖拽替换 PDF（修复：已有书籍时拖拽无法替换）----
  // 背景 bug：svelte-file-dropzone 的覆盖层与 PDFViewer 是兄弟节点，
  // 而已加载 PDF 时 PDFViewer 所在容器带 z-10，层级高于覆盖层。
  // 拖拽落点实际落在 PDFViewer 上，事件冒泡路径不经过 Dropzone 容器，
  // 于是 Dropzone 的 dragenter / drop 都收不到 → isDragging 永远为 false →
  // 只能靠"上传新文件"按钮换书。这里改为在整个预览卡片外层容器上挂原生拖拽事件，
  // 捕获范围包含 PDFViewer，任何位置拖入都能触发替换。
  //
  // 用 dragDepth 计数器而不是布尔量：dragenter / dragleave 会在子元素之间穿梭时
  // 成对触发，若直接赋 true/false，指针移到子元素上就会瞬间变 false，遮罩会闪烁。
  // 计数器保证只有真正离开整个面板（深度归零）才关闭遮罩。
  let dragDepth = 0;

  /** 判断拖入的是否为 PDF：优先看 MIME，兼容部分系统 MIME 为空的情况，再回退到扩展名 */
  function isPdfFile(file: File | undefined | null): boolean {
    if (!file) return false;
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  /** 是否正在拖拽文件（而非拖拽页面内的其它元素）。必须在 dragenter/dragover 里
   *  preventDefault，否则浏览器会执行默认行为（直接打开该文件）且 drop 事件不会触发。 */
  function isFileDrag(e: DragEvent): boolean {
    return Array.from(e.dataTransfer?.types || []).includes('Files');
  }

  function handleNativeDragEnter(e: DragEvent) {
    // 加载中忽略拖拽：此时正在销毁旧实例/解析新文件，再拖入会造成状态竞争
    if (isFileLoading || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepth += 1;
    isDragging = true;
  }

  function handleNativeDragOver(e: DragEvent) {
    if (isFileLoading || !isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    isDragging = true;
  }

  function handleNativeDragLeave(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      isDragging = false;
    }
  }

  function handleNativeDrop(e: DragEvent) {
    e.preventDefault();
    // 强制归零：避免极端情况下 dragenter/dragleave 不配对导致遮罩卡住
    dragDepth = 0;
    isDragging = false;

    if (isFileLoading) return;

    // 用 find 而不是取第一个：用户同时拖入多个文件时，
    // 即使第一个不是 PDF 也能挑出其中的 PDF，不至于整批丢弃
    const files = Array.from(e.dataTransfer?.files || []);
    const pdf = files.find(isPdfFile);
    if (pdf) {
      dispatch('fileselect', pdf);
    }
  }

  function forwardFileLoadedEvent(e: CustomEvent) {
    dispatch('viewerMessage', e.detail);
  }

  function openRecognitionIgnoreEditor(e: CustomEvent<{pageNum: number}>) {
    dispatch('openRecognitionIgnore', e.detail);
  }
</script>

<div class="flex flex-col w-full lg:w-[70%] lg:sticky lg:top-5 lg:self-start">
  <!-- 拖拽事件挂在这一层（整张预览卡片），而不是只挂在 Dropzone 上：
       已有 PDF 时 PDFViewer 以 z-10 压在 Dropzone 覆盖层之上，拖拽落点收不到 Dropzone 事件，
       挂在外层才能保证"无论拖到哪里都能替换书籍"。 -->
  <div
    class="relative h-fit pb-4 min-h-[85vh] border-black border-2 rounded-lg bg-white shadow-[2px_2px_0px_rgba(0,0,0,1)]"
    on:dragenter={handleNativeDragEnter}
    on:dragover={handleNativeDragOver}
    on:dragleave={handleNativeDragLeave}
    on:drop={handleNativeDrop}
  >
    {#if isFileLoading}
      <div
        class="absolute inset-0 bg-white bg-opacity-80 flex items-center justify-center z-50 rounded-lg"
        transition:fade={{duration: 100}}
      >
        <div class="flex flex-col items-center gap-4">
          <div class="animate-spin rounded-full h-12 w-12 border-4 border-black border-t-transparent"></div>
          <span class="text-xl font-bold">{$t('status.loading_rendering')}</span>
        </div>
      </div>
    {:else}
      <!-- 无 PDF 时：拖拽落点在这个覆盖层内，Dropzone 内部 stopPropagation 会阻断冒泡，
           外层收不到事件，所以这里必须保留它自己的拖拽监听；
           有 PDF 时：PDFViewer 以 z-10 压在覆盖层之上，落点不经过 Dropzone，
           由外层容器接管。两条路径互补，不会重复触发。 -->
      <Dropzone
        containerClasses="absolute inset-0 w-full h-full"
        accept=".pdf"
        disableDefaultStyles
        on:drop={handleDrop}
        on:dragenter={() => !isFileLoading && (isDragging = true)}
        on:dragleave={() => (isDragging = false)}
      >
        <DropzoneView
          {isDragging}
          hasInstance={!!pdfState.instance}
        />
      </Dropzone>
    {/if}

    <!-- 拖拽时的高亮提示层。
         为什么不复用 DropzoneView 里的那个：Dropzone 覆盖层位于 PDFViewer 所在的 z-10 容器之下，
         已有 PDF 时会整个被压住，用户拖拽时看不到任何反馈。
         这里把提示层提到 z-40（仅 isDragging 时出现），保证"有书时拖拽"也有明确视觉反馈。
         pointer-events-none：让它保持纯视觉、不参与事件命中，
         拖拽事件仍由外层容器捕获，避免改变 drop 的目标元素。 -->
    {#if isDragging}
      <div
        class="absolute inset-0 z-40 rounded-lg bg-blue-200 bg-opacity-80 flex items-center justify-center pointer-events-none"
        transition:fade={{duration: 100}}
      >
        <p class="text-2xl font-bold">{$t('dropzone.drop_here')}</p>
      </div>
    {/if}

    {#if pdfState.instance}
      <div class="relative z-10 h-full flex flex-col">
        <PDFViewer
          bind:pdfState
          mode={isPreviewMode ? 'single' : 'grid'}
          {originalPdfInstance}
          {tocPdfInstance}
          {tocPageCount}
          {tocRanges}
          {recognitionIgnoreRegions}
          {activeRangeIndex}
          on:updateActiveRange
          on:openRecognitionIgnore={openRecognitionIgnoreEditor}
          on:fileloaded={forwardFileLoadedEvent}
          {jumpToTocPage}
          {addPhysicalTocPage}
          {currentTocPath}
          {prefetchPageNum}
          bind:highlightPageNum
        />

        <input
          type="file"
          class="hidden"
          accept=".pdf"
          bind:this={fileInputRef}
          on:change={handleFileInputChange}
        />

        <PDFControls
          {isPreviewLoading}
          {isPreviewMode}
          {originalPdfInstance}
          doc={pdfState.doc}
          on:triggerUpload={() => fileInputRef?.click()}
          on:togglePreview={() => dispatch('togglePreview')}
          on:export={() => dispatch('export')}
          on:openChapterExport={() => dispatch('openChapterExport')}
        />
      </div>
    {/if}
  </div>
</div>
