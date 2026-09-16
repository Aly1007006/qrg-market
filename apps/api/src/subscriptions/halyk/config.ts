// Official API documentation checked 2026-09-13. Endpoints are deliberately
// closed, not merchant-controlled URLs. See docs/phase-7b-payment-audit.md.
export const HALYK_ENDPOINTS = Object.freeze({
  sandbox: Object.freeze({
    oauth: 'https://test-epay-oauth.epayment.kz/oauth2/token',
    api: 'https://test-epay-api.epayment.kz',
    script: 'https://test-epay.epayment.kz/payform/payment-api.js',
  }),
  production: Object.freeze({
    oauth: 'https://epay-oauth.homebank.kz/oauth2/token',
    api: 'https://epay-api.homebank.kz',
    script: 'https://epay.homebank.kz/payform/payment-api.js',
  }),
});

export interface HalykConfig {
  readonly environment: keyof typeof HALYK_ENDPOINTS;
  readonly terminalId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hasControl = (value: string) =>
  [...value].some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );

export function loadHalykConfig(
  env: NodeJS.ProcessEnv = process.env,
): HalykConfig | undefined {
  const environment = env.HALYK_ENVIRONMENT ?? 'disabled';
  if (!['disabled', 'sandbox', 'production'].includes(environment))
    throw new Error(
      'HALYK_ENVIRONMENT must be disabled, sandbox or production',
    );
  if (environment === 'disabled') return undefined;
  if (env.NODE_ENV === 'production' && environment !== 'production')
    throw new Error('Production cannot use Halyk sandbox');
  const terminalId = env.HALYK_TERMINAL_ID ?? '';
  const clientId = env.HALYK_CLIENT_ID ?? '';
  const clientSecret = env.HALYK_CLIENT_SECRET ?? '';
  if (!UUID.test(terminalId))
    throw new Error('HALYK_TERMINAL_ID must be a merchant-issued UUID');
  if (
    !clientId ||
    clientId.length > 200 ||
    /\s/u.test(clientId) ||
    hasControl(clientId)
  )
    throw new Error('HALYK_CLIENT_ID must be configured');
  if (!clientSecret || clientSecret.length > 512 || hasControl(clientSecret))
    throw new Error(
      'HALYK_CLIENT_SECRET must be configured via secret manager',
    );
  // Public shared sandbox credentials are not a production merchant account.
  if (environment === 'production' && clientId.toLowerCase() === 'test')
    throw new Error(
      'Shared Halyk test credentials cannot be used in production',
    );
  return Object.freeze({
    environment: environment as HalykConfig['environment'],
    terminalId,
    clientId,
    clientSecret,
  });
}
