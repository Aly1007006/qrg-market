import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowedSellerRoute, sessionCookie } from '../lib/seller/boundary.ts';
import { trustedProxyAddress } from '../lib/client-address.ts';
import { SellerApiError, loginErrorMessage } from '../lib/seller/errors.ts';
import {
  imageSelectionError,
  shopGuidance,
  subscriptionLabel,
} from '../lib/seller/guidance.ts';

void test('seller guidance distinguishes every moderation status without bypassing publication', () => {
  const expected: Record<string, string> = {
    DRAFT: 'shop',
    PENDING_VERIFICATION: 'shop',
    CHANGES_REQUESTED: 'shop',
    REJECTED: 'shop',
    VERIFIED: 'subscription',
    SUSPENDED: 'shop',
    ACTIVE: 'products',
  };
  for (const [status, section] of Object.entries(expected)) {
    const guidance = shopGuidance(status);
    assert.equal(guidance.section, section);
    assert.ok(guidance.title && guidance.description && guidance.action);
  }
  assert.match(shopGuidance('SUSPENDED').description, /решение администратора/);
  assert.match(
    shopGuidance('PENDING_VERIFICATION').description,
    /после проверки и оплаты/,
  );
  assert.match(shopGuidance('UNKNOWN').title, /только вам/);
});
void test('upload selection rejects empty, oversized and unsafe files; boundary accepts supported images', () => {
  assert.ok(imageSelectionError(null));
  assert.ok(imageSelectionError({ size: 0, type: 'image/jpeg' }));
  assert.ok(
    imageSelectionError({ size: 10 * 1024 * 1024 + 1, type: 'image/jpeg' }),
  );
  for (const type of [
    'image/svg+xml',
    'text/html',
    'application/octet-stream',
    '',
  ])
    assert.ok(imageSelectionError({ size: 100, type }));
  for (const type of ['image/jpeg', 'image/png', 'image/webp'])
    assert.equal(imageSelectionError({ size: 10 * 1024 * 1024, type }), null);
});
void test('unpaid subscription is explained without claiming activation or provider success', () => {
  assert.match(subscriptionLabel('SUSPENDED', null), /Ещё не оплачена/);
  assert.equal(subscriptionLabel('SUSPENDED', '2026-10-01'), 'Приостановлена');
  assert.equal(subscriptionLabel('ACTIVE', '2026-10-01'), 'Активна');
  assert.equal(subscriptionLabel('UNKNOWN', null), 'Статус уточняется');
  const view = readFileSync('components/seller/subscription.tsx', 'utf8');
  assert.match(view, /Онлайн-оплата пока не подключена/);
  assert.match(view, /без списания денег/);
});
void test('seller fields connect accessible hints, retain contracts and gate photo upload', () => {
  const forms = readFileSync('components/seller/forms.tsx', 'utf8');
  assert.match(forms, /aria-busy=\{busy\}/);
  assert.match(forms, /aria-describedby=\{\s*f.hint/);
  assert.match(forms, /body\[field.name\]/);
  assert.match(forms, /Boolean\(imageSelectionError\(selected\)\)/);
  assert.match(forms, /Выбор файла сам по себе его не сохраняет/);
  const page = readFileSync('app/seller/[[...segments]]/page.tsx', 'utf8');
  const shop = page.slice(
    page.indexOf("else if (section === 'shop')"),
    page.indexOf("else if (section === 'employees')"),
  );
  assert.ok(shop.indexOf('<SellerVerification') > shop.indexOf('</fieldset>'));
  assert.match(shop, /min: -90/);
  assert.match(shop, /min: -180/);
});
void test('new seller can copy their invitation ID and log out before creating a shop', () => {
  const page = readFileSync('app/seller/[[...segments]]/page.tsx', 'utf8');
  const shopList = page.slice(
    page.indexOf('if (!segments[0])'),
    page.indexOf('const shopId = segments[0]'),
  );
  assert.match(shopList, /Ваш ID для приглашения в магазин/);
  assert.match(
    shopList,
    /path="auth\/logout"\s+csrf=\{csrf\}\s+label="Выйти"\s+redirectTo="\/seller\/login"/,
  );
});
void test('header enters guarded seller root and current session logout redirects to sign-in', () => {
  const shell = readFileSync('components/shell.tsx', 'utf8');
  assert.match(
    shell,
    /href="\/seller"\s+aria-label="Открыть кабинет продавца"/,
  );
  const page = readFileSync('app/seller/[[...segments]]/page.tsx', 'utf8');
  assert.match(page, /s.id === me.sessionId/);
  assert.match(page, /redirectTo: '\/seller\/login'/);
});
void test('invalid login is account-neutral and not confused with expired session; throttling remains visible', () => {
  assert.equal(
    loginErrorMessage(new SellerApiError(401, 'Сессия истекла')),
    'Не удалось войти. Проверьте email и пароль.',
  );
  assert.equal(
    loginErrorMessage(new SellerApiError(429, 'Слишком много запросов')),
    'Слишком много запросов',
  );
  assert.equal(
    loginErrorMessage(new SellerApiError(503, 'Сервис ещё не настроен')),
    'Сервис ещё не настроен',
  );
  assert.equal(loginErrorMessage(null), 'Не удалось войти. Попробуйте снова.');
});
void test('seller registration explains password rules and confirmation never enters the API payload', () => {
  const form = readFileSync('components/seller/forms.tsx', 'utf8');
  assert.match(form, /name="passwordConfirmation"/);
  assert.match(
    form,
    /data\.get\('password'\) !== data\.get\('passwordConfirmation'\)/,
  );
  assert.match(form, /confirmation\.focus\(\)/);
  assert.match(form, /aria-describedby="password-help"/);
  assert.match(form, /aria-pressed=\{showPassword\}/);
  const payload = form.slice(
    form.indexOf("await mutate('auth/'"),
    form.indexOf('if (signup) {', form.indexOf("await mutate('auth/'")),
  );
  assert.doesNotMatch(payload, /passwordConfirmation/);
});
void test('product save distinguishes unpublished boutiques from public publication', () => {
  const editor = readFileSync('components/seller/product-editor.tsx', 'utf8');
  assert.match(
    editor,
    /shopStatus === 'ACTIVE'\s*\? 'Товар опубликован'\s*: 'Товар сохранён — магазин пока скрыт'/,
  );
  assert.match(editor, /shopStatus === 'ACTIVE' && done\.published/);
});
void test('seller horizontal navigation cannot expand the mobile grid track', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  assert.match(
    css,
    /\.seller-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(css, /\.seller-shell > aside\s*\{\s*min-width:\s*0/);
  assert.match(css, /\.seller-shell > aside > nav\s*\{[^}]*overflow-x:\s*auto/);
});
void test('seller BFF allows only explicit scoped routes and methods', () => {
  const id = '12345678-1234-4123-8123-123456789abc';
  assert.ok(allowedSellerRoute(`shops/${id}/products/${id}/images`, 'POST'));
  for (const path of [
    'https://evil.test',
    '../admin',
    'shops//products',
    'auth/password-reset/confirm',
    'public/catalog',
    `shops/${id}/products/${id}/images/../../admin`,
  ])
    assert.equal(allowedSellerRoute(path, 'POST'), false);
  assert.equal(allowedSellerRoute('auth/login', 'GET'), false);
});
void test('BFF forwards only opaque session cookies, no unrelated credentials', () => {
  const token = 'a'.repeat(43);
  assert.equal(
    sessionCookie(`tracking=secret; qrg_session=${token}; admin=secret`),
    `qrg_session=${token}`,
  );
  assert.equal(sessionCookie('qrg_session=bad; authorization=secret'), '');
});
void test('public BFF routes replace raw client addresses with signed pseudonymous proofs', () => {
  const helper = readFileSync('lib/internal-client.ts', 'utf8');
  assert.match(helper, /createHmac/);
  assert.match(helper, /x-qrg-client-id/);
  assert.match(helper, /x-qrg-client-proof/);
  assert.doesNotMatch(helper, /'x-forwarded-for':/);
  assert.equal(
    trustedProxyAddress('203.0.113.99, 198.51.100.7', 'production'),
    '198.51.100.7',
  );
  assert.equal(
    trustedProxyAddress('8.8.8.8, 127.0.0.1', 'production'),
    '127.0.0.1',
  );
  assert.throws(() => trustedProxyAddress('8.8.8.8, attacker', 'production'));
  assert.throws(() => trustedProxyAddress(null, 'production'));
  assert.equal(
    trustedProxyAddress(null, 'development'),
    'local-development-client',
  );
  for (const route of [
    'app/api/seller/[...path]/route.ts',
    'app/api/admin/[...path]/route.ts',
    'app/api/requests/route.ts',
    'app/api/analytics/route.ts',
    'app/api/search/route.ts',
  ])
    assert.match(
      readFileSync(route, 'utf8'),
      /internalClientHeaders\(request\)/,
    );
});
