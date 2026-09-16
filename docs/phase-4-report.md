# PHASE 4 — итоговый отчёт

## Сделано

- Рабочий кабинет `/seller`: вход/регистрация, выбор магазина, создание DRAFT,
  товары, настройки магазина, сотрудники и управление сессиями.
- Список, создание, редактирование, availability вариантов, архивирование,
  загрузка/просмотр/удаление фотографий. Архивирование не удаляет данные.
- Навигация содержит все восемь разделов. Заявки и подписка — явные заглушки;
  статистика использует только реальные доступные товары и статусы.
- Сохранены архитектура и conventions предыдущих фаз. sites-building помог
  сохранить design system и доступные формы, без смены стека или хостинга.
- Multipart upload, Sharp pipeline, S3 adapter, durable upload intents,
  автоматическая очистка и отдельная CLI-команда.
- Локальные Docker-контейнеры обновлены, production deployment не выполнялся.

## Изменённые файлы

Основные:

- `apps/api/src/media/{controller,processor,service,storage,maintenance,cleanup-main}.ts`.
- `apps/api/src/{app.module,db/schema}.ts`, `auth/{guards,metadata}.ts`.
- `apps/api/src/catalogue/{seller.controller,seller.service,public.service}.ts`.
- `apps/api/src/shops/service.ts`.
- `apps/api/drizzle/0003_loose_pride.sql`, migration journal/snapshot.
- `apps/web/app/seller/`, `apps/web/components/seller/forms.tsx`.
- `apps/web/app/api/{seller,images}/`, `apps/web/lib/seller/`.
- `apps/web/lib/catalogue/contract.ts`, cards/product page, shell, CSS, Next config.
- Media integration/unit tests, seller BFF tests, `scripts/seller-smoke.mjs`.
- Package manifests/lockfile, env examples, Compose, CI workflow.
- `docs/phase-4-architecture.md`, этот отчёт.

## Database

Миграция `0003_loose_pride.sql` применена в local и отдельной test DB.
Добавлена `media_objects`: PK object_key, nullable product FK с SET NULL,
timestamps, state/retry_at, CHECK ограничений и два индекса.
Существующие product_images сохраняют unique product-position, position 0..9,
проверку object key и размеров. Binary image data не записывается в БД.
Предыдущие применённые миграции не переписывались; всего четыре миграции.

## Security

Проверены IDOR/BOLA, подмена shop/product/variant/member ID, массовое назначение
shop_id/role/permissions, CSRF, сессии, горизонтальное повышение привилегий.
Новые image routes проверяют права до multipart parsing и повторно перед attach.
Проверены MIME spoofing, SVG/HTML/executable payload, corrupt images, 10 MiB,
resize, удаление EXIF, конкурентный лимит десяти фотографий, чужой read/delete,
отзыв membership во время PUT и потеря подтверждения после записи в S3.
Проверены orphan cleanup и сохранность attached images.
Next image optimizer не позволяет кешировать upload endpoints.
`pnpm audit --prod --audit-level=high`: известных уязвимостей не найдено.

## Tests

- `pnpm test`: 35/35 (20 API + 15 web).
- `pnpm test:db`: 43/43 существующих integration-теста.
- `pnpm test:media`: 8/8 с настоящими PostgreSQL и local S3.
- `pnpm test:seller:smoke`: 9/9 (8 media повторно + полный built Next/BFF flow).
- `pnpm test:catalog:smoke`: 14/14 (13 catalog повторно + built public SSR).
- `pnpm test:smoke`: 2/2.
- `pnpm test:web:preview`: 8/8.

Всего 98 различных тестов; перечисленные smoke-команды повторяют часть suites.
Тестовые данные удалены по конкретным fixture ID и object keys.
Проверки выполнены программно через unit/HTTP/SSR, без ручного browser-click QA.

В ходе работы исправлены неправильный working directory media-test команды,
multipart parts limit и ошибки типов/форматирования. Финальные прогоны зелёные.

## Typecheck

`pnpm typecheck`: успешно, TypeScript strict сохранён, без any-обходов.

## Lint

`pnpm lint`: успешно, ESLint и Prettier.

## Production Build

`pnpm build`: успешно для Next.js и NestJS.
Docker API/web images: успешно собраны и запущены локально.

## Известные проблемы

- Production S3 в Казахстане, credentials, bucket policy/encryption/backups
  и trusted reverse-proxy deployment ещё не настроены: эта фаза проверена локально.
- Сохраняется ранее обозначенное ограничение: реальный password-reset delivery
  provider не подключён. Его отсутствие не подменено успешной отправкой.
- Бренд в форме редактирования пока задаётся существующим UUID, а не поиском
  по названию; backend валидирует ссылку. Сотрудник также добавляется по user ID.

## Технический долг

- Улучшить выбор бренда в кабинете до поиска/списка по названию вместо UUID.
- Перед production настроить доверенную идентификацию клиента за BFF для
  раздельного IP rate limiting. Сейчас поддельные forwarded headers не принимаются,
  поэтому backend применяет общий upstream-IP лимит вместе с account limits.

## Следующая рекомендуемая фаза

PHASE 5 — CustomerRequest / заявки покупателей. Не запущена.
