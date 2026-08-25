<script lang="ts">
  import {onDestroy, tick, createEventDispatcher} from 'svelte';
  import ShortUniqueId from 'short-unique-id';
  import {createEmptyApiConfig, requiresUserApiKeyForModel} from '$lib/llm/core';
  import {
    Sparkles,
    Loader2,
    ChevronsDownUp,
    ChevronsUpDown,
    ArrowUp,
    ArrowDown,
    Hash,
    X,
    Search,
  } from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import TocItem from './TocItem.svelte';
  import Tooltip from './Tooltip.svelte';
  import {tocItems, maxPage, autoSaveEnabled, dragDisabled, curFileFingerprint} from '../stores';
  import type {TocItem as TocEntry} from '$lib/pdf/service';

  import {dndzone, SHADOW_ITEM_MARKER_PROPERTY_NAME} from 'svelte-dnd-action';
  import {flip} from 'svelte/animate';
  import {fly} from 'svelte/transition';

  export let currentPage = 1;
  export let isPreview = false;
  export let pageOffset = 0;
  export let insertAtPage = 2;
  export let tocPageCount = 0;
  // 编辑模式（页面网格）下用户框选的唯一页码（原始 PDF 内容物理页）；
  // 多选（start<end）或未选择时为 null。由 +page.svelte 根据 tocRanges 计算传入。
  export let gridSelectedPage: number | null = null;

  export let apiConfig = createEmptyApiConfig();
  const dispatch = createEventDispatcher();

  type FlatTocItem = Omit<TocEntry, 'children'> & {
    level: number;
    parentId: string | null;
  };

  let flipDurationMs = 200;

  let text = ``;
  let isUpdatingFromEditor = false;
  let isProcessing = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let batchOffsetInput = '';
  let showBatchOffsetEditor = false;
  let selectedIds = new Set<string>();
  let selectionAnchorId: string | null = null;
  let isSelectionDragging = false;
  let selectionDragAnchorId: string | null = null;
  let selectionDragMode: 'add' | 'remove' = 'add';
  let tocSearchQuery = '';

  let historyStack: TocEntry[][] = [];
  let futureStack: TocEntry[][] = [];
  const maxHistory = 20;

  export function saveHistory() {
    const clone = JSON.parse(JSON.stringify($tocItems));
    historyStack.push(clone);
    if (historyStack.length > maxHistory) {
      historyStack.shift();
    }
    futureStack = [];
  }

  function undo() {
    if (historyStack.length === 0) return;
    const current = JSON.parse(JSON.stringify($tocItems));
    futureStack.push(current);
    const prev = historyStack.pop();
    if (!prev) return;
    $tocItems = prev;
  }

  function redo() {
    if (futureStack.length === 0) return;
    const current = JSON.parse(JSON.stringify($tocItems));
    historyStack.push(current);
    const next = futureStack.pop();
    if (!next) return;
    $tocItems = next;
  }

  function clearSelection() {
    selectedIds = new Set();
    selectionAnchorId = null;
    showBatchOffsetEditor = false;
    batchOffsetInput = '';
  }

  function isEditableKeyboardTarget(target: EventTarget | null) {
    const element = target instanceof HTMLElement ? target : null;
    return Boolean(element?.closest('input, textarea, select, [contenteditable]'));
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.isComposing || isEditableKeyboardTarget(e.target)) return;

    let handled = false;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      handled = true;
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
      handled = true;
      redo();
    } else if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      handled = deleteSelectedTocItems();
    } else if (e.key === 'Escape' && selectedIds.size > 0) {
      handled = true;
      clearSelection();
    }

    if (!handled) return;

    e.preventDefault();
    e.stopPropagation();
  }

  let isDragging = false;
  let textGenTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  let showNavHint = false;
  let navHintTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  function handleShowNavHint() {
    if (navHintTimer) clearTimeout(navHintTimer);
    showNavHint = true;
    navHintTimer = setTimeout(() => {
      showNavHint = false;
    }, 4000);
  }

  const unsubscribe = tocItems.subscribe((value) => {
    if (isUpdatingFromEditor) return;
    if (isDragging) return;

    clearTimeout(textGenTimer);
    textGenTimer = setTimeout(() => {
      const newText = generateText(value);
      if (newText !== text) {
        text = newText;
      }
    }, 300);
  });

  onDestroy(() => {
    unsubscribe();
    clearTimeout(textGenTimer);
    clearTimeout(debounceTimer);
    clearTimeout(navHintTimer);
  });

  $: if ($curFileFingerprint) {
    historyStack = [];
    futureStack = [];
    clearSelection();
  }

  const flattenTocItems = (
    items: TocEntry[],
    level = 1,
    parentId: string | null = null,
  ): FlatTocItem[] =>
    items.flatMap((item) => [
      {
        id: item.id,
        title: item.title,
        to: item.to,
        open: item.open,
        level,
        parentId,
      },
      ...flattenTocItems(item.children || [], level + 1, item.id),
    ]);

  function normalizeFlatLevels(items: FlatTocItem[]): FlatTocItem[] {
    return items.map((item, index) => {
      let level = Math.max(1, Math.floor(item.level) || 1);
      if (index === 0) {
        level = 1;
      } else {
        level = Math.min(level, items[index - 1].level + 1);
      }
      return {...item, level};
    });
  }

  function assignParentIdsFromLevels(items: FlatTocItem[]): FlatTocItem[] {
    const stack: {id: string; level: number}[] = [];

    return normalizeFlatLevels(items).map((item) => {
      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }

      const parentId = stack.length > 0 ? stack[stack.length - 1].id : null;
      const nextItem = {...item, parentId};
      stack.push({id: item.id, level: item.level});
      return nextItem;
    });
  }

  function buildTree(items: {title: string; level: number; page: number}[]) {
    const root: TocEntry[] = [];
    const stack: {node: TocEntry; level: number}[] = [];
    const uid = new ShortUniqueId({length: 10});

    items.forEach((item) => {
      const newItem: TocEntry = {
        id: uid.randomUUID(),
        title: item.title,
        to: Number(item.page) || 1,
        children: [],
        open: true,
      };

      if (item.page > $maxPage) $maxPage = item.page;

      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(newItem);
      } else {
        stack[stack.length - 1].node.children.push(newItem);
      }

      stack.push({node: newItem, level: item.level});
    });

    return root;
  }

  function buildTreeFromFlat(items: FlatTocItem[], forceOpenIds: Set<string> = new Set()): TocEntry[] {
    const root: TocEntry[] = [];
    const stack: {level: number; node: TocEntry}[] = [];

    for (const item of assignParentIdsFromLevels(items)) {
      const node: TocEntry = {
        id: item.id,
        title: item.title,
        to: item.to,
        open: forceOpenIds.has(item.id) ? true : (item.open ?? true),
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }

      stack.push({level: item.level, node});
    }

    return root;
  }

  function getFlatIndexMap(items: FlatTocItem[]) {
    return new Map(items.map((item, index) => [item.id, index]));
  }

  function getParentMap(items: FlatTocItem[]) {
    return new Map(items.map((item) => [item.id, item.parentId]));
  }

  function hasSelectedAncestor(
    id: string,
    selected: Set<string>,
    parentMap: Map<string, string | null>,
  ) {
    let currentId = parentMap.get(id) ?? null;

    while (currentId) {
      if (selected.has(currentId)) {
        return true;
      }
      currentId = parentMap.get(currentId) ?? null;
    }

    return false;
  }

  function getSelectedRootIds(items: FlatTocItem[], selected: Set<string>) {
    const parentMap = getParentMap(items);
    return items
      .filter((item) => selected.has(item.id) && !hasSelectedAncestor(item.id, selected, parentMap))
      .map((item) => item.id);
  }

  function getSubtreeEndIndex(items: FlatTocItem[], startIndex: number) {
    const startLevel = items[startIndex].level;
    let endIndex = startIndex + 1;

    while (endIndex < items.length && items[endIndex].level > startLevel) {
      endIndex += 1;
    }

    return endIndex;
  }

  function getPreviousSiblingIndex(items: FlatTocItem[], startIndex: number) {
    const currentLevel = items[startIndex].level;

    for (let index = startIndex - 1; index >= 0; index -= 1) {
      if (items[index].level === currentLevel) {
        return index;
      }
      if (items[index].level < currentLevel) {
        return null;
      }
    }

    return null;
  }

  function canDemoteSelectedRoot(
    items: FlatTocItem[],
    startIndex: number,
    selectedRootIds: Set<string>,
  ) {
    let currentIndex = startIndex;
    let previousSiblingIndex = getPreviousSiblingIndex(items, currentIndex);

    while (
      previousSiblingIndex !== null &&
      selectedRootIds.has(items[previousSiblingIndex].id)
    ) {
      currentIndex = previousSiblingIndex;
      previousSiblingIndex = getPreviousSiblingIndex(items, currentIndex);
    }

    return previousSiblingIndex !== null;
  }

  function getAncestorIds(items: FlatTocItem[], ids: Iterable<string>) {
    const parentMap = getParentMap(items);
    const ancestorIds = new Set<string>();

    for (const id of ids) {
      let currentId = parentMap.get(id) ?? null;
      while (currentId) {
        ancestorIds.add(currentId);
        currentId = parentMap.get(currentId) ?? null;
      }
    }

    return ancestorIds;
  }

  function selectRange(anchorId: string, targetId: string, mode: 'add' | 'remove' = 'add') {
    const flatItems = flattenTocItems($tocItems);
    const indexMap = getFlatIndexMap(flatItems);
    const anchorIndex = indexMap.get(anchorId);
    const targetIndex = indexMap.get(targetId);

    if (anchorIndex === undefined || targetIndex === undefined) return;

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const nextSelection = new Set(selectedIds);
    flatItems.slice(start, end + 1).forEach((flatItem) => {
      if (mode === 'remove') {
        nextSelection.delete(flatItem.id);
      } else {
        nextSelection.add(flatItem.id);
      }
    });
    selectedIds = nextSelection;
    selectionAnchorId = anchorId;
  }

  function handleSelectItem(item: TocEntry, event: MouseEvent) {
    window.getSelection()?.removeAllRanges();

    const flatItems = flattenTocItems($tocItems);
    const indexMap = getFlatIndexMap(flatItems);
    const clickedIndex = indexMap.get(item.id);

    if (clickedIndex === undefined) return;

    if (event.shiftKey) {
      const anchorId =
        selectionAnchorId && indexMap.has(selectionAnchorId) ? selectionAnchorId : item.id;
      selectRange(anchorId, item.id, selectedIds.has(item.id) ? 'remove' : 'add');
      return;
    }

    const nextSelection = new Set(selectedIds);
    if (nextSelection.has(item.id)) {
      nextSelection.delete(item.id);
    } else {
      nextSelection.add(item.id);
    }
    selectedIds = nextSelection;
    selectionAnchorId = item.id;
  }

  function handleSelectionDragStart(item: TocEntry, event: MouseEvent) {
    isSelectionDragging = true;
    selectionDragAnchorId = item.id;
    selectionAnchorId = item.id;
    selectionDragMode = selectedIds.has(item.id) ? 'remove' : 'add';

    selectRange(item.id, item.id, selectionDragMode);

    window.getSelection()?.removeAllRanges();
  }

  function handleSelectionDragEnter(item: TocEntry) {
    if (!isSelectionDragging || !selectionDragAnchorId) return;
    selectRange(selectionDragAnchorId, item.id, selectionDragMode);
  }

  function handleSelectionDragMove(event: MouseEvent) {
    if (!isSelectionDragging || !selectionDragAnchorId) return;

    const element = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-toc-item-id]');
    const itemId = element?.dataset.tocItemId;

    if (!itemId) return;
    selectRange(selectionDragAnchorId, itemId, selectionDragMode);
  }

  function adjustSelectedPageOffset(delta: number) {
    if (!delta || selectedIds.size === 0) return;

    saveHistory();
    const flatItems = flattenTocItems($tocItems);
    const selectedRootIds = new Set(getSelectedRootIds(flatItems, selectedIds));

    const updateRecursive = (items: TocEntry[], inSelectedSubtree = false): TocEntry[] =>
      items.map((item) => {
        const shouldApply = inSelectedSubtree || selectedRootIds.has(item.id);
        return {
          ...item,
          to: shouldApply ? Math.max(1, item.to + delta) : item.to,
          children: item.children?.length ? updateRecursive(item.children, shouldApply) : [],
        };
      });

    $tocItems = updateRecursive($tocItems);
  }

  function applyBatchOffset() {
    const delta = parseInt(batchOffsetInput, 10);
    if (Number.isNaN(delta) || delta === 0) return;

    adjustSelectedPageOffset(delta);
    batchOffsetInput = '';
    showBatchOffsetEditor = false;
  }

  function adjustSelectedLevels(delta: -1 | 1) {
    if (selectedIds.size === 0) return;

    const originalFlatItems = normalizeFlatLevels(flattenTocItems($tocItems));
    const flatItems = [...originalFlatItems];
    const selectedRootIds = getSelectedRootIds(originalFlatItems, selectedIds);
    const selectedRootIdSet = new Set(selectedRootIds);
    const indexMap = getFlatIndexMap(originalFlatItems);
    let hasChanges = false;

    for (const id of selectedRootIds) {
      const startIndex = indexMap.get(id);
      if (startIndex === undefined) continue;

      if (delta === -1 && originalFlatItems[startIndex].level <= 1) continue;
      if (
        delta === 1 &&
        !canDemoteSelectedRoot(originalFlatItems, startIndex, selectedRootIdSet)
      ) {
        continue;
      }

      const endIndex = getSubtreeEndIndex(originalFlatItems, startIndex);
      for (let index = startIndex; index < endIndex; index += 1) {
        flatItems[index] = {
          ...flatItems[index],
          level: flatItems[index].level + delta,
        };
      }
      hasChanges = true;
    }

    if (!hasChanges) return;

    const nextFlatItems = assignParentIdsFromLevels(flatItems);
    const forceOpenIds = getAncestorIds(nextFlatItems, selectedRootIds);

    saveHistory();
    $tocItems = buildTreeFromFlat(nextFlatItems, forceOpenIds);
  }

  async function handleAiFormat() {
    if (!text.trim()) return;

    if (requiresUserApiKeyForModel(apiConfig.provider, apiConfig.apiKey, apiConfig.modelOverrides)) {
      throw new Error($t('error.custom_model_needs_api_key'));
    }

    const MAX_TEXT_SIZE = 128 * 1024;
    const byteSize = new TextEncoder().encode(text).length;

    if (byteSize > MAX_TEXT_SIZE) {
      throw new Error(`Text content is too large. Limit is 128KB.`);
    }

    isProcessing = true;
    let aiResult;

    try {
      const response = await fetch('/api/process-toc', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          text: text,
          apiKey: apiConfig.apiKey,
          provider: apiConfig.provider,
          customBaseUrl: apiConfig.customBaseUrl,
          doubaoEndpointIdText: apiConfig.doubaoEndpointIdText,
          doubaoEndpointIdVision: apiConfig.doubaoEndpointIdVision,
          modelOverrides: apiConfig.modelOverrides,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || 'AI processing failed');
      }

      aiResult = await response.json();
    } finally {
      isProcessing = false;
    }

    if (Array.isArray(aiResult) && aiResult.length > 0) {
      const nestedItems = buildTree(aiResult);
      dispatch('aiFormatResponse', {
        items: nestedItems,
      });
    } else {
      throw new Error('AI could not parse any ToC structure.');
    }
  }

  function parseText(text: string) {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const items: TocEntry[] = [];
    const stack = [{level: 0, item: {children: items}}];
    const uid = new ShortUniqueId({length: 10});

    lines.forEach((line) => {
      const match = line.match(/^(\d+(?:\.\d+)*)\s+(.*?)\s+(-?\d+)$/);
      if (match) {
        const [, number, title, pageStr] = match;
        const level = number.split('.').length;
        const page = parseInt(pageStr, 10);

        const newItem: TocEntry = {
          id: uid.randomUUID(),
          title,
          to: page,
          children: [],
          open: true,
        };

        if (page > $maxPage) $maxPage = page;

        while (stack[stack.length - 1].level >= level) stack.pop();
        stack[stack.length - 1].item.children.push(newItem);
        stack.push({level, item: newItem});
      }
    });
    return items;
  }

  function generateText(items: TocEntry[], prefix = '') {
    return items
      .map((item, index) => {
        const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
        let txt = `${number} ${item.title} ${item.to}`;
        if (item.children?.length) txt += '\n' + generateText(item.children, number);
        return txt;
      })
      .join('\n');
  }

  function handleInput(e: Event) {
    isUpdatingFromEditor = true;
    text = (e.target as HTMLTextAreaElement).value;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const parsed = parseText(text);
      if (parsed.length > 0) {
        $tocItems = parsed;
      }
      tick().then(() => {
        isUpdatingFromEditor = false;
      });
    }, 300);
  }

  const handleDragStart = () => {
    if (!isDragging) {
      saveHistory();
      $autoSaveEnabled = false;
      isDragging = true;
    }
  };

  const handleDragEnd = () => {
    tick().then(() => {
      isDragging = false;
      const newText = generateText($tocItems);
      if (newText !== text) text = newText;
      $autoSaveEnabled = true;
    });
  };

  function handleMouseUp() {
    $dragDisabled = true;
    isSelectionDragging = false;
    selectionDragAnchorId = null;
  }

  function handleDndConsider(e: CustomEvent<{items: TocEntry[]}>) {
    handleDragStart();
    $tocItems = e.detail.items;
  }

  function handleDndFinalize(e: CustomEvent<{items: TocEntry[]}>) {
    $tocItems = e.detail.items;
    handleDragEnd();
  }

  $: if (!isDragging) {
    const allIds = new Set(flattenTocItems($tocItems).map((item) => item.id));
    const nextSelection = new Set([...selectedIds].filter((id) => allIds.has(id)));
    const selectionChanged =
      nextSelection.size !== selectedIds.size ||
      [...nextSelection].some((id) => !selectedIds.has(id));

    if (selectionChanged) {
      selectedIds = nextSelection;
    }

    if (selectionAnchorId && !allIds.has(selectionAnchorId)) {
      selectionAnchorId = null;
    }
  }

  $: firstItemWithChildrenId = (() => {
    const findFirst = (items: TocEntry[]): string | null => {
      for (const item of items) {
        if (item.children?.length > 0) return item.id;
        if (item.children) {
          const childResult = findFirst(item.children);
          if (childResult) return childResult;
        }
      }
      return null;
    };
    return findFirst($tocItems);
  })();

  // ---- 焦点条目（插入锚点）状态 ----
  // 记录用户最后单击的目录条目 id。"添加章节/上方插入"按钮都以它为锚点：
  // 单击某条目录后，新条目会紧挨着它插入（同层级），满足"在序言/前言区域连续补条目"的场景。
  let focusedItemId: string | null = null;

  function handleFocusItem(item: TocEntry) {
    focusedItemId = item.id;
  }

  // 插入新条目后自动聚焦其标题输入框，方便连续录入（如逐条补前言、序言条目）
  async function focusNewItemTitle(id: string) {
    await tick();
    const input = document.querySelector<HTMLInputElement>(
      `[data-toc-item-id="${id}"] .toc-item-title`,
    );
    input?.focus();
  }

  /**
   * 在焦点条目的上/下方紧挨着插入一条同层级的新书签。
   *
   * 实现思路：目录树 → 扁平列表（含层级）→ 插入 → 重建树。
   * 复用现有的 flattenTocItems / buildTreeFromFlat，保证与搜索、批量操作等逻辑一致。
   *
   * 边界说明：
   * - 若焦点条目带有子节点，插到其"下方"时新条目会成为它的兄弟节点，
   *   而不是它的第一个子节点（扁平列表按深度优先顺序展开，同级插入自然截断子树归属）。
   * - 新条目页码默认与锚点相同：插入场景多在序言/前言附近，页码接近锚点，
   *   不做 +1 猜测，用户可直接修改页码输入框。
   * - 无焦点时"下方插入"退化为旧行为（追加到目录末尾），保证空目录时也能添加第一条。
   */
  const insertTocItemAtAnchor = (position: 'above' | 'below') => {
    saveHistory();
    const flatItems = flattenTocItems($tocItems);
    const uid = new ShortUniqueId({length: 10});

    // 空目录：直接追加一条根级条目（沿用旧的起始页码规则）
    if (flatItems.length === 0) {
      const newItem = {
        id: uid.randomUUID(),
        title: '',
        to: ($maxPage || 0) + 1,
        children: [],
        open: true,
      };
      $tocItems = [newItem];
      focusedItemId = newItem.id;
      focusNewItemTitle(newItem.id);
      return;
    }

    const anchorIndex = focusedItemId
      ? flatItems.findIndex((flatItem) => flatItem.id === focusedItemId)
      : -1;

    // 无焦点（或焦点条目已被删除）：仅"下方插入"可用，退化为追加到末尾
    if (anchorIndex === -1) {
      if (position === 'below') {
        const startPage = Math.max(...flatItems.map((flatItem) => flatItem.to)) + 1;
        const newItem = {
          id: uid.randomUUID(),
          title: '',
          to: startPage,
          children: [],
          open: true,
        };
        $tocItems = [...$tocItems, newItem];
        focusedItemId = newItem.id;
        focusNewItemTitle(newItem.id);
      }
      return;
    }

    const anchor = flatItems[anchorIndex];
    const newItem = {
      id: uid.randomUUID(),
      title: '',
      to: anchor.to,
      open: true,
      level: anchor.level,
      parentId: anchor.parentId,
    };

    // above → 插在锚点前；below → 插在锚点后（若锚点有子节点，新条目为其兄弟节点）
    const insertIndex = position === 'below' ? anchorIndex + 1 : anchorIndex;
    const newFlatItems = [
      ...flatItems.slice(0, insertIndex),
      newItem,
      ...flatItems.slice(insertIndex),
    ];

    $tocItems = buildTreeFromFlat(newFlatItems);
    focusedItemId = newItem.id;
    focusNewItemTitle(newItem.id);
  };

  // ---- 智能添加书签 ----
  /**
   * 计算当前"所选页"对应的目录逻辑页码；无法确定唯一页时返回 null。
   *
   * 两种来源（用户在右侧操作）：
   * - 预览模式：正在浏览的那一页（pdfState.currentPage，预览文档物理页，
   *   可能包含插入的目录页偏移），需反向换算回内容逻辑页码。
   * - 编辑模式：页面网格中框选的唯一页（gridSelectedPage，原始 PDF 内容物理页）。
   *   多选或未选时上游传 null，直接禁用按钮。
   *
   * 换算关系来自 TocItem 的正向映射：
   *   预览物理页 = (to + pageOffset) (+ tocPageCount，当内容物理页 >= insertAtPage)
   */
  $: smartInsertLogicalPage = (() => {
    if (isPreview) {
      if (!currentPage || currentPage < 1) return null;
      const contentPhysical =
        currentPage >= insertAtPage ? currentPage - tocPageCount : currentPage;
      const logical = contentPhysical - pageOffset;
      return logical >= 1 ? logical : null;
    }
    if (gridSelectedPage && gridSelectedPage >= 1) {
      const logical = gridSelectedPage - pageOffset;
      return logical >= 1 ? logical : null;
    }
    return null;
  })();

  /**
   * 计算智能插入的扁平列表位置。核心原则：让新书签落在"页码顺序 + 层级归属"都正确的缝隙里。
   *
   * 依次尝试以下定位策略（targetLevel 为用户点选的书签级别，newPage 为所选页逻辑页码）：
   * 1. 同级后继：第一个"同级且页码更大"的条目 → 插在它前面。
   *    这同时天然避开了前一个同级条目的子树（子树在扁平列表中紧跟其后、
   *    且都在新条目之前），例如插到 1.2 的子树之后、1.3 之前。
   * 2. 同级前驱：最后一个"同级且页码不晚于 newPage"的条目 → 跳过它的整个子树后插入，
   *    成为它的紧邻兄弟（而不是误入其子树或截断后续层级）。
   * 3. 无同级参照：找页码不晚于 newPage 的最近上一级条目 → 插到它子树的末尾，
   *    成为它的最后一个子节点（对应"放到第 1 章下面"的需求）。
   * 4. 兜底：插到第一个"层级不超过目标且页码更大"的条目前；都没有则追加到末尾。
   *    （buildTreeFromFlat 内部的 normalize 会把无父可依的深层级自动降级挂靠，保证结构合法。）
   */
  /**
   * 计算智能插入的扁平列表位置。
   *
   * 核心思路（逐级确定祖先）：从 1 级开始，逐级向下检测，直到目标层级。
   * 每一级都在当前已确定的祖先子树范围内，找"页码不晚于 newPage 的最后一个该级条目"作为这一级的祖先，
   * 然后把搜索范围缩小到它的子树。这样无论目录有多深、跨了多少个子树，都能彻底搞清楚新条目的归属。
   *
   * 例：插 3 级书签时，先确定它归哪个 1 级（第几章），再在该章范围内确定归哪个 2 级（第几节），
   * 最后在该节范围内找 3 级的精确插入点。避免了旧版"只看相邻层级、跨子树时挂错父节点"的 bug。
   *
   * 边界：
   * - 某级找不到合适祖先时，新条目插在当前范围起点；buildTreeFromFlat 的 normalize 会把
   *   无父可依的深层级自动降级挂靠（如没有 2 级祖先时，3 级条目降为 2 级挂在 1 级下），保证结构合法。
   * - 空目录时返回 0，插在开头。
   */
  function computeSmartInsertIndex(flatItems: FlatTocItem[], targetLevel: number, newPage: number): number {
    // rangeStart/rangeEnd：当前确定的祖先子树在扁平列表中的范围（不含祖先本身）
    let rangeStart = 0;
    let rangeEnd = flatItems.length;

    // 从 1 级逐级检测到 targetLevel-1 级，每级确定一个祖先并缩小范围到其子树
    for (let lvl = 1; lvl < targetLevel; lvl++) {
      // 在当前范围内找最后一个 level===lvl 且 to<=newPage 的条目，作为这一级的祖先
      let ancestorIdx = -1;
      for (let i = rangeStart; i < rangeEnd; i++) {
        if (flatItems[i].level === lvl && flatItems[i].to <= newPage) ancestorIdx = i;
      }
      // 该层级没有合适祖先 → 新条目无法挂到 targetLevel 级，
      // 插在当前范围起点，由 buildTreeFromFlat 自动降级处理
      if (ancestorIdx === -1) return rangeStart;

      // 缩小范围到该祖先的子树（子树 = 祖先之后、到下一个不比它深的条目之前）
      rangeStart = ancestorIdx + 1;
      rangeEnd = ancestorIdx + 1;
      while (rangeEnd < flatItems.length && flatItems[rangeEnd].level > lvl) rangeEnd++;
    }

    // 此时 [rangeStart, rangeEnd) 是 targetLevel-1 级祖先的子树范围
    // 在该范围内找插入位置：第一个"同级且页码更大"的条目前（策略：同级后继）
    for (let i = rangeStart; i < rangeEnd; i++) {
      if (flatItems[i].level === targetLevel && flatItems[i].to > newPage) return i;
    }
    // 没有同级后继 → 插在该子树末尾（成为最后一个子节点）
    return rangeEnd;
  }

  /**
   * 智能添加书签：以右侧所选页为页码，按用户指定的级别插入到最合适的位置。
   * 插入后新条目自动成为焦点锚点并聚焦标题输入框，方便立即命名。
   */
  const smartInsertBookmark = (targetLevel: number) => {
    const newPage = smartInsertLogicalPage;
    if (!newPage) return;

    saveHistory();
    const flatItems = flattenTocItems($tocItems);
    const uid = new ShortUniqueId({length: 10});
    const newItem: FlatTocItem = {
      id: uid.randomUUID(),
      title: '',
      to: newPage,
      open: true,
      level: targetLevel,
      parentId: null,
    };

    const insertIndex = computeSmartInsertIndex(flatItems, targetLevel, newPage);
    const newFlatItems = [
      ...flatItems.slice(0, insertIndex),
      newItem,
      ...flatItems.slice(insertIndex),
    ];

    // 自动展开新条目的所有祖先节点，让新插入的子级书签立即可见。
    // 思路：在扁平列表里，新条目的祖先就是它前面那些"层级比它浅"的条目中，
    // 距离它最近的各级祖先。这里用栈模拟深度优先的父子关系来收集祖先 id。
    // buildTreeFromFlat 的 forceOpenIds 参数会让这些祖先节点强制 open=true。
    const forceOpenIds = new Set<string>();
    if (targetLevel > 1) {
      const ancestorStack: {level: number; id: string}[] = [];
      for (let i = 0; i < insertIndex; i++) {
        const fi = newFlatItems[i];
        // 弹出栈顶所有层级不比当前浅的节点（它们不是 fi 的祖先）
        while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].level >= fi.level) {
          ancestorStack.pop();
        }
        ancestorStack.push({level: fi.level, id: fi.id});
      }
      // 此时栈中从底到顶就是新条目的祖先链（不含新条目本身）
      for (const ancestor of ancestorStack) {
        if (ancestor.level < targetLevel) forceOpenIds.add(ancestor.id);
      }
    }

    $tocItems = buildTreeFromFlat(newFlatItems, forceOpenIds);
    focusedItemId = newItem.id;
    focusNewItemTitle(newItem.id);
  };

  const toggleAll = (open: boolean) => {
    flipDurationMs = 0;
    const updateRecursive = (items: TocEntry[]): TocEntry[] =>
      items.map((item) => ({
        ...item,
        open,
        children: item.children?.length ? updateRecursive(item.children) : [],
      }));
    $tocItems = updateRecursive($tocItems);
    tick().then(() => {
      setTimeout(() => {
        flipDurationMs = 200;
      }, 50);
    });
  };

  const expandAll = () => toggleAll(true);
  const collapseAll = () => toggleAll(false);

  $: flatTocItems = flattenTocItems($tocItems);
  $: tocMaxLevel = flatTocItems.reduce((max, item) => Math.max(max, item.level), 0);
  $: showTocSearch = flatTocItems.length > 10 && tocMaxLevel >= 2;
  $: normalizedTocSearch = tocSearchQuery.trim().toLowerCase();
  $: searchMatchedIds = new Set(
    normalizedTocSearch
      ? flatTocItems
          .filter((item) => `${item.title} ${item.to}`.toLowerCase().includes(normalizedTocSearch))
          .map((item) => item.id)
      : [],
  );
  $: searchOpenIds = normalizedTocSearch ? getAncestorIds(flatTocItems, searchMatchedIds) : new Set<string>();
  $: displayedTocItems = normalizedTocSearch
    ? filterTocItemsForSearch($tocItems, searchMatchedIds, searchOpenIds)
    : $tocItems;

  function filterTocItemsForSearch(
    items: TocEntry[],
    matchedIds: Set<string>,
    ancestorIds: Set<string>,
  ): TocEntry[] {
    return items.flatMap((item) => {
      if (!matchedIds.has(item.id) && !ancestorIds.has(item.id)) {
        return [];
      }

      return [{
        ...item,
        open: ancestorIds.has(item.id) ? true : item.open,
        children: item.children?.length
          ? filterTocItemsForSearch(item.children, matchedIds, ancestorIds)
          : [],
      }];
    });
  }

  $: hasAnyExpanded = $tocItems.some((item: TocEntry) => item.open);
  $: selectedCount = selectedIds.size;
  $: if (selectedCount === 0) {
    showBatchOffsetEditor = false;
    batchOffsetInput = '';
  }

  const updateTocItem = (item: TocEntry, updates: Partial<TocEntry>, skipHistory = false) => {
    if (!skipHistory) {
      saveHistory();
    }
    const updateItemRecursive = (items: TocEntry[]): TocEntry[] =>
      items.map((currentItem) => {
        if (currentItem.id === item.id) return {...currentItem, ...updates};
        if (currentItem.children?.length) {
          return {...currentItem, children: updateItemRecursive(currentItem.children)};
        }
        return currentItem;
      });
    $tocItems = updateItemRecursive($tocItems);
  };

  const deleteTocItem = (itemToDelete: TocEntry) => {
    saveHistory();
    const deleteItemRecursive = (items: TocEntry[]): TocEntry[] =>
      items
        .filter((item) => item.id !== itemToDelete.id)
        .map((item) => ({
          ...item,
          children: item.children?.length ? deleteItemRecursive(item.children) : [],
        }));

    $tocItems = deleteItemRecursive($tocItems);
  };

  function deleteSelectedTocItems() {
    if (selectedIds.size === 0) return false;

    const flatItems = flattenTocItems($tocItems);
    const selectedRootIds = new Set(getSelectedRootIds(flatItems, selectedIds));
    if (selectedRootIds.size === 0) return false;

    saveHistory();
    const deleteItemsRecursive = (items: TocEntry[]): TocEntry[] =>
      items
        .filter((item) => !selectedRootIds.has(item.id))
        .map((item) => ({
          ...item,
          children: item.children?.length ? deleteItemsRecursive(item.children) : [],
        }));

    $tocItems = deleteItemsRecursive($tocItems);
    clearSelection();
    return true;
  }

  const TOC_REGEX = /^(\d+(?:\.\d+)*)\s+(.*?)\s+(-?\d+)$/;

  $: hasInvalidLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => !TOC_REGEX.test(line));

  $: promptTooltipText = $t('toc.prompt_intro');
  let innerWidth: number;
</script>

<svelte:window
  on:keydown={handleKeydown}
  on:mousemove={handleSelectionDragMove}
  on:mouseup={handleMouseUp}
  on:touchend={handleMouseUp}
  bind:innerWidth
/>

<div class="flex flex-col gap-4 mt-3">
  <div class="h-48 relative group">
    <textarea
      placeholder={$t('toc.outline_placeholder')}
      bind:value={text}
      on:input={handleInput}
      class="w-full h-full border-2 border-black rounded-lg p-2 text-sm myfocus leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none pr-10"
    ></textarea>

    {#if hasInvalidLines}
      <div class="absolute bottom-3 right-3">
        <Tooltip
          isTextCopiable
          width="md:w-[350px] w-[250px]"
          text={promptTooltipText}
          position={innerWidth < 1024 ? '-200 -500' : '100 -600'}
        >
          <button
            on:click={handleAiFormat}
            disabled={isProcessing || !text.trim()}
            class="flex items-center gap-1.5 bg-gradient-to-br from-blue-300 to-pink-600 text-white px-3 py-1.5 rounded-md shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
          >
            {#if isProcessing}
              <Loader2
                size={16}
                class="animate-spin"
              />
              <span class="text-xs font-bold">Processing...</span>
            {:else}
              <Sparkles size={16} />
              <span class="text-xs font-bold">AI Format</span>
            {/if}
          </button>
        </Tooltip>
      </div>
    {/if}
  </div>

  <div class="md:-ml-12 -ml-6 group/toc-list pt-2 relative">
    {#if $tocItems.length > 0}
      <div
        class="flex items-center gap-1 sticky top-12 z-20 opacity-0 group-hover/toc-list:opacity-100 transition-all duration-300 translate-y-1 group-hover/toc-list:translate-y-0 pointer-events-none"
      >
        {#if firstItemWithChildrenId}
          <div class="-ml-2.5 -mb-8 pointer-events-auto bg-white/50 backdrop-blur-sm rounded-md shadow-sm">
            {#if hasAnyExpanded}
              <button
                on:click={collapseAll}
                class="p-1 rounded-md text-gray-500 hover:text-gray-700 transition-colors"
                title={$t('toc.collapse_all')}
              >
                <ChevronsDownUp size={17} font-weight={600} />
              </button>
            {:else}
              <button
                on:click={expandAll}
                class="p-1 rounded-md text-gray-500 hover:text-gray-700 transition-colors"
                title={$t('toc.expand_all')}
              >
                <ChevronsUpDown size={17} font-weight={600} />
              </button>
            {/if}
          </div>
        {/if}
      </div>

      {#if selectedCount >= 1 || showTocSearch}
        <div class="sticky top-12 z-30 mb-3 ml-12 pointer-events-none">
          <div class="pointer-events-auto flex flex-col gap-2">
            {#if selectedCount >= 1}
              <div class="flex flex-wrap items-center gap-2 bg-white/35 backdrop-blur-sm border-2 border-black/95 rounded-lg px-3 py-2">
                <span class="text-xs font-semibold text-gray-700">
                  {$t('toc.batch_operations')} {$t('toc.selected_count', {values: {count: selectedCount}})}
                </span>
                <button
                  on:click={clearSelection}
                  class="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold border-2 border-transparent rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  title={$t('toc.clear_selection')}
                >
                  <X size={14} />
                  {$t('toc.clear_selection')}
                </button>
                <div class="flex items-center gap-2">
                  <button
                    on:click={() => adjustSelectedLevels(-1)}
                    title={$t('toc.promote_selected_hint')}
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue-400 text-black border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                  >
                    <ArrowUp size={14} />
                    {$t('toc.promote_selected')}
                  </button>
                  <button
                    on:click={() => adjustSelectedLevels(1)}
                    title={$t('toc.demote_selected_hint')}
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-lime-400 text-black border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                  >
                    <ArrowDown size={14} />
                    {$t('toc.demote_selected')}
                  </button>

                  {#if showBatchOffsetEditor}
                    <div class="flex items-center gap-2">
                      <input
                        type="number"
                        bind:value={batchOffsetInput}
                        placeholder={$t('toc.offset_placeholder')}
                        on:keydown={(e) => e.key === 'Enter' && applyBatchOffset()}
                        class="w-20 border-2 border-black rounded px-2 py-1.5 text-xs myfocus focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        on:click={applyBatchOffset}
                        title={$t('toc.apply_offset_hint')}
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-yellow-400 text-black border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                      >
                        <Hash size={14} />
                        {$t('toc.apply_offset')}
                      </button>
                    </div>
                  {:else}
                    <button
                      on:click={() => {
                        showBatchOffsetEditor = true;
                        batchOffsetInput = '';
                      }}
                      title={$t('toc.offset_selected_hint')}
                      class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-yellow-400 text-black border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                    >
                      <Hash size={14} />
                      {$t('toc.offset_selected')}
                    </button>
                  {/if}
                </div>
              </div>
            {/if}

            {#if showTocSearch}
              <div class="bg-white/70 backdrop-blur-sm border-2 border-black rounded-lg px-2 py-1.5 flex items-center gap-2">
                <Search size={15} class="text-gray-500 shrink-0" />
                <input
                  type="text"
                  bind:value={tocSearchQuery}
                  placeholder={$t('toc.search_placeholder') || 'Search ToC...'}
                  class="min-w-0 flex-1 bg-transparent outline-none text-sm placeholder:text-gray-400"
                />
                {#if tocSearchQuery}
                  <button
                    type="button"
                    on:click={() => (tocSearchQuery = '')}
                    class="p-1 text-gray-500 hover:text-black"
                    title={$t('toc.clear_search') || 'Clear search'}
                  >
                    <X size={14} />
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if showNavHint}
        <div class="absolute right-0 top-0 z-50 h-6 flex justify-center pointer-events-none">
          <div
            transition:fly={{y: -10, duration: 300}}
            class="bg-black/50 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-lg pointer-events-none"
          >
            {$t('toc.nav_hint')}
          </div>
        </div>
      {/if}

      <section
        use:dndzone={{
          items: displayedTocItems,
          flipDurationMs,
          dragDisabled: $dragDisabled || Boolean(normalizedTocSearch),
          dropTargetStyle: {outline: '2px dashed #000', borderRadius: '8px'},
        }}
        on:consider={handleDndConsider}
        on:finalize={handleDndFinalize}
        class="min-h-[20px]"
      >
        {#each displayedTocItems as item, i (`${item.id}${item[SHADOW_ITEM_MARKER_PROPERTY_NAME] ? `_${item[SHADOW_ITEM_MARKER_PROPERTY_NAME]}` : ''}`)}
          <div animate:flip={{duration: flipDurationMs}}>
            <TocItem
              {item}
              {flipDurationMs}
              onUpdate={updateTocItem}
              onDelete={deleteTocItem}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onSelect={handleSelectItem}
              onFocus={handleFocusItem}
              focusedId={focusedItemId}
              onSelectionDragStart={handleSelectionDragStart}
              onSelectionDragEnter={handleSelectionDragEnter}
              {currentPage}
              {isPreview}
              {pageOffset}
              {insertAtPage}
              {tocPageCount}
              {selectedIds}
              searchQuery={tocSearchQuery}
              on:showNavHint={handleShowNavHint}
              on:jumpToPage={(e: CustomEvent<{to: number}>) => {
                dispatch('jumpToPage', e.detail);
              }}
              index={i + 1}
            />
          </div>
        {/each}
      </section>
    {/if}

    <!--
      插入操作按钮条：
      使用 sticky bottom-0 将整条按钮钉在滚动视口底部——目录再长、滚到多深，
      按钮都始终可见，解决旧版"按钮在目录末尾、识别出目录后基本看不到"的问题。
      半透明白底 + 毛玻璃，避免与下方滚过的列表文字混叠。
      第一行：基于焦点锚点的上/下方插入；第二行：基于右侧所选页的智能添加书签。
    -->
    <div
      class="sticky bottom-0 z-30 ml-12 mt-3 py-2 px-1 -mx-1 bg-white/90 backdrop-blur-sm rounded-lg"
    >
      <div class="flex items-center gap-2">
        <button
          on:click={() => insertTocItemAtAnchor('below')}
          class="btn font-bold bg-yellow-400 text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all flex-1 w-full"
          title={$t('toc.insert_below_hint')}
        >
          {$t('btn.add_chapter')}
        </button>
        <!-- 上方插入：必须先单击某条目录形成焦点锚点才可用 -->
        <button
          on:click={() => insertTocItemAtAnchor('above')}
          disabled={!focusedItemId}
          class="btn font-bold bg-violet-300 text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all flex-1 w-full disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:cursor-not-allowed"
          title={focusedItemId ? $t('toc.insert_above_hint') : $t('toc.insert_need_focus')}
        >
          {$t('toc.insert_above')}
        </button>
      </div>

      <!--
        智能添加书签行：
        左侧仅保留"智能添加书签"短文案，并用 Tooltip 包裹它——
        悬浮在该文案上才显示详细使用说明气泡；4 个级别按钮不触发气泡。
        右侧 4 个级别按钮对应 1~4 级书签。
        仅当右侧确定了唯一目标页（预览模式的当前页 / 编辑模式网格框选的单页）时按钮才可用；
        点击后按页码 + 级别自动计算插入位置（见 computeSmartInsertIndex）。
      -->
      <div class="flex items-center gap-3 mt-2">
        <Tooltip
          text={$t('toc.smart_add_tooltip')}
          position="top"
          width="md:w-[340px] w-[240px]"
          color="bg-white/90"
          constrainToViewport={true}
        >
          <span class="text-sm font-semibold text-gray-700 select-none cursor-help whitespace-nowrap">
            {$t('toc.smart_add_label')}
          </span>
        </Tooltip>
        <div class="flex items-center gap-1.5 ml-auto">
          {#each [1, 2, 3, 4] as level (`${level}`)}
            <button
              on:click={() => smartInsertBookmark(level)}
              disabled={!smartInsertLogicalPage}
              class="btn font-bold text-xs bg-blue-300 text-black border-2 border-black rounded-lg px-3 py-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:cursor-not-allowed"
              title={smartInsertLogicalPage
                ? $t('toc.smart_add_hint', {values: {level, page: smartInsertLogicalPage}})
                : $t('toc.smart_add_no_page')}
            >
              {$t('toc.smart_add_level', {values: {level}})}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
