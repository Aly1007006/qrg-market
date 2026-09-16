export interface AppConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly databaseSsl: boolean;
  readonly swaggerEnabled: boolean;
  readonly appOrigin: string;
  readonly rateLimitSecret: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const portText = env.PORT ?? '3001';
  const port = Number(portText);
  if (
    !/^\d+$/.test(portText) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !databaseUrl.hostname ||
    !databaseUrl.username ||
    databaseUrl.pathname.length < 2 ||
    databaseUrl.search ||
    databaseUrl.hash
  ) {
    throw new Error(
      'DATABASE_URL must include host, user, database and no query parameters',
    );
  }
  const ssl =
    env.DATABASE_SSL ?? (environment === 'production' ? 'true' : 'false');
  const swagger =
    env.SWAGGER_ENABLED ?? (environment === 'development' ? 'true' : 'false');
  if (![ssl, swagger].every((value) => value === 'true' || value === 'false')) {
    throw new Error('DATABASE_SSL and SWAGGER_ENABLED must be true or false');
  }
  if (environment === 'production' && (ssl !== 'true' || swagger !== 'false')) {
    throw new Error(
      'Production requires DATABASE_SSL=true and SWAGGER_ENABLED=false',
    );
  }
  let appOrigin: URL;
  try {
    appOrigin = new URL(
      env.APP_ORIGIN ??
        (environment === 'production' ? '' : 'http://localhost:3000'),
    );
  } catch {
    throw new Error('APP_ORIGIN must be an explicit trusted origin');
  }
  if (
    !['https:', 'http:'].includes(appOrigin.protocol) ||
    appOrigin.username ||
    appOrigin.password ||
    appOrigin.pathname !== '/' ||
    appOrigin.search ||
    appOrigin.hash ||
    (environment === 'production' && appOrigin.protocol !== 'https:')
  ) {
    throw new Error(
      'APP_ORIGIN must be a trusted origin without credentials or path; HTTPS in production',
    );
  }
  const localSecret = 'local-development-rate-limit-key-not-for-production';
  const rateLimitSecret =
    env.AUTH_RATE_LIMIT_SECRET ??
    (environment === 'production' ? '' : localSecret);
  if (
    rateLimitSecret.length < 32 ||
    rateLimitSecret.length > 128 ||
    (environment === 'production' && rateLimitSecret === localSecret)
  ) {
    throw new Error(
      'AUTH_RATE_LIMIT_SECRET must be 32-128 characters and separately configured in production',
    );
  }
  return Object.freeze({
    environment: environment as AppConfig['environment'],
    port,
    databaseUrl: databaseUrl.toString(),
    databaseSsl: ssl === 'true',
    swaggerEnabled: swagger === 'true',
    appOrigin: appOrigin.origin,
    rateLimitSecret,
  });
}
