import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../config.js';

export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_LIFETIME_MS = 30 * 60 * 1000;
export const newToken = (): string => randomBytes(32).toString('base64url');
export const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
export const csrfFor = (token: string): string =>
  createHash('sha256').update(`qrg-csrf\0${token}`).digest('base64url');
export const matchesCsrf = (actual: unknown, expected: string): boolean =>
  validToken(actual) &&
  timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
export const sessionCookieName = (config: AppConfig): string =>
  config.environment === 'production' ? '__Host-qrg_session' : 'qrg_session';

export function readSessionToken(
  request: Request,
  config: AppConfig,
): string | undefined {
  const name = sessionCookieName(config);
  const matches = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0]?.slice(name.length + 1);
  return validToken(value) ? value : undefined;
}

export function cookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.environment === 'production',
    sameSite: 'lax',
    path: '/',
  };
}
export function writeSessionCookie(
  response: Response,
  config: AppConfig,
  token: string,
  expiresAt: Date,
): void {
  response.cookie(sessionCookieName(config), token, {
    ...cookieOptions(config),
    expires: expiresAt,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}
export function clearSessionCookie(
  response: Response,
  config: AppConfig,
): void {
  response.clearCookie(sessionCookieName(config), cookieOptions(config));
}
