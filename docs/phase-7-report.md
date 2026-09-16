# PHASE 7 — отчёт

Дата: 10 сентября 2026. Выполнена внутренняя subscription business logic. Halyk не подключён; PHASE 7B не начата.

## Сделано

- QRG BUSINESS: 10 000 KZT за календарный месяц, backend-controlled сумма 1 000 000 minor units; TRIAL выключен, auto-renew по умолчанию false.
- State machine ACTIVE → PAST_DUE → retry → GRACE → SUSPENDED; успешное продление восстанавливает ACTIVE. Поддержаны cancellation at period end, отключение auto-renew, next payment date и история попыток.
- Календарные billing periods с UTC anchor day, февраль/високосный год/переход года, точный grace 120 часов. Retry назначается через 24 часа после definitive failure. Поздние и повторные события не продлевают grace.
- Транзакционные попытки/receipts/периоды, idempotency, UNIQUE provider payment identity, optimistic version и row locks против двойного продления.
- Раздел «Подписка» в seller dashboard: реальные данные, даты, отмена, disable auto-renew, bounded история. Существующий стиль и доступные формы сохранены с использованием sites-building, без нового стека или внешнего hosting.
- Billing suspension скрывает публичную витрину, сохраняя магазин, товары, variants, изображения и доступ к кабинету. Возобновление не снимает административный SUSPENDED и не публикует непроверенный магазин.
- Provider-independent internal service и fail-closed provider port. Production не создаёт fake success. Нет HTTP/CLI endpoint подтверждения оплаты; синтетические исходы только в тестах.
- Bounded `billing:tick` для применения deadlines, OpenAPI и CI. Реальный checkout/recurring/банк не реализовывались.

## Изменённые файлы

Основные:

- `apps/api/src/subscriptions/{state,service,provider,visibility,controller,tick-main}.ts`.
- `apps/api/src/db/schema.ts`, `apps/api/drizzle/0006_sloppy_nick_fury.sql`, journal/snapshot.
- `apps/api/src/admin/moderation.ts`, `authorization/permissions.ts`, `app.module.ts`.
- `apps/api/src/catalogue/public.service.ts`, `requests/service.ts`, `media/service.ts` — общий публичный subscription gate.
- `apps/web/components/seller/subscription.tsx`, seller page и BFF allowlist.
- `apps/api/test/subscriptions.{unit,integration}.test.ts`, `billing-fixtures.ts`, существующие auth/catalog/media/request/admin integration fixtures.
- `scripts/subscriptions-smoke.mjs`, package scripts, `.github/workflows/ci.yml`, README, `docs/phase-7-architecture.md`.

Новые dependencies не добавлялись, рабочий foundation не перестраивался. Git baseline остаётся untracked; commit/reset не выполнялись.

## Database

Созданы `subscriptions`, `subscription_payments`, `payment_attempts`, enum пяти статусов без TRIAL. Добавлены FK RESTRICT, composite FK receipt/attempt/subscription, CHECK суммы/currency/периода/status, UNIQUE idempotency/payment identity/одной subscription на shop, partial UNIQUE одной pending attempt на cycle, history/due indexes и updated_at triggers.

Миграция 0006 применена в `qrg_market_test` и основной **локальной** `qrg_market`. В журналах по 7 миграций; повторная генерация Drizzle сообщила отсутствие schema drift. Порядок UNIQUE index перед composite FK проверен до применения.

В основной БД после обновления: 0 subscriptions, 0 payments, 0 attempts. Существующий 1 DRAFT-магазин сохранён без изменения статуса. Никакого trial, платежа или активации автоматически не создано. Volumes сохранены, production БД не затрагивалась.

## Security

Проверены IDOR/BOLA и owner-only permissions: чужой shop, сотрудник, подмена amount/status/shopId/role/autoRenew в body. CSRF, Origin и session boundaries сохранены. Нет публичного или административного пути подделать результат платежа.

Проверены wrong amount/currency, duplicate/conflicting events, конкурентная подготовка попытки, конкурентные изменения cancellation, payment identity replay, rollback и DB constraints. Проверены запрет публикации непроверенного магазина и невозможность снять administrative suspension оплатой. Истечение grace закрывает публичный доступ даже до tick.

Карточные реквизиты, CVV, OTP, bank secrets не добавлялись. История не содержит payment secrets. Регрессии auth, admin MFA/audit, uploads, anti-spam и tenant isolation прошли. `pnpm audit --prod --audit-level=high`: известных уязвимостей не найдено.

## Tests

| Команда                         | Результат                                       |
| ------------------------------- | ----------------------------------------------- |
| `pnpm test`                     | 51/51: 32 API + 19 web                          |
| `pnpm test:db`                  | 43/43                                           |
| `pnpm test:subscriptions`       | 12/12                                           |
| `pnpm test:subscriptions:smoke` | 13/13: core + built seller subscription SSR/BFF |
| `pnpm test:admin`               | 13/13                                           |
| `pnpm test:admin:smoke`         | 14/14                                           |
| `pnpm test:requests:smoke`      | 11/11                                           |
| `pnpm test:seller:smoke`        | 9/9, включая S3/upload security                 |
| `pnpm test:catalog:smoke`       | 14/14                                           |
| `pnpm test:smoke`               | 2/2                                             |
| `pnpm test:web:preview`         | 8/8                                             |

Всего **152 различных теста**, без двойного учёта suites. Новые сценарии покрывают activation, renewal, failure/retry/grace, suspension/reactivation, cancellation/disable auto-renew, duplicate event, date boundaries, concurrent update и поздний success после пропущенного maintenance.

Исправлены несоответствия test fixtures существующей schema и контракту SellerForm, CHECK с nullable значениями и порядок generated composite FK. Тесты не удалялись, правила lint/TS/security не отключались. Один production smoke был ошибочно запущен с локальными S3 env из integration-сессии: production safety validation корректно отклонила их. Повтор в чистом окружении прошёл; проверка credentials осталась включена.

Тесты HTTP/SSR/unit/реальная PostgreSQL/S3. Browser-click, визуальная и полная accessibility QA не проводились. Live fixtures удаляются только адресно из `_test` DB, синтетические append-only audit/history остаются в ней по прежним правилам. Реальные данные не удалялись.

## Typecheck

`pnpm typecheck`: успешно для Next и Nest. TypeScript strict сохранён.

## Lint

`pnpm lint`: успешно, ESLint и Prettier. Ошибки исправлены без suppressions.

## Production Build

`pnpm build`: успешно. Docker API/web images собраны с финальным кодом и запущены локально. Health readiness, seller login и catalog возвращают 200. В OpenAPI присутствуют subscription read/create/renew/cancel/disable-auto-renew routes.

Локальный `billing:tick` из собранного контейнера завершился успешно, processed=0 (реальных subscription записей нет). Внешний deployment не выполнялся.

## Известные проблемы

- Реальная оплата и checkout намеренно недоступны: renewal API возвращает 503, кнопка оплаты отключена с объяснением. Это граница PHASE 7, не fake success и не подключённый банк. Фактическое пользовательское продление станет доступно только после PHASE 7B.
- Enabling auto-renew, реальные recurring mandates/consent, verified callback, dispatcher и reconciliation с банком оставлены для PHASE 7B. Не включать provider переключателем без этих проверок.
- Production scheduler, KZ infrastructure/backup/restore, secrets и non-owner DB role всё ещё требуют deployment-настройки. Локальный Docker не подтверждает production готовность.
- Перенесённые ограничения PHASE 6: trusted proxy identity, reset delivery, CAPTCHA integration и утверждённые privacy/retention параметры остаются незакрытыми.

## Технический долг

- Автоматический production запуск/мониторинг `billing:tick` не настроен. SQL visibility уже закрывает просроченный доступ, но persisted statuses требуют регулярной maintenance job.
- Сроки хранения и архивирование subscription payment/attempt history нужно утвердить до production; автоматический retention не реализован. Финансовые записи не удаляются каскадом при suspension.

## Следующая рекомендуемая фаза

**PHASE 7B**, только после отдельной команды пользователя. Работа остановлена на PHASE 7. Halyk не подключён.
