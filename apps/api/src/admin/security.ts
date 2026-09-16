import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import type { CookieOptions, Request } from 'express';
import type { AppConfig } from '../config.js';
import { validToken } from '../auth/tokens.js';
export const ADMIN_LIFETIME_MS = 60 * 60 * 1000;
export const ADMIN_IDLE_MS = 15 * 60 * 1000;
export function adminCookieName(config: AppConfig) {
  return config.environment === 'production' ? '__Host-qrg_admin' : 'qrg_admin';
}
export function adminCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.environment === 'production',
    sameSite: 'strict',
    path: '/',
  };
}
export function readAdminToken(request: Request, config: AppConfig) {
  const name = adminCookieName(config);
  const cookies = (request.headers.cookie ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + '='));
  const token = cookies[0]?.slice(name.length + 1);
  return cookies.length === 1 && validToken(token) ? token : undefined;
}
export function encryptionKey(value = process.env.ADMIN_MFA_ENCRYPTION_KEY) {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new ServiceUnavailableException();
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value)
    throw new ServiceUnavailableException();
  return key;
}
export function encryptTotp(secret: string, userId: string, key: Buffer) {
  if (
    !/^[A-Z2-7]{32,104}$/.test(secret) ||
    Secret.fromBase32(secret).buffer.byteLength < 20
  )
    throw new Error('Invalid TOTP enrollment secret');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('qrg-admin-totp:' + userId));
  const encrypted = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function decryptTotp(value: string, userId: string, key: Buffer) {
  const [version, iv, tag, data, extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data || extra)
    throw new UnauthorizedException();
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from('qrg-admin-totp:' + userId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new UnauthorizedException();
  }
}
export abstract class AdminSecondFactor {
  abstract verify(
    encrypted: string,
    userId: string,
    code: string,
    lastStep: number,
  ): number;
}
@Injectable()
export class TotpSecondFactor extends AdminSecondFactor {
  verify(encrypted: string, userId: string, code: string, lastStep: number) {
    const key = encryptionKey(); // Missing runtime secret fails closed in every environment.
    const secret = decryptTotp(encrypted, userId, key);
    if (!/^\d{6}$/.test(code)) throw new UnauthorizedException();
    const timestamp = Date.now();
    const delta = new TOTP({
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    }).validate({ token: code, window: 1, timestamp });
    const step = Math.floor(timestamp / 30000) + (delta ?? 0);
    if (delta === null || step <= lastStep) throw new UnauthorizedException();
    return step;
  }
}
