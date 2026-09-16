import { BadRequestException } from '@nestjs/common';
// Verified official KZ firm-card format. No network fetch, short links, redirects or query forwarding.
export function normalizeTwoGis(
  value: string | null | undefined,
  firmId?: string | null,
) {
  if (value == null) {
    if (firmId != null) throw new BadRequestException();
    return { twoGisUrl: null, twoGisFirmId: null };
  }
  const match = /^https:\/\/2gis\.kz\/karaganda\/firm\/([0-9]{10,20})\/?$/.exec(
    value,
  );
  if (!match?.[1] || (firmId != null && firmId !== match[1]))
    throw new BadRequestException();
  return {
    twoGisUrl: 'https://2gis.kz/karaganda/firm/' + match[1],
    twoGisFirmId: match[1],
  };
}
export function normalizePhone(value: string | null | undefined) {
  if (value == null) return null;
  if (!/^[+0-9 ()-]+$/.test(value)) throw new BadRequestException();
  const result = value.replace(/[ ()-]/g, '');
  if (!/^\+[1-9][0-9]{7,14}$/.test(result)) throw new BadRequestException();
  return result;
}
