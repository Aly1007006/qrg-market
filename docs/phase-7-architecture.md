# PHASE 7 — внутренняя логика подписки

## Граница фазы

QRG BUSINESS: 10 000 KZT за календарный месяц. В БД сумма в minor units: 1 000 000 тиын, integer, без float. Plan/currency/amount задаются backend и продублированы CHECK constraints. Buyer payment/order, wallets, payouts, escrow не создаются. TRIAL не включён в enum; `trialEnabled=false`, trial/recurring не активируются через environment switch.

Ни Halyk, ни другой банк не подключён. Production DI использует `UnconfiguredPaymentProvider`, который возвращает 503, никогда не success. Нет callback/webhook, endpoint ручного подтверждения платежа, operator success CLI, production seeds или test-provider switch. `recordOutcome` вызывается только внутренним кодом; в текущем runtime нет источника успешных платежей. Вызовы с синтетическими исходами находятся в test suite, изолированном от production build.

Сохранены pnpm, Next/Nest, Drizzle/PostgreSQL и существующая дизайн-система. Раздел seller «Подписка» показывает действительное состояние, даты, историю попыток и отключённую кнопку оплаты с объяснением. Нет фальшивого checkout. Владелец может создать неоплаченную подписку, отключить auto-renew и отменить её; возможность получить платёжный checkout появится только в PHASE 7B.

## Даты и state machine

Период `[periodStart, periodEnd)` хранится в timestamptz. Расчёт календарного месяца — UTC с сохранением исходного anchor day и времени. Например, 31 января → 28/29 февраля → 31 марта. Отображение дат в кабинете — Asia/Almaty. Первый успех начинает период в момент обработки server-confirmed результата. Для непрерывного продления в PAST_DUE/GRACE следующий месяц начинается от предыдущего periodEnd. После истечения grace/приостановки/отмены с разрывом начинается новый месяц от renewal; задолженность за пропущенные месяцы и prorating не создаются. Полностью прошедший период не продаётся задним числом.

| Событие                                           | Переход                                           |
| ------------------------------------------------- | ------------------------------------------------- |
| Создание неоплаченной подписки                    | SUSPENDED, без period и trial                     |
| Первый подтверждённый успех                       | ACTIVE, новый оплаченный месяц                    |
| Окончательный failed recurring                    | ACTIVE → PAST_DUE                                 |
| Retry intent в назначенное время                  | PAST_DUE → GRACE                                  |
| Повторный failed / повтор уже обработанного event | Срок grace не продлевается                        |
| Истечение grace                                   | GRACE → SUSPENDED                                 |
| Успешное продление                                | PAST_DUE / GRACE / SUSPENDED / CANCELLED → ACTIVE |
| cancel-at-period-end                              | ACTIVE сохраняется до periodEnd, затем CANCELLED  |
| disable-auto-renew без cancellation               | Доступ до periodEnd, затем SUSPENDED              |

Принятое правило retry: первая повторная попытка через 24 часа после окончательного failed recurring. Grace длится ровно 5 × 24 часа от назначенного времени retry. Задержавшийся worker не увеличивает бесплатный доступ; если retry вообще не стартовал, предел PAST_DUE — retryAt + 5 суток. Эти значения зафиксированы в коде и тестах; изменение retry policy — отдельное бизнес-решение.

Transport timeout не является payment failure: PENDING intent остаётся PENDING до подтверждённого исхода. Неизвестный результат нельзя автоматически объявлять FAILED и повторять списание с новым ключом. Поздний success после истёкшего grace использует effective SUSPENDED даже при задержке maintenance.

Отключение auto-renew не отменяет уже подтверждённую оплату и не сокращает оплаченный период. В PAST_DUE оно прекращает scheduled retry, сохраняя прежний конечный срок доступа как GRACE. Cancellation после окончания оплаченного периода действует сразу. Успешный уже начатый платёж всё равно учитывается, но не включает auto-renew обратно. Кнопки изменения используют expectedVersion; конкурентное устаревшее изменение получает 409.

## Модерация и публичность

Публичность: `shop.status=ACTIVE AND subscription entitlement`. Проверка встроена в catalog/details/shop lists/autocomplete, public images и создание customer request, а не только в UI. Дедлайн проверяется SQL `now()`, поэтому задержка maintenance не оставляет витрину публичной.

Billing suspension переводит ACTIVE магазин обратно в VERIFIED. Это сохраняет факт проверки и отличает отсутствие оплаты от административного SUSPENDED. Subscription при этом имеет статус SUSPENDED. Возобновление может поднять VERIFIED → ACTIVE, но не меняет DRAFT/PENDING_VERIFICATION/CHANGES_REQUESTED/REJECTED или административный SUSPENDED. Admin APPROVE активирует только при уже существующем действующем entitlement; иначе результат VERIFIED. Оплата непроверенного магазина не публикует его.

Seller dashboard и tenant permissions не зависят от subscription status. При истечении подписки не удаляются shop, product, variant, image, media object или заявки. Старые вручную ACTIVE shops без subscription также не получают автоматического бесплатного доступа.

## Persistence и concurrency

- `subscriptions`: одна запись на shop, plan/amount/currency, status, period, anchor day, autoRenew, cancelAtPeriodEnd, nextPaymentAt, graceEndsAt, cycle, version, timestamps.
- `payment_attempts`: durable intent с UUID idempotencyKey, kind INITIAL/RENEWAL/RETRY, cycle, PENDING/SUCCEEDED/FAILED, фиксированной суммой, provider payment identity и completion timestamp.
- `subscription_payments`: только подтверждённые успешные платежи за платформу, attempt association, amount/currency, предоставленный период и confirmation timestamp. Не является buyer transaction.
- UNIQUE subscription/shop, idempotencyKey, providerPaymentId и receipt/attempt; partial UNIQUE одной PENDING попытки на cycle. Composite FK не позволяет присоединить receipt к attempt другой подписки. FK RESTRICT защищают финансовую историю от каскадного удаления магазина.
- Clock инъецируется для тестов. Production использует системное время; изменение часов/NTP контролируется эксплуатацией.
- Общий lock order: shop → subscription → attempt; seller сначала проходит существующие session/membership проверки. Модерация использует тот же shop lock. В одной транзакции: outcome, receipt, period/cycle/version, shop visibility и audit event.
- Дубликат того же terminal outcome возвращает duplicate без нового периода/receipt/audit. Противоречивый terminal result отклоняется. SQL uniqueness дополнительно защищает конкурентное переиспользование payment identity.
- Audit: actor/action/resource/timestamp/result, без card/token/body. Нет HTTP read/write чужой subscription или смены её status/amount/permissions.

## API и эксплуатация

Owner-only, server session + membership + permission:

- GET `/api/v1/shops/:shopId/subscription?page=1`: subscription, server tariff, последние попытки (20 на страницу), provider availability.
- POST по этому пути с `{}`: idempotent создание SUSPENDED без оплаты.
- POST `.../cancel`, `.../disable-auto-renew`: `{ "expectedVersion": number }`.
- POST `.../renew` с `{}`: 503 до подключения provider; никаких успешных записей или поддельных попыток.

Manager/employee не управляют подпиской. Все mutations требуют Origin/custom-header/JSON/CSRF. Next BFF допускает только перечисленные маршруты и методы, сохраняет existing payload limits и timeout. Нет endpoint включения auto-renew: реальная mandate/recurring consent архитектура относится к PHASE 7B и не заменена чекбоксом «согласен» без платёжного провайдера.

`pnpm billing:tick` обрабатывает до 100 due подписок за один запуск, транзакционно и повторяемо. В Docker image: `node apps/api/dist/subscriptions/tick-main.js`. Он только применяет deadlines — не инициирует реальных списаний и не выдумывает failures. На production требуется deployment scheduler (например, запуск раз в минуту), мониторинг ошибок/лага и повторные bounded batches при backlog. Автоматизация рабочего стола или системный cron этой фазой не создавались.

У ACTIVE auto-renew с истёкшим периодом и неизвестным исходом статус не подменяется вымышленным PAST_DUE: доступ уже закрыт по periodEnd, а статус ожидает достоверного исхода. В PHASE 7B потребуется диспетчер due attempts/reconciliation с bank-side idempotency, verified merchant/signature/payment status и реальным recurring consent. Универсальные DTO внешнего API и параметры банка сейчас не выдуманы.

История платежей/аудита и provider payment identity требуют утверждённого retention policy и KZ backup/restore. Карточные реквизиты, CVV, OTP и реальные payment secrets в schema, коде и examples отсутствуют. Изменение суммы, trial, retry timing или правил возобновления не должно выполняться ad hoc через frontend.

## Проверка

`pnpm test:subscriptions` — реальные PostgreSQL integration tests, только БД с `_test`. `pnpm test:subscriptions:smoke` после build — настоящий Next SSR/BFF flow. Unit tests входят в `pnpm test`. Синтетические paid-access fixtures предыдущих фаз находятся только в `apps/api/test/billing-fixtures.ts`; endpoint или импорт в production source отсутствует.

Следующий разрешённый этап — только отдельная команда PHASE 7B. Реальный Halyk не подключён.
