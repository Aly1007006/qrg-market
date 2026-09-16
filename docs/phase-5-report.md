# PHASE 5 — итоговый отчёт

## Сделано

- Гостевая заявка со страницы реального товара: имя, телефон, optional вариант,
  количество, optional получение/комментарий, обязательное unchecked согласие.
  Регистрация покупателя не требуется.
- CustomerRequest — обращение, не платёжный заказ. CONFIRMED подтверждает только
  обращение. Оплата напрямую продавцу, без buyer payment, reservation или WMS.
- Кабинет продавца: список, фильтр статуса, пагинация, защищённая карточка,
  изменение статуса с контролем конфликтующих обновлений.
- WhatsApp по проверенному нормализованному номеру: кодируемый текст товара и
  варианта, без персональных данных покупателя в URL. Действие открывает draft.
- Validation, plain-text sanitization, 8 KiB payload, rate limits, honeypot,
  signed challenge, атомарная дедупликация и CAPTCHA-ready adapter.
- Текст обработки данных и versioned consent record. Приём заявок по умолчанию
  выключен в production до утверждения эксплуатационных/privacy условий.
- Сохранены foundation и design system. sites-building использован для
  согласованных доступных форм, без смены Next/Nest/PostgreSQL или хостинга.
- Локальные Docker API/web обновлены; production deployment не выполнялся.

## Изменённые файлы

Основные:

- `apps/api/src/requests/{controller,dto,service,spam}.ts`.
- `apps/api/src/db/schema.ts`, `authorization/permissions.ts`, `app.module.ts`,
  `http.ts`, `catalogue/public.service.ts`.
- `apps/api/drizzle/0004_grey_sue_storm.sql`, journal и snapshot 0004.
- `apps/web/components/customer-request-form.tsx`, `product-options.tsx`,
  `seller/{requests,forms}.tsx`, `app/globals.css`.
- `apps/web/app/api/requests/route.ts`, seller BFF и seller page.
- `apps/web/app/privacy/requests/page.tsx`, `lib/customer-requests.ts`,
  catalogue model/contract и seller boundary.
- Request unit/integration tests API/web, migration-count assertion старого suite,
  `scripts/requests-smoke.mjs`.
- Package scripts, `.github/workflows/ci.yml`, API env examples, README,
  `docs/phase-5-architecture.md`, этот отчёт.

## Database

Миграция `0004_grey_sue_storm.sql` применена в local и отдельной test DB.
Всего пять миграций. Добавлены customer_requests и customer_request_status.
Составные FK обеспечивают согласованность shop/product/variant; RESTRICT защищает
заявки от каскадного удаления. CHECK ограничивают данные и consent type.
Добавлены индексы выборок, FK, дедупликации и UNIQUE submission hash,
unique variant association и updated_at trigger. Timestamps — timestamptz.
request_items не создавалась: сейчас одна заявка относится к одному товару.

Предыдущие применённые миграции не переписывались. Проверен ledger основной БД:
5 migrations, 0 customer_requests. Тестовые обращения не смешаны с основной БД;
volumes не удалялись.

## Security

Проверены guest Origin/custom header, отсутствие обязательной сессии, отказ при
неверном согласии/версии, некорректном телефоне/количестве, HTML, лишних полях,
подмене shop_id/role/status и payload >8 KiB.

Проверены honeypot, слишком ранний/истёкший/поддельный challenge, привязка к товару,
foreign variant, hidden product/shop, concurrent duplicate и изменённый replay,
phone normalization quota, отказ обходу IP-лимита через X-Forwarded-For.

Seller IDOR/BOLA: чужой shop/request ID, подмена shopId в теле, чтение и PATCH,
отзыв membership. Owner/manager/employee работают только в разрешённом магазине.
Проверены immutable consent при смене статуса, optimistic conflict и DB constraints.
Контакты/комментарии не попадают в публичный ответ или список заявок.
Сохранены существующие CSRF/session/upload/security checks.

`pnpm audit --prod --audit-level=high`: известных уязвимостей не найдено.
CAPTCHA не имитируется: обязательный режим без провайдера закрывает отправку.

## Tests

- `pnpm test`: 39/39 (22 API + 17 web).
- `pnpm test:db`: 43/43 существующих PostgreSQL integration-теста.
- `pnpm test:requests`: 10/10.
- `pnpm test:requests:smoke`: 11/11 (10 повторно + built guest/seller flow).
- `pnpm test:seller:smoke`: 9/9, включая 8 media/S3 security сценариев.
- `pnpm test:catalog:smoke`: 14/14 (13 catalog повторно + built SSR).
- `pnpm test:smoke`: 2/2.
- `pnpm test:web:preview`: 8/8.

Всего 113 различных тестов, без двойного учёта повторяемых suites.
Fixture записи очищены адресно в отдельной test DB. Проверки unit/HTTP/SSR;
ручной browser-click/a11y аудит не проводился.

В ходе работы исправлены порядок нового UNIQUE index перед FK в ещё не применённой
миграции, замечания ESLint к effect/unused аргументам и отображение скрытого поля
статуса. Финальные прогоны зелёные, тесты не удалялись.

## Typecheck

`pnpm typecheck`: успешно, strict TypeScript сохранён.

## Lint

`pnpm lint`: успешно, ESLint и Prettier.

## Production Build

`pnpm build`: успешно для Next.js и NestJS.
Docker API/web images собраны и запущены локально. API readiness, catalog,
seller login и privacy page возвращают 200. Новые routes присутствуют в OpenAPI.

## Известные проблемы

- До публичного приёма персональных данных нужны утверждённые реквизиты
  оператора, privacy-контакт, сроки хранения и процесс обработки обращений
  об исправлении/удалении. Production приём заявок по умолчанию выключен.
- За BFF все клиенты пока делят upstream IP quota: 30 POST / 15 минут,
  дополнительно действует 5 попыток на нормализованный телефон. Поддельные
  forwarded headers сознательно не принимаются. Нужна настройка trusted proxy.
- Реальный CAPTCHA provider не подключён; пользователь запросил готовую
  abstraction, она реализована. OTP подтверждения телефона нет.
- Production-инфраструктура/backup/logs в Казахстане и reset delivery provider
  остаются не настроены с предыдущих фаз; локальные проверки их не заменяют.
- Сохраняются UX-ограничения PHASE 4: бренд по UUID, добавление сотрудника по user ID.

## Технический долг

- Автоматическая очистка/анонимизация заявок по утверждённому сроку хранения
  ещё не реализована: срок нельзя назначить вместо владельца. Закрыть до production.
- Перенесённая из foundation настройка trusted client identity за BFF теперь
  нужна также для гостевых заявок; общий upstream лимит не подходит публичному трафику.

## Следующая рекомендуемая фаза

PHASE 6 — только после отдельной команды пользователя с её содержанием.
Не запущена; конкретные задачи следующей фазы не выдумывались.
