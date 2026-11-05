const noncePattern = /^[A-Za-z0-9+/=]{16,128}$/;

function mediaSource(value: string | undefined, production: boolean) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (production && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(
  nonce: string,
  environment: string | undefined,
  mediaOrigin: string | undefined,
) {
  if (!noncePattern.test(nonce)) throw new Error('Invalid CSP nonce');
  const production = environment === 'production';
  const media = mediaSource(mediaOrigin, production);
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? '' : " 'unsafe-eval'"}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    // Fixed category sprites use bounded React style attributes. Element
    // <style> tags remain nonce-only and script attributes remain blocked.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob:${media ? ` ${media}` : ''}`,
    "font-src 'self' data:",
    `connect-src 'self'${production ? '' : ' ws: wss:'}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(production ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

export function strictTransportSecurity(
  environment: string | undefined,
  enabled: string | undefined,
  appOrigin: string | undefined,
) {
  if (enabled !== undefined && !['true', 'false'].includes(enabled))
    throw new Error('QRG_HSTS_ENABLED must be true or false');
  if (environment !== 'production' || enabled !== 'true') return null;
  let origin: URL;
  try {
    origin = new URL(appOrigin ?? '');
  } catch {
    throw new Error('HSTS requires an explicit HTTPS application origin');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('HSTS requires an explicit HTTPS application origin');
  return 'max-age=31536000';
}

export function validRequestNonce(value: string | null) {
  return value && noncePattern.test(value) ? value : undefined;
}
