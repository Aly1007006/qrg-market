# PHASE 7B — частичный результат

13 сентября 2026. **Не завершена: реальные платежи Halyk не подключены. PHASE 8 не начата.**

## Сделано

Изучены результаты PHASE 7 и актуальные официальные документы Halyk до написания integration code. Существующие foundation, тариф 10 000 KZT, subscription state machine, seller UI и tenant authorization сохранены.

Добавлены `HalykPaymentProvider`, настоящий HTTP OAuth/status-клиент, типизированные read-only reference/observation, factory и безопасная config. `SubscriptionService` не зависит от Halyk. FreedomPay можно реализовать отдельным adapter за тем же port; выдуманный provider не создавался.

Status-клиент сверяет merchant, invoice, payment ID, subscription account, сумму и валюту. Неподтверждённые/промежуточные состояния не означают оплату. Checkout, recurring и callback проверка намеренно закрыты, включая случай уже заданных credentials. Карточные данные не хранятся, buyer payments не создаются. Подробности: [payment security audit](phase-7b-payment-audit.md).

В продолжении фазы реализована постоянная привязка invoice к попытке и подписке. Серверное создание номера, atomic reserve с попыткой, разрешение invoice → reference, разделение merchant/environment, UNIQUE/FK и запрет UPDATE защищают от подмены и конкурентных дубликатов. Событие чужого provider не может завершить связанную попытку. Это независимо от отсутствующих ключей подписи и не включает реальные списания.

В текущем продолжении добавлены низкоуровневые запросы payment OAuth, hosted checkout payload и recurring CardID POST. Только backend задаёт 10 000 KZT; лишние поля отбрасываются. AUTH/3D не активируют доступ, неоднозначный ответ не вызывает автоматическое повторное списание. Написаны 12 новых offline contract/security tests. Application provider сохраняет hard gate: эти запросы не вызываются пользовательским API.

## Изменённые файлы

- `apps/api/src/subscriptions/provider.ts` — расширение port, typed status contract.
- `apps/api/src/subscriptions/provider-factory.ts` — выбор отключённого/Halyk adapter.
- `apps/api/src/subscriptions/halyk/config.ts` — merchant config и официальные endpoints.
- `apps/api/src/subscriptions/halyk/client.ts` — реальный ограниченный HTTP transport.
- `apps/api/src/subscriptions/halyk/contracts.ts` — validated commands и whitelist банковских payload.
- `apps/api/src/subscriptions/halyk/provider.ts` — matching/status projection и закрытый write-side.
- `apps/api/src/app.module.ts` — DI через provider factory.
- `apps/api/src/subscriptions/invoice-bindings.ts`, `service.ts` — постоянные привязки, транзакционный persistence hook и provider check.
- `apps/api/src/db/schema.ts`, `apps/api/drizzle/0007_sturdy_surge.sql`, metadata — таблица, sequence, FK/UNIQUE/CHECK и immutable UPDATE trigger.
- `apps/api/test/billing-fixtures.ts`, `auth.integration.test.ts` — cleanup только собственных тестовых привязок и проверка восьми миграций.
- `apps/api/test/halyk.unit.test.ts`, `apps/api/test/halyk.commands.test.ts`, `apps/api/test/halyk.integration.test.ts` — offline contracts/security и реальный PostgreSQL ledger.
- `apps/api/.env.example`, `apps/api/.env.production.example` — только пустые merchant credentials, disabled по умолчанию.
- `apps/api/package.json`, `package.json`, `.github/workflows/ci.yml` — новые tests, включение в CI.
- `README.md`, `docs/phase-7b-payment-audit.md`, этот отчёт — точная граница частичной реализации и необходимые входные данные.

Новых dependencies и workspace packages нет. Frontend не перестраивался. Schema дополнена без изменения существующих данных.

## Database

В текущем продолжении Database: изменений нет; новые миграции не требовались. Ниже — уже сделанные изменения PHASE 7B.

Добавлена миграция `0007_sturdy_surge.sql`: `payment_provider_bindings` (7 полей), составной FK attempt/subscription с RESTRICT, UNIQUE invoice в пределах provider/environment/merchant, индекс subscription, CHECK provider/environment/6-digit invoice, sequence `halyk_invoice_sequence` без циклического повторения и trigger запрета UPDATE.

Миграция ранее применена к локальным `qrg_market_test` и `qrg_market`; миграций теперь 8. В текущем продолжении повторный `pnpm db:migrate` на `_test` прошёл, `pnpm db:generate`: No schema changes. Основная БД в этом продолжении не изменялась. Тесты проверяют atomic rollback, concurrent idempotent reserve, отсутствие повторной выдачи номера после rollback, FK, уникальность и immutable binding. Новых реальных платежей нет; fixture data остаётся только в `_test` и очищается по собственным shop IDs.

## Security

- Проверены неверные amount/currency/merchant/invoice/payment ID/subscription, fake redirect, forged callback, BOLA/IDOR, replay и reused payment ID, concurrent duplicate settlement, delayed observation, AUTH/3D/timeout, malformed/oversized upstream response и отсутствие секретов в ошибках/проекции.
- Подпись Halyk **не реализована**: в изученном публичном контракте нет её спецификации. Любой callback отклоняется; `secret_hash` не объявляется подписью. Нет callback HTTP route, ослабления CSRF или fake-success production provider.
- First/recurring success/failure протестированы только на offline HTTP fixtures + PostgreSQL ledger, не настоящими списаниями. `recordFixture` bridge существует только в test file и не включён в production build.
- Новые payment commands протестированы напрямую через offline transport: сумма/валюта неизменны, поля whitelist, URLs/UUID валидируются, mutation во время await не меняет запрос, AUTH/3D не settlement, timeout не повторяет POST, ошибочные responses не раскрывают секреты. Полностью заполненная команда не обходит hard gate application provider.
- `pnpm audit --prod --audit-level=high`: известных уязвимостей не найдено.
- Audit verdict: **NO-GO для реальной оплаты**, до устранения перечисленных ниже blockers. Это не PCI-сертификация.

## Tests

Все перечисленные проверки повторно запущены 13 сентября и прошли; нет skipped/todo. Всего 184 различных tests с учётом того, что smoke suites повторяют часть integration tests. Из них 32 в PHASE 7B: 24 unit/contract + 8 PostgreSQL payment tests. В текущем продолжении добавлены 12 wire/security tests.

| Команда                                      | Результат                        |
| -------------------------------------------- | -------------------------------- |
| `pnpm test:critical` (запускает `pnpm test`) | PASS, API 56 + web 19            |
| `pnpm test:payments`                         | PASS, 8                          |
| `pnpm test:subscriptions`                    | PASS, 12                         |
| `pnpm test:db`                               | PASS, 43                         |
| `pnpm test:admin`                            | PASS, 13                         |
| `pnpm test:requests`                         | PASS, 10                         |
| `pnpm test:media`                            | PASS, 8, с реальным локальным S3 |
| `pnpm test:subscriptions:smoke`              | PASS, 13                         |
| `pnpm test:admin:smoke`                      | PASS, 14                         |
| `pnpm test:requests:smoke`                   | PASS, 11                         |
| `pnpm test:seller:smoke`                     | PASS, 9                          |
| `pnpm test:catalog:smoke`                    | PASS, 14                         |
| `pnpm test:smoke`                            | PASS, 2 production HTTP tests    |
| `pnpm test:web:preview`                      | PASS, 8                          |

Во время предыдущих продолжений исправлены типизация UUID test helper, lint замечания regex/async fixtures и ошибочное ожидание теста: unknown success query корректно отвергается текущей global validation с 400. В текущем продолжении Docker изначально был выключен; локальные PostgreSQL/S3 запущены, затем все интеграционные проверки выполнены успешно. Validation/тесты не отключались.

Bank sandbox/production acceptance tests **не запускались**: отсутствуют credentials и согласованный security contract. Таблица покрытия requested payment attacks и это ограничение явно описаны в audit.

## Typecheck

`pnpm typecheck`: PASS, TypeScript strict для API и web.

## Lint

`pnpm lint`: PASS, ESLint без warnings, Prettier.

## Production Build

`pnpm build`: PASS, NestJS и Next.js production build. Скомпилированный production API стартует, health работает, Swagger скрыт; production web не включает fixtures. Новые production Docker deployment и реальные банковские операции не выполнялись.

## Известные проблемы

1. Нет merchant-issued TerminalID/ClientID/ClientSecret QRG и подтверждённых настроек capture/recurring/3DS. Секрет нужно передать через environment/Lockbox, не чат или репозиторий.
2. Нет спецификации требуемой цифровой подписи callback. Публичный документ описывает `secret_hash` и status verification, но не MAC/signature. Требуется официальный контракт банка либо явное решение владельца изменить это security-требование на согласованный с банком механизм; самостоятельно оно не изменялось. [Halyk: платёжная страница](https://epayment.kz/docs/platezhnaya-stranica).
3. Ещё отсутствуют работающие checkout flow, verified callback→ledger, recurring mandate/consent/dispatcher, 3DS handoff и автоматическое bank reconciliation. Постоянный invoice binding, read-only inspect и низкоуровневые payment requests реализованы, но не заменяют готовую платёжную интеграцию. Добавление credentials само по себе это не исправит.
4. Нужны публичные HTTPS return/postLink addresses и банковские acceptance tests. Точный список предоставляемых данных/настроек — в [аудите](phase-7b-payment-audit.md).

## Технический долг

Security workarounds, fake production successes и дополнительные зависимости не добавлены. Незавершённый write-side — явно обозначенная оставшаяся работа этой фазы, не скрытая за успешными тестами реализация.

Invoice sequence ограничена 900 000 выдачами и не сбрасывается после rollback: это намеренное ограничение публичного контракта, а не обход uniqueness. Перед launch нужно согласовать с банком окно уникальности и ранее использованные номера merchant; до этого автоматическое расширение/переиспользование диапазона запрещено.

## Следующая рекомендуемая фаза

**Продолжение PHASE 7B** после получения merchant/security данных. Не PHASE 8. Ни отключение проверки подписи, ни переход к следующей фазе автоматически не выполняются.
