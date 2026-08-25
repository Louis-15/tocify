<script lang="ts">
  import {ChevronRight, ChevronDown, Plus, Trash, GripVertical} from 'lucide-svelte';
  import ShortUniqueId from 'short-unique-id';
  import Self from './TocItem.svelte';
  import {maxPage, tocConfig, dragDisabled} from '../stores';
  import {createEventDispatcher} from 'svelte';
  import {t} from 'svelte-i18n';
  import {
    dndzone,
    SHADOW_ITEM_MARKER_PROPERTY_NAME,
    SHADOW_PLACEHOLDER_ITEM_ID,
  } from 'svelte-dnd-action';
  import {flip} from 'svelte/animate';
  import type {TocItem} from '$lib/pdf/service';

  export let item: TocItem;
  export let onUpdate: (item: TocItem, updates: Partial<TocItem>, skipHistory?: boolean) => void;
  export let onDelete: (item: TocItem) => void;
  export let onDragStart: () => void = () => {};
  export let onDragEnd: () => void = () => {};
  export let onSelect: (item: TocItem, event: MouseEvent) => void = () => {};
  // onFocus：用户"单击"某条目录时回调，用于在编辑器侧记录插入锚点（焦点条目）
  export let onFocus: (item: TocItem) => void = () => {};
  // focusedId：当前焦点条目的 id，用于渲染紫色边框高亮，让用户看清新章节会插到哪
  export let focusedId: string | null = null;
  export let onSelectionDragStart: (item: TocItem, event: MouseEvent) => void = () => {};
  export let onSelectionDragEnter: (item: TocItem) => void = () => {};
  export let selectedIds: Set<string> = new Set();
  export let searchQuery = '';

  export let currentPage = 1;
  export let isPreview = false;
  export let pageOffset = 0;
  export let insertAtPage = 2;
  export let tocPageCount = 0;

  export let prefix = '';
  export let index = 0;

  const dispatch = createEventDispatcher<{
    jumpToPage: {to: number};
    showNavHint: void;
  }>();
  export let flipDurationMs = 200;

  let editTitle = item ? item.title : '';
  let editPage = item ? item.to : 1;
  let isFocused = false;
  let isPageFocused = false;

  $: currentNumber = prefix ? `${prefix}.${index}` : `${index}`;
  $: isSelected = selectedIds.has(item.id);
  $: normalizedSearchQuery = searchQuery.trim().toLowerCase();
  $: shouldHighlightTitle = Boolean(normalizedSearchQuery && !isFocused);
  $: highlightedTitleParts = getHighlightedParts(editTitle, normalizedSearchQuery);
  $: isShadowItem = Boolean(getDndMarker(item));
  $: nestedChildren = item?.id === SHADOW_PLACEHOLDER_ITEM_ID ? [] : (item.children || []);

  $: if (item && !isFocused && item.title !== editTitle) {
    editTitle = item.title;
  }

  $: if (item && !isPageFocused && item.to !== editPage) {
    editPage = item.to;
  }

  $: physicalContentPage = item.to + pageOffset;
  $: targetPageInPreview =
    physicalContentPage >= insertAtPage ? physicalContentPage + tocPageCount : physicalContentPage;

  $: isActive = isPreview && currentPage === targetPageInPreview;

  // 是否为"焦点条目"（用户最后单击的条目，即新章节的插入锚点）。
  // 高亮规则已统一：预览页跟随（isActive）和插入锚点焦点（isFocusedItem）
  // 都使用同一种蓝色高亮，不再用紫色边框区分两种状态。
  $: isFocusedItem = focusedId === item.id;
  $: isHighlighted = isActive || isFocusedItem;

  function handleToggle() {
    item.open = !item.open;
    onUpdate(item, {open: item.open});
  }

  function handleUpdateTitle() {
    onUpdate(item, {title: editTitle});
  }

  function handleUpdatePage() {
    const page = Math.floor(editPage);
    if (!isNaN(page) && page !== item.to) {
      onUpdate(item, {to: page});
    }
  }

  function handlePageInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    if (!isNaN(val) && val > 0) {
      dispatch('jumpToPage', {to: val});
    }
  }

  function handleAddChild() {
    const currentChildren = item.children || [];
    let startPage;

    if (currentChildren.length > 0) {
      startPage = Math.max(...currentChildren.map((child) => child.to)) + 1;
    } else {
      startPage = item.to + 1;
    }

    const newChild = {
      id: new ShortUniqueId({length: 10}).randomUUID(),
      title: '',
      to: startPage,
      children: [],
      open: true,
    };

    const updatedChildren = [...currentChildren, newChild];
    onUpdate(item, {children: updatedChildren, open: true});
  }

  function handleUpdateChild(childItem: TocItem, updates: Partial<TocItem>, skipHistory = false) {
    const updatedChildren = (item.children || []).map((child) =>
      child.id === childItem.id ? {...child, ...updates} : child,
    );
    onUpdate(item, {children: updatedChildren}, skipHistory);
  }

  function handleDeleteChild(childItem: TocItem) {
    const updatedChildren = (item.children || []).filter((child) => child.id !== childItem.id);
    onUpdate(item, {children: updatedChildren});
  }

  // ---- 焦点与框选的交互设计说明 ----
  // 旧行为：鼠标悬浮（mouseenter）就会让右侧 PDF 预览跳页，浏览目录时预览会跟着乱跳。
  // 新行为：只有"单击"某条目录才算聚焦该条目，右侧预览才跳到对应页；
  //        按下后拖动超过阈值则视为"框选"操作，不会触发聚焦跳页。
  // 悬浮时显示拖拽把手 / 选择圆点的 UI 保持不变。

  // 记录鼠标按下的起点位置，用于在 click 时判断这次是"单击"还是"拖动框选"
  let rowDownPos: {x: number; y: number} | null = null;
  // 是否已经移动超过阈值（超过即认定为拖拽框选，而非单击）
  let hasRowDragMoved = false;
  // 拖动判定阈值：位移超过该像素数才视为拖动，避免手抖误判
  const DRAG_MOVE_THRESHOLD = 4;

  function handleRowMouseDown(event: MouseEvent) {
    if (isSelectionBlockedTarget(event.target)) return;

    if (event.shiftKey) {
      event.preventDefault();
      return;
    }

    // 仅记录起点并阻止默认的文本选择行为；
    // 框选延迟到 mousemove 超过阈值时才启动（见下方 window 级监听），
    // 这样纯单击不会像旧行为那样顺带选中条目。
    event.preventDefault();
    rowDownPos = {x: event.clientX, y: event.clientY};
    hasRowDragMoved = false;

    // 注意：拖动检测必须挂在 window 上而不是行元素上——
    // 鼠标按住拖出该行后，行元素收不到后续 mousemove 事件，
    // 若挂在行上，框选会在鼠标离开行的瞬间"卡死"无法启动。
    const onMove = (e: MouseEvent) => {
      if (!rowDownPos || hasRowDragMoved) return;
      if (
        Math.abs(e.clientX - rowDownPos.x) > DRAG_MOVE_THRESHOLD ||
        Math.abs(e.clientY - rowDownPos.y) > DRAG_MOVE_THRESHOLD
      ) {
        hasRowDragMoved = true;
        // 此时才真正开始框选：以当前条目为锚点开始选择
        onSelectionDragStart(item, e);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      // 保留 hasRowDragMoved 供随后的 click 事件判断是否为纯单击；
      // rowDownPos 立即清空，避免下一次按下前残留旧起点
      rowDownPos = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, {once: true});
  }

  function handleDndConsider(e: CustomEvent<{items: TocItem[]}>) {
    onDragStart();
    item.children = e.detail.items;
    item = item;
  }

  function handleDndFinalize(e: CustomEvent<{items: TocItem[]}>) {
    item.children = e.detail.items;
    item = item;
    onUpdate(item, {children: item.children}, true);
    onDragEnd();
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>('.toc-item-title'));
      const target = e.target as HTMLInputElement;
      const inputIndex = allInputs.indexOf(target);
      if (inputIndex !== -1) {
        if (e.key === 'ArrowUp' && inputIndex > 0) {
          allInputs[inputIndex - 1].focus();
        } else if (e.key === 'ArrowDown' && inputIndex < allInputs.length - 1) {
          allInputs[inputIndex + 1].focus();
        }
      }
    }
  }

  function handleTitleFocus() {
    isFocused = true;
    const expiryStr = localStorage.getItem('tocify_edit_title_toast_until');
    const now = Date.now();
    if (!expiryStr || now > parseInt(expiryStr, 10)) {
      dispatch('showNavHint');
      const newExpiry = now + 30 * 24 * 60 * 60 * 1000;
      localStorage.setItem('tocify_edit_title_toast_until', newExpiry.toString());
    }
  }

  function enableDrag() {
    $dragDisabled = false;
  }

  function isSelectionBlockedTarget(target: EventTarget | null) {
    const element = target as HTMLElement | null;
    return Boolean(element?.closest('button,input,textarea,label,a,[data-drag-handle]'));
  }

  function handleRowClick(event: MouseEvent) {
    // 按钮、输入框、拖拽把手等交互元素上的点击不参与"聚焦/选择"逻辑
    if (isSelectionBlockedTarget(event.target)) return;

    // Shift+点击：保留原有的范围多选行为
    if (event.shiftKey) {
      onSelect(item, event);
      return;
    }

    // 纯单击（按下后没有拖动）：聚焦该条目并让右侧 PDF 预览跳到对应页。
    // 注意：这里不再调用 onSelect，避免单击浏览目录时误选中条目；
    // 多选仍然可以通过悬浮出现的圆点按钮、按住拖动框选、Shift+点击完成。
    if (!hasRowDragMoved) {
      onFocus(item);
      dispatch('jumpToPage', {to: item.to});
    }

    rowDownPos = null;
    hasRowDragMoved = false;
  }

  // 单击标题/页码输入框同样视为"聚焦该条目"：
  // 这两个输入框占据条目的绝大部分面积，若只允许点行空白处才能聚焦，
  // 用户几乎每次点击都落在输入框上，焦点功能会形同虚设。
  // Shift+点击的范围多选仍由 handleShiftSelectFromInput 在 mousedown 阶段处理，这里直接放行。
  function handleInputClick(event: MouseEvent) {
    if (event.shiftKey) return;
    onFocus(item);
    dispatch('jumpToPage', {to: item.to});
  }

  function handleSelectionDotMouseDown(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      onSelect(item, event);
      return;
    }

    onSelectionDragStart(item, event);
  }

  function handleShiftSelectFromInput(event: MouseEvent) {
    if (!event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(item, event);
  }

  function getDndMarker(tocItem: TocItem) {
    return (tocItem as TocItem & Record<string, unknown>)[SHADOW_ITEM_MARKER_PROPERTY_NAME];
  }

  function getHighlightedParts(text: string, query: string) {
    if (!query) return [{text, matched: false}];

    const lowerText = text.toLowerCase();
    const firstMatchIndex = lowerText.indexOf(query);

    if (firstMatchIndex === -1) {
      return [{text, matched: false}];
    }

    const contextLength = 16;
    const start = Math.max(0, firstMatchIndex - contextLength);
    const end = Math.min(text.length, firstMatchIndex + query.length + contextLength);
    const displayText = `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
    const lowerDisplayText = displayText.toLowerCase();
    const parts: {text: string; matched: boolean}[] = [];
    let cursor = 0;
    let matchIndex = lowerDisplayText.indexOf(query);

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        parts.push({text: displayText.slice(cursor, matchIndex), matched: false});
      }

      parts.push({text: displayText.slice(matchIndex, matchIndex + query.length), matched: true});
      cursor = matchIndex + query.length;
      matchIndex = lowerDisplayText.indexOf(query, cursor);
    }

    if (cursor < displayText.length) {
      parts.push({text: displayText.slice(cursor), matched: false});
    }

    return parts.length > 0 ? parts : [{text: displayText, matched: false}];
  }
</script>

{#if item}
  <div>
    <div
      class="flex items-center gap-1 py-1.5 rounded-md group -mr-1 border-2 border-transparent"
      class:bg-blue-200={isHighlighted}
      class:font-bold={isHighlighted}
      class:border-amber-400={isSelected}
      class:bg-amber-50={isSelected && !isHighlighted}
      data-is-dnd-shadow-item-hint={isShadowItem}
      data-toc-item-id={item.id}
      on:mouseover={() => onSelectionDragEnter(item)}
      on:mousedown={handleRowMouseDown}
      on:click={handleRowClick}
    >
      <div
        class="flex items-center gap-1 flex-1 min-w-0 h-full"
      >
        <div
          data-drag-handle
          class="cursor-grab active:cursor-grabbing rounded-md p-0.5 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100 text-gray-400"
          on:mousedown={enableDrag}
          on:touchstart={enableDrag}
        >
          <GripVertical size={12} />
        </div>
        <button
          type="button"
          on:click|stopPropagation
          on:mousedown={handleSelectionDotMouseDown}
          class="relative -left-0.5 w-3 h-3 rounded-full border-2 flex-shrink-0 transition-all duration-150 {isSelected ? 'bg-amber-400 border-amber-500 scale-100' : 'border-gray-400 scale-90 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:!scale-100 hover:!border-amber-400'}"
          title={$t('toc.select_item')}
          aria-label={$t('toc.select_item')}
        ></button>

        <button
          on:click|stopPropagation={handleToggle}
          class="hover:bg-gray-200 rounded-md text-gray-500 ml-[-4px]"
          class:invisible={!item.children || item.children.length === 0}
          title={$t('settings.toggle_expand')}
        >
          {#if item.open}
            <ChevronDown size={16} />
          {:else}
            <ChevronRight size={16} />
          {/if}
        </button>

        {#if $tocConfig.prefixSettings.enabled}
          <span class="text-xs text-gray-600 font-mono select-none pr-1">
            {currentNumber}
          </span>
        {/if}

        <div class="relative flex-1 min-w-[100px]">
          {#if shouldHighlightTitle}
            <div
              class="absolute inset-0 px-2 py-1 text-sm leading-6 truncate pointer-events-none"
              aria-hidden="true"
            >
              {#each highlightedTitleParts as part}
                {#if part.matched}
                  <mark class="bg-yellow-300 text-black rounded-sm px-0.5">{part.text}</mark>
                {:else}
                  <span>{part.text}</span>
                {/if}
              {/each}
            </div>
          {/if}
          <input
            type="text"
            bind:value={editTitle}
            on:mousedown={handleShiftSelectFromInput}
            on:click={handleInputClick}
            on:focus={handleTitleFocus}
            on:blur={() => {
              isFocused = false;
              handleUpdateTitle();
            }}
            on:keydown={handleTitleKeydown}
            on:keypress={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
            placeholder={prefix === '' ? $t('toc.new_chapter_default') : ($t('toc.new_item_default') || 'New Item')}
            class="toc-item-title relative w-full bg-transparent border-2 border-black rounded px-2 py-1 text-sm myfocus focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400 {shouldHighlightTitle ? 'text-transparent caret-black' : ''}"
          />
        </div>
      </div>

      <input
        type="number"
        bind:value={editPage}
        on:mousedown={handleShiftSelectFromInput}
        on:click={handleInputClick}
        on:input={handlePageInput}
        on:focus={() => (isPageFocused = true)}
        on:blur={() => {
          isPageFocused = false;
          handleUpdatePage();
        }}
        on:keypress={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
        class="w-14 border-2 border-black rounded ml-1 pl-1.5 py-1 text-sm myfocus focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div class="flex">
        <button
          on:click={handleAddChild}
          class="p-1 hover:bg-gray-200 rounded-md"
          title={$t('toc.add_child')}
        >
          <Plus size={14} />
        </button>
        <button
          on:click={() => onDelete(item)}
          class="px-1 hover:bg-gray-200 rounded-md text-black"
          title={$t('toc.delete_item')}
        >
          <Trash size={14} />
        </button>
      </div>
    </div>

    {#if item.open && nestedChildren.length > 0}
      <div
        class="ml-6 pl-2 border-transparent hover:border-gray-200 transition-colors"
        use:dndzone={{
          items: nestedChildren,
          flipDurationMs,
          dragDisabled: $dragDisabled || Boolean(normalizedSearchQuery),
          dropTargetStyle: nestedChildren.length > 0 ? {outline: '2px dashed #000', borderRadius: '4px'} : {},
        }}
        on:consider={handleDndConsider}
        on:finalize={handleDndFinalize}
      >
        {#each nestedChildren as child, i (`${child.id}${getDndMarker(child) ? `_${getDndMarker(child)}` : ''}`)}
          <div animate:flip={{duration: flipDurationMs}}>
            <Self
              prefix={currentNumber}
              index={i + 1}
              item={child}
              {flipDurationMs}
              onUpdate={handleUpdateChild}
              onDelete={handleDeleteChild}
              {onDragStart}
              {onDragEnd}
              {onSelect}
              {onFocus}
              {focusedId}
              {onSelectionDragStart}
              {onSelectionDragEnter}
              {selectedIds}
              {searchQuery}
              {currentPage}
              {isPreview}
              {pageOffset}
              {insertAtPage}
              {tocPageCount}
              on:showNavHint
              on:jumpToPage={(e: CustomEvent<{to: number}>) => dispatch('jumpToPage', e.detail)}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
