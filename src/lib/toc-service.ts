import type * as PdfjsLibTypes from 'pdfjs-dist';
import {get} from 'svelte/store';
import {_} from 'svelte-i18n';

import {requiresUserApiKeyForModel, type ModelOverrides} from '$lib/llm/core';
import type {RecognitionIgnoreRegion} from '$lib/pdf/recognition-ignore';

import {pdfService} from '../stores';

// 分块大小：每批最多发给 AI 的页面数。
// 旧值 8 意味着 ≤8 页一次性识别，四五页目录不分块，单次输出 JSON 容易触发
// 模型自身的 token 上限被截断。改为 4：5 页会分成 4+1 两批，每批输出量更小，
// 降低被截断的风险；同时每批识别完立即回调进度，让用户看到逐批累积的过程。
export const CHUNK_SIZE = 4;
// 需要自带 API Key 的页数阈值（超过该页数且未提供 key 时提示用户）
export const LARGE_PAGE_THRESHOLD = 8;

export const ERROR_NEEDS_API_KEY = 'NEEDS_API_KEY';

export interface ChunkFailure {
  start: number;
  end: number;
  error: string;
}

interface AiTocOptions {
  pdfInstance: PdfjsLibTypes.PDFDocumentProxy;
  ranges?: { start: number; end: number }[];
  startPage?: number;
  endPage?: number;
  apiKey?: string;
  provider?: string;
  customBaseUrl?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
  modelOverrides?: ModelOverrides;
  visionPrompt?: string;
  recognitionIgnoreRegions?: RecognitionIgnoreRegion[];
  onProgress?: (current: number, total: number) => void;
}

export interface GenerateTocResult {
  items: any[];
  chunkFailures: ChunkFailure[];
}

function t(key: string, values?: Record<string, string | number>): string {
  return get(_)(key, { values }) as string;
}

async function fetchChunk(
  images: string[],
  apiKey: string | undefined,
  provider: string | undefined,
  customBaseUrl: string | undefined,
  doubaoEndpointIdText: string | undefined,
  doubaoEndpointIdVision: string | undefined,
  modelOverrides: ModelOverrides | undefined,
  visionPrompt: string | undefined,
): Promise<any[]> {
  if (requiresUserApiKeyForModel(provider, apiKey, modelOverrides)) {
    throw new Error(t('error.custom_model_needs_api_key'));
  }

  const response = await fetch('/api/process-toc', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      images,
      apiKey,
      provider,
      customBaseUrl,
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
      modelOverrides,
      visionPrompt,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    let friendlyMessage = err.message || t('error.ai_failed');

    if (response.status >= 500 && response.status < 600) {
      const p = provider || 'Unknown Provider';
      const providerName = p.charAt(0).toUpperCase() + p.slice(1);
      friendlyMessage = t('error.try_other_model', { provider: providerName, message: friendlyMessage });
    } else if (response.status === 413) {
      friendlyMessage = t('error.request_too_large');
    } else if (response.status === 429 && !apiKey) {
      friendlyMessage = t('error.daily_limit_exceeded');
    }
    throw new Error(friendlyMessage);
  }

  return response.json();
}

export async function generateToc(
  { pdfInstance, ranges, startPage, endPage, apiKey, provider, customBaseUrl, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides, visionPrompt, recognitionIgnoreRegions = [], onProgress }: AiTocOptions
): Promise<GenerateTocResult> {

  // Normalize ranges
  let finalRanges: { start: number; end: number }[] = [];
  if (ranges && ranges.length > 0) {
    finalRanges = ranges;
  } else if (startPage !== undefined && endPage !== undefined) {
    finalRanges = [{ start: startPage, end: endPage }];
  } else {
    throw new Error(t('error.no_page_ranges'));
  }

  const service = get(pdfService);
  if (!service) {
    throw new Error(t('error.pdf_service_not_init'));
  }

  // Collect all page images with their physical page numbers
  interface PageEntry { pageNum: number; image: string }
  const pageEntries: PageEntry[] = [];
  let currentTotalSize = 0;
  const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;

  for (const range of finalRanges) {
    if (range.end < range.start) continue;
    for (let pageNum = range.start; pageNum <= range.end; pageNum++) {
      const image = await service.getPageAsImage(pdfInstance, pageNum, 1.5, 2048, recognitionIgnoreRegions);
      currentTotalSize += image.length;
      if (currentTotalSize > MAX_PAYLOAD_SIZE * CHUNK_SIZE) {
        throw new Error(t('error.payload_too_large'));
      }
      pageEntries.push({ pageNum, image });
    }
  }

  if (pageEntries.length === 0) {
    throw new Error(t('error.no_valid_pages'));
  }

  const totalPages = pageEntries.length;

  if (totalPages > LARGE_PAGE_THRESHOLD && !apiKey) {
    const err = new Error(t('error.needs_api_key')) as any;
    err.code = ERROR_NEEDS_API_KEY;
    throw err;
  }

  if (totalPages <= CHUNK_SIZE) {
    onProgress?.(1, 1);
    const items = await fetchChunk(
      pageEntries.map(e => e.image),
      apiKey, provider, customBaseUrl, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides, visionPrompt
    );
    return { items: Array.isArray(items) ? items : [], chunkFailures: [] };
  }

  const chunks: PageEntry[][] = [];
  for (let i = 0; i < pageEntries.length; i += CHUNK_SIZE) {
    chunks.push(pageEntries.slice(i, i + CHUNK_SIZE));
  }

  const totalChunks = chunks.length;
  const allItems: (any[] | null)[] = new Array(totalChunks).fill(null);
  const chunkFailures: ChunkFailure[] = [];
  let completedChunks = 0;

  // 串行逐批处理（而非并行）：每批识别完立即回调进度，让用户看到"逐批累积"的过程；
  // 同时避免并行请求触发 API 限流。每批失败会重试一次，最终按原始顺序合并所有批次结果。
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkStart = chunk[0].pageNum;
    const chunkEnd = chunk[chunk.length - 1].pageNum;
    const images = chunk.map(e => e.image);

    let result: any[] | null = null;

    // First attempt
    try {
      result = await fetchChunk(images, apiKey, provider, customBaseUrl, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides, visionPrompt);
    } catch (_firstErr) {
      // Retry once
      try {
        result = await fetchChunk(images, apiKey, provider, customBaseUrl, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides, visionPrompt);
      } catch (retryErr: any) {
        chunkFailures.push({
          start: chunkStart,
          end: chunkEnd,
          error: retryErr.message || t('error.ai_failed'),
        });
      }
    }

    if (result && Array.isArray(result)) {
      allItems[i] = result;
    }

    completedChunks++;
    onProgress?.(completedChunks, totalChunks);
  }

  const mergedItems = allItems.flatMap(r => (Array.isArray(r) ? r : []));

  return { items: mergedItems, chunkFailures };
}
