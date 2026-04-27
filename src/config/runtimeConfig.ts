function parseOriginList(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((origin) => origin.replace(/\/+$/, ''));
}

export const runtimeConfig = {
  additionalDownloadOrigins: parseOriginList(import.meta.env.VITE_ALLOWED_DOWNLOAD_ORIGINS),
} as const;

function isSameOriginBookAsset(url: URL): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return url.origin === window.location.origin && url.pathname.startsWith('/assets/books/');
}

export function resolveValidatedDownloadUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Download URL is missing.');
  }

  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const resolvedUrl = new URL(trimmed, baseOrigin);
  const isSameOrigin = typeof window !== 'undefined' && resolvedUrl.origin === window.location.origin;

  const protocolAllowed = resolvedUrl.protocol === 'https:' || (isSameOrigin && resolvedUrl.protocol === window.location.protocol);
  if (!protocolAllowed) {
    throw new Error('Blocked download from unsupported protocol.');
  }

  const explicitlyAllowedOrigin = runtimeConfig.additionalDownloadOrigins.includes(resolvedUrl.origin.replace(/\/+$/, ''));
  const allowed =
    isSameOriginBookAsset(resolvedUrl) ||
    explicitlyAllowedOrigin;

  if (!allowed) {
    throw new Error(`Blocked download from untrusted origin: ${resolvedUrl.origin}`);
  }

  return resolvedUrl;
}