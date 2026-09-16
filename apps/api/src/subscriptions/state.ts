export const BUSINESS = {
  code: 'QRG_BUSINESS',
  amountMinor: 1_000_000,
  currency: 'KZT',
  trialEnabled: false,
} as const;
export const DAY = 86_400_000;
export type SubscriptionStatus =
  'ACTIVE' | 'PAST_DUE' | 'GRACE' | 'SUSPENDED' | 'CANCELLED';
export interface BillingState {
  status: SubscriptionStatus;
  periodStart: Date | null;
  periodEnd: Date | null;
  anchorDay: number | null;
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
  nextPaymentAt: Date | null;
  graceEndsAt: Date | null;
}
export function nextMonth(start: Date, anchorDay: number): Date {
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isInteger(anchorDay) ||
    anchorDay < 1 ||
    anchorDay > 31
  )
    throw new Error('Invalid billing date');
  const result = new Date(start);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(anchorDay, lastDay));
  return result;
}
export function entitled(s: BillingState, now: Date): boolean {
  if (s.status === 'ACTIVE') return !!s.periodEnd && now < s.periodEnd;
  if (s.status === 'GRACE') return !!s.graceEndsAt && now < s.graceEndsAt;
  // A delayed retry worker must not keep a shop public indefinitely.
  return (
    s.status === 'PAST_DUE' &&
    !!s.nextPaymentAt &&
    now.getTime() < s.nextPaymentAt.getTime() + 5 * DAY
  );
}
export function settlePeriod(s: BillingState, now: Date): BillingState {
  if (
    s.status === 'ACTIVE' &&
    s.periodEnd &&
    now >= s.periodEnd &&
    (!s.autoRenew || s.cancelAtPeriodEnd)
  )
    return {
      ...s,
      status: s.cancelAtPeriodEnd ? 'CANCELLED' : 'SUSPENDED',
      nextPaymentAt: null,
      graceEndsAt: null,
    };
  if ((s.status === 'GRACE' || s.status === 'PAST_DUE') && !entitled(s, now))
    return {
      ...s,
      status: 'SUSPENDED',
      nextPaymentAt: null,
      graceEndsAt: null,
    };
  return s;
}
export function activate(s: BillingState, now: Date): BillingState {
  // A late success must use the effective state even if maintenance has not run.
  if (s.status === 'PAST_DUE' || s.status === 'GRACE') s = settlePeriod(s, now);
  const continuous =
    s.periodEnd && ['ACTIVE', 'PAST_DUE', 'GRACE'].includes(s.status);
  let start = continuous ? s.periodEnd! : now;
  let anchor = continuous ? s.anchorDay! : now.getUTCDate();
  let end = nextMonth(start, anchor);
  // Do not charge for a fully elapsed month or create arrears/WMS-like debt.
  if (end <= now) {
    start = now;
    anchor = now.getUTCDate();
    end = nextMonth(start, anchor);
  }
  return {
    ...s,
    status: 'ACTIVE',
    periodStart: start,
    periodEnd: end,
    anchorDay: anchor,
    nextPaymentAt: s.autoRenew && !s.cancelAtPeriodEnd ? end : null,
    graceEndsAt: null,
  };
}
