import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsappLink, requestStatuses } from '../lib/customer-requests.ts';
void test('WhatsApp uses only wa.me and encodes product/variant without URL injection', () => {
  const product = 'Пальто & ? # / “Осень”',
    variant = 'M / белый & text=hijack';
  const link = whatsappLink('+77001234567', product, variant);
  assert.ok(link);
  const url = new URL(link);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/77001234567');
  assert.equal(url.searchParams.size, 1);
  assert.equal(
    url.searchParams.get('text'),
    `Здравствуйте! Нашёл у вас в QRG MARKET товар “${product}”, вариант “${variant}”. Подскажите, он ещё в наличии?`,
  );
  for (const phone of [
    'javascript:alert(1)',
    '+77001234567?text=x',
    '<script>',
    '77001234567',
    '',
  ])
    assert.equal(whatsappLink(phone, product, variant), null);
});
void test('request statuses describe communication, never paid orders', () => {
  assert.deepEqual(
    requestStatuses.map((s) => s.value),
    ['NEW', 'VIEWED', 'CONTACTED', 'CONFIRMED', 'CLOSED', 'REJECTED'],
  );
  assert.equal(
    requestStatuses.find((s) => s.value === 'CONFIRMED')?.label,
    'Обращение подтверждено',
  );
});
