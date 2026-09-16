# PHASE 7B — payment security audit и граница интеграции

Дата проверки: 13 сентября 2026. **Фаза не завершена. Реальные списания и callback-активация выключены.** Это локальная проверка кода и тестов, не банковская сертификация и не независимый PCI-аудит.

## Официальная документация — прочитана до integration code

Halyk выдаёт TerminalID, ClientID и ClientSecret после регистрации. Платёжная страница описывает обязательный `secret_hash`: значение магазина возвращается на postLink. Также предписана серверная проверка статуса. Формат цифровой подписи, подписываемые байты, signature header, алгоритм и ключ проверки в изученной публичной спецификации **не найдены**. Возвращаемый секрет не является цифровой подписью. Мы не подменяем требование MASTER CONTEXT собственным HMAC или проверкой только `code=ok`. Invoice — 6–15 цифр с дополнительной уникальностью последних шести. [Halyk: платёжная страница](https://epayment.kz/docs/platezhnaya-stranica).

Status API использует client credentials и terminal. В ответе `resultCode=100` означает успешный запрос, а не списание; `CHARGE` — списание, `AUTH` — блокировка суммы. Проверяются отдельные поля `id`, `invoiceID`, `terminalID`, `accountID`, `amount`, `currency`, `statusName`. [Halyk: статус транзакции](https://epayment.kz/docs/check-status-payment).

Официальные адреса OAuth и read-only проверки статуса:

| Среда      | OAuth POST                                         | Status GET prefix                                                     |
| ---------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| sandbox    | `https://test-epay-oauth.epayment.kz/oauth2/token` | `https://test-epay-api.epayment.kz/check-status/payment/transaction/` |
| production | `https://epay-oauth.homebank.kz/oauth2/token`      | `https://epay-api.homebank.kz/check-status/payment/transaction/`      |

Адреса и multipart-поля взяты из [официального status-контракта](https://epayment.kz/docs/check-status-payment); общий OAuth описан в [получении токена](https://epayment.kz/docs/poluchenie-tokena). Scope оставлен как в официальных примерах. Status/recurring OAuth token не покидает HTTP client; только отдельный invoice/amount-bound initial token формирует будущий hosted payload. До включения checkout необходимо подтвердить у банка ограничение прав такого токена конкретным платежом и согласовать минимальный scope.

Сохранённая карта использует CardID, `paymentType=cardId`, `recurrent` и `/payments/cards/auth`. Документация отдельно предупреждает о зависимости ответа от merchant-настроек 3DS; пример содержит `AUTH`, не `CHARGE`. Это не разрешение автоматически списывать средства и не доказательство включённого unattended recurring у QRG. [Halyk: платёж по сохранённой карте](https://epayment.kz/docs/platezh-po-sokhranennoi-karte).

## Что реализовано

- `PaymentProvider` расширен типизированными `PaymentReference` / `PaymentObservation`, методами status/callback. `SubscriptionService` импортирует только этот port, не Halyk. Для FreedomPay остаётся отдельный adapter за тем же port/factory; выдуманного Freedom API нет.
- `HalykPaymentProvider.getPaymentStatus` вызывает настоящий HTTP OAuth/status transport. В тестах transport инъецируется и полностью offline. Production factory не содержит test-success switch.
- Добавлены типизированные internal commands и низкоуровневые `HalykHttpClient.initialPayment` / `recurringPayment`. Hosted payload использует официальные sandbox/production `payment-api.js`; recurring — один POST `/payments/cards/auth`. Эти методы недоступны через application provider из-за hard gate, HTTP routes для них нет. Они не подключают оплату сами по себе.
- Payment OAuth всегда получает invoice и фиксированную backend сумму/валюту; для initial передаётся документированный `secret_hash`. В saved-card OAuth он не добавляется по аналогии: это поле там не описано. Commands и config копируются до await, лишние поля отбрасываются. UUID, длина invoice, форма HTTPS-ссылок и обязательные operation credentials проверяются до сети. Будущий coordinator должен брать return/postLink из утверждённого server config: проверка формы URL не является allowlist доменов QRG.
- Initial checkout не включает `cardSave`/`recurrent` без mandate и consent. Клиентский payload содержит только документированные поля и отдельный payment auth object; merchant secret и callback secret не возвращаются. CardID для recurring принимается только внутренней командой; хранилище mandate ещё не создано.
- Ответ recurring `AUTH` возвращает только ID и `PENDING_RECONCILIATION`, `3D` — только ID и `REQUIRES_ACTION`. Ни один не является ledger success. Challenge/3DS URLs и карточные/персональные поля не распространяются. Ошибки/timeout не вызывают повторный POST и не считаются подтверждённым отказом. Процесс повторной сверки и 3DS handoff ещё не подключён.
- Config opt-in: `HALYK_ENVIRONMENT=disabled` по умолчанию; выбранная среда требует выданные merchant credentials. Production запрещает sandbox и общий ClientID `test`. API URL не берётся из frontend/env.
- Реальный transport: фиксированные HTTPS endpoints, TLS штатного runtime без отключения проверки, redirect запрещён, OAuth POST без автоматических retry, 5 секунд на HTTP request, максимум 64 KiB ответа, JSON/type validation. Timeout/4xx/5xx/невалидный ответ даёт безопасный 503, не FAILED-платёж.
- Ожидаемая сумма берётся из `BUSINESS`: 1 000 000 minor units = 10 000 KZT. Strict equality без строкового/float coercion. Merchant, invoice, payment ID, subscription account должны точно совпасть с ожидаемым reference. В будущем accountId задаётся backend как UUID подписки; отсутствие/изменение поля отклоняется. Split/bonus amount не принимается без отдельно подтверждённого контракта.
- `CHARGE` даёт read-only observation SUCCEEDED. FAILED/REJECT — observation FAILED. Промежуточные состояния не активируют; refunds/cancellations/unknown требуют рассмотрения. Ответ без транзакции не доказывает identity/amount, поэтому не создаёт terminal outcome.
- Status/submission возвращают только безопасную проекцию. CardID/cardMask, PAN, CVV, PIN, OTP, 3DS, IP, email, raw response/body не записываются в БД/логи и не возвращаются через port. Merchant secrets не включаются в checkout payload; payment-scoped token предназначен только для банковской hosted формы, не хранения или логирования.

## Жёсткая граница безопасности

`available()` всегда false для Halyk, даже при credentials. `createInitialPayment`, `chargeRecurring`, `verifyCallback` возвращают 503. Отдельного callback HTTP route и CSRF-исключения нет. Seller renew остаётся owner-only с session/membership/CSRF и не создаёт попытку при закрытой интеграции. Success redirect не выполняет никаких действий.

**Status observation не является VerifiedPayment/ledger command.** Автоматического преобразования в `recordOutcome`, reconciliation CLI, ручного success endpoint или включения auto-renew нет. Существующий внутренний ledger имеет UNIQUE provider payment ID, транзакции, locks и идемпотентность. Мост от status fixture к ledger находится исключительно в `_test` integration suite, не в production build. Не использовать его как шаблон обхода callback authentication.

`PaymentReference` теперь собирается через `PaymentInvoiceBindings` из постоянной `payment_provider_bindings`, а не frontend. Привязка attempt/subscription/provider/environment/merchant/invoice создаётся в одной транзакции с попыткой оплаты; составной FK запрещает чужую подписку. Invoice определяется PostgreSQL sequence (100000–999999, NO CYCLE), а UNIQUE проверяет provider/environment/merchant/invoice. Шесть цифр обеспечивают также уникальность суффикса. UPDATE привязки запрещён DB trigger. Повтор idempotency key не создаёт новый invoice; rollback не возвращает использованный номер в sequence. Есть разрешение invoice → internal reference, read-only inspect, защита от чужого merchant/environment и замены provider у связанной попытки. Методы внутренние: HTTP route выдачи привязок/оплаты не добавлен, callback проверка остаётся закрытой.

Номера не перераспределяются после ошибок и не сбрасываются. Предел 900 000 выдач на БД — консервативное ограничение до подтверждения банком окна уникальности; при исчерпании sequence операция завершится ошибкой, а не повторным номером. Production acceptance должен подтвердить отсутствие конфликтов с ранее использовавшимися на данном merchant invoice. Данные банковской подписи/карты/mandate этой миграцией не выдумываются и не сохраняются. Replay policy и transactional обработчик **проверенного** callback ещё нужны; наблюдение status API по-прежнему не активирует подписку автоматически.

## Проверки и ограничения результатов

| Запрошенная проверка                       | Что проверено                                                                     | Что остаётся                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Fake success redirect                      | HTTP не активирует; неизвестный query отклоняется                                 | Реальный bank return flow                                       |
| Invalid signature                          | Любой callback, в том числе с поддельной signature, отклоняется                   | Криптографическая проверка настоящей подписи **не реализована** |
| Wrong amount/currency                      | Status adapter отвергает; ledger не меняется                                      | Bank acceptance                                                 |
| Merchant / payment ID / wrong subscription | Точное совпадение полей, чужой shop/renew запрещён; durable invoice binding и FK  | Bank acceptance                                                 |
| Duplicate callback / replay                | Поддельные callbacks отвергаются; duplicate ledger event даёт один receipt/period | Подписанные callback E2E                                        |
| Reused payment ID                          | Реальный PostgreSQL UNIQUE и rollback всей операции                               | Bank acceptance                                                 |
| Delayed callback                           | Offline поздний status + ledger после grace/suspension                            | Доставка настоящего callback                                    |
| Successful first payment                   | Offline CHARGE fixture + ledger activation                                        | Hosted checkout и списание                                      |
| Successful recurring                       | Offline CHARGE fixture + ledger renewal                                           | Mandate, consent, recurring dispatcher и списание               |
| Failed recurring                           | Offline FAILED fixture + PAST_DUE; AUTH/timeout не settlement                     | Настройки recurring/3DS и реальные отказы                       |

Tests используют только отдельную PostgreSQL `_test`, синтетические credentials/HTTP responses, без запросов в sandbox или production Halyk. Успешные offline tests **не означают подключения Halyk**.

Дополнительно `halyk.commands.test.ts` проверяет 12 wire/security сценариев: точные запросы initial/recurring, фиксированную сумму и whitelist payload, AUTH/3D, mismatch полей, отсутствующие operation credentials, небезопасные URL, невалидный OAuth, редактирование данных во время await, неоднозначный отказ/redirect/timeout без повторного списания, production endpoints через offline transport и невозможность обхода hard gate даже полной командой. Это проверка реализации публичного контракта, не банковская приёмка.

## Что предоставить для продолжения PHASE 7B

1. Выданные именно QRG TerminalID, ClientID и ClientSecret отдельно для нужных сред. Secret — через environment/Lockbox, не чат, git или CI logs. В текущем окружении соответствующие переменные не найдены; actual `.env` с merchant credentials в проекте также не обнаружен.
2. Официальную merchant-спецификацию подписи callback: алгоритм, поле/header, точные подписываемые данные, ключ/сертификат, key rotation, timestamp/replay/retry правила и контрольные примеры. Если для выбранного продукта банк подпись не предоставляет — требуется явное решение владельца об изменении требования на bank-supported `secret_hash` + authenticated status verification. Такое решение здесь не принято.
3. Подтверждённые банком настройки terminal: режим авторизации/списания, обработка AUTH, recurring/card-save и 3DS, поведение при ambiguous POST/повторной invoice, возможности reconciliation и ограничения uniqueness. Нельзя отключать 3DS ради удобства.
4. Публичные HTTPS адреса QRG (return/postLink), регистрация их у банка по его требованиям; инфраструктура/секреты/логи в допустимом KZ размещении.
5. Утверждённый текст отдельного recurring-payment consent и процесс его отзыва. До этого ни карта, ни CardID не сохраняются; auto-renew не включается.

После подтверждения контракта: закончить write-side и mandate persistence, используя уже реализованный invoice binding; подключить checkout, verified idempotent transactional callback, ambiguous-attempt reconciliation, recurring consent/dispatcher/cancellation; выполнить все quality gates и отдельные разрешённые bank acceptance tests. Не перескакивать к PHASE 8 и не снимать hard gate простым изменением `available()`.
