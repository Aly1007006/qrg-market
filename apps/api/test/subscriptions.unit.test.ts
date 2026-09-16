import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activate,
  BUSINESS,
  DAY,
  entitled,
  nextMonth,
  settlePeriod,
  type BillingState,
} from '../src/subscriptions/state.js';
import { UnconfiguredPaymentProvider } from '../src/subscriptions/provider.js';
const initial: BillingState = {
  status: 'SUSPENDED',
  periodStart: null,
  periodEnd: null,
  anchorDay: null,
  autoRenew: false,
  cancelAtPeriodEnd: false,
  nextPaymentAt: null,
  graceEndsAt: null,
};
void test('fixed backend tariff is 10,000 KZT and trial is disabled', () => {
  assert.equal(BUSINESS.amountMinor, 1000000);
  assert.equal(BUSINESS.currency, 'KZT');
  assert.equal(BUSINESS.trialEnabled, false);
});
void test('calendar months retain anchor, UTC time, leap day and year rollover', () => {
  const jan = new Date('2028-01-31T18:45:30.123Z');
  const feb = nextMonth(jan, 31);
  assert.equal(feb.toISOString(), '2028-02-29T18:45:30.123Z');
  assert.equal(nextMonth(feb, 31).toISOString(), '2028-03-31T18:45:30.123Z');
  assert.equal(
    nextMonth(new Date('2027-01-31T00:00:00Z'), 31).toISOString(),
    '2027-02-28T00:00:00.000Z',
  );
  assert.equal(
    nextMonth(new Date('2027-12-31T00:00:00Z'), 31).toISOString(),
    '2028-01-31T00:00:00.000Z',
  );
  assert.throws(() => nextMonth(new Date('invalid'), 31));
  assert.throws(() => nextMonth(jan, 32));
});
void test('activation/renewal uses half-open paid periods and exact date boundaries', () => {
  const s = activate(initial, new Date('2028-01-31T00:00:00Z'));
  assert.equal(s.status, 'ACTIVE');
  assert.equal(s.nextPaymentAt, null);
  assert.equal(entitled(s, new Date(s.periodEnd!.getTime() - 1)), true);
  assert.equal(entitled(s, s.periodEnd!), false);
  assert.equal(
    activate(s, s.periodEnd!).periodEnd?.toISOString(),
    '2028-03-31T00:00:00.000Z',
  );
});
void test('grace ends at exactly five days and late jobs cannot extend it', () => {
  const start = new Date('2028-03-01T00:00:00Z');
  const s = {
    ...activate(initial, start),
    status: 'GRACE' as const,
    graceEndsAt: new Date(start.getTime() + 5 * DAY),
  };
  assert.equal(
    settlePeriod(s, new Date(s.graceEndsAt.getTime() - 1)).status,
    'GRACE',
  );
  assert.equal(settlePeriod(s, s.graceEndsAt).status, 'SUSPENDED');
  assert.equal(
    settlePeriod(
      { ...s, status: 'PAST_DUE', nextPaymentAt: start },
      s.graceEndsAt,
    ).status,
    'SUSPENDED',
  );
});
void test('disable renewal preserves paid time; cancellation ends at the boundary; reactivation grants a fresh month', () => {
  const s = activate(initial, new Date('2028-01-31T00:00:00Z'));
  assert.equal(settlePeriod(s, s.periodStart!).status, 'ACTIVE');
  assert.equal(settlePeriod(s, s.periodEnd!).status, 'SUSPENDED');
  const cancelled = settlePeriod(
    { ...s, cancelAtPeriodEnd: true },
    s.periodEnd!,
  );
  assert.equal(cancelled.status, 'CANCELLED');
  const renewed = activate(cancelled, new Date('2028-04-12T00:00:00Z'));
  assert.equal(renewed.periodEnd?.toISOString(), '2028-05-12T00:00:00.000Z');
  assert.equal(renewed.autoRenew, false);
});
void test('unconfigured production provider never returns fake success', async () => {
  const p = new UnconfiguredPaymentProvider();
  assert.equal(p.available(), false);
  await assert.rejects(p.createInitialPayment());
  await assert.rejects(p.chargeRecurring());
});
void test('renewal after elapsed grace starts a fresh month even if maintenance was delayed', () => {
  const old = activate(initial, new Date('2028-01-31T00:00:00Z'));
  const deadline = new Date('2028-03-06T00:00:00Z');
  const renewed = activate(
    { ...old, status: 'GRACE', graceEndsAt: deadline },
    deadline,
  );
  assert.equal(renewed.periodStart?.toISOString(), deadline.toISOString());
  assert.equal(renewed.periodEnd?.toISOString(), '2028-04-06T00:00:00.000Z');
});
