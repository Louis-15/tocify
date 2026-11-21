// 自定义 Base URL 与 SSRF 防护。
// 这里保留着项目原有的安全约束：必须 HTTPS、禁止凭据/查询参数、禁止 localhost 与内网地址。
// 该模块只依赖 providers.ts 的常量，保证被 request.ts、core.ts 复用时不产生循环依赖。

import { DEFAULT_CUSTOM_BASE_URL, MAX_CUSTOM_BASE_URL_LENGTH } from './providers';

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

function isBlockedIpv4Address(address: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    return false;
  }

  const octets = address.split('.').map((part) => Number(part));

  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    first === 100 && second >= 64 && second <= 127 ||
    first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 ||
    first === 192 && second === 168 ||
    first === 198 && (second === 18 || second === 19)
  );
}

function isBlockedIpv6Address(address: string): boolean {
  const normalized = stripIpv6Brackets(address);

  if (!normalized.includes(':')) {
    return false;
  }

  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) {
    return isBlockedIpv4Address(mappedIpv4);
  }

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  );
}

export function isBlockedIpAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address.trim());
  return isBlockedIpv4Address(normalized) || isBlockedIpv6Address(normalized);
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname.trim());

  return (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized === 'metadata.google.internal' ||
    isBlockedIpAddress(normalized)
  );
}

export function normalizeCustomBaseUrl(baseUrl?: string): string {
  const rawBaseUrl = baseUrl?.trim() || DEFAULT_CUSTOM_BASE_URL;

  if (!rawBaseUrl) {
    throw new Error('Custom base URL is required.');
  }

  if (rawBaseUrl.length > MAX_CUSTOM_BASE_URL_LENGTH) {
    throw new Error('Custom base URL is too long.');
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error('Invalid custom base URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Custom base URL must use HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('Custom base URL must not include credentials.');
  }

  if (url.search || url.hash) {
    throw new Error('Custom base URL must not include query or hash parameters.');
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error('Custom base URL host is not allowed.');
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  if (url.pathname.endsWith('/chat/completions')) {
    url.pathname = url.pathname.slice(0, -'/chat/completions'.length) || '/';
  }
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
}
