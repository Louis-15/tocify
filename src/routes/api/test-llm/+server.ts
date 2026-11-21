import { json, type RequestEvent } from '@sveltejs/kit';

import { testProviderConnectionOnServer } from '$lib/llm/server';
import { checkRateLimit } from '$lib/server/ratelimit';

// 连通性测试自身也是服务端出站请求，保留限流以防被当作请求转发器滥用；
// 但它比生成目录轻量得多，且用户可能反复调整模型后重试，所以使用独立额度。
const TEST_REQUESTS_PER_DAY = 30;

// 与 /api/process-toc 使用同一份来源白名单，防止第三方页面调用该接口。
const ALLOWED_ORIGINS = [
  'https://pdf.aeriszhu.com', 'https://tocify.aeriszhu.com', 'https://tocify.vercel.app',
  'http://localhost:5173', 'http://127.0.0.1:5173'
];

export const POST = async ({ request }: RequestEvent) => {
  const origin = request.headers.get('origin');

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Forbidden', { status: 403 });
  }

  const limitResponse = await checkRateLimit(request, TEST_REQUESTS_PER_DAY, '@tocify/test-llm');
  if (limitResponse) {
    return limitResponse;
  }

  try {
    const {
      provider,
      apiKey,
      customBaseUrl,
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
      modelOverrides,
    } = await request.json();

    const result = await testProviderConnectionOnServer({
      provider,
      apiKey,
      customBaseUrl,
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
      modelOverrides,
    });

    return json(result);
  } catch (err: any) {
    console.error('LLM connection test error:', err);
    return json(
      { ok: false, message: err?.message || 'Connection test failed.' },
      { status: err?.status || 500 },
    );
  }
};
