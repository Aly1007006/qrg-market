# Зафиксированные ограничения QRG MARKET

Краткая памятка по принятому MASTER CONTEXT; не заменяет полный документ пользователя. В новой независимой AI-сессии пользователь предоставляет MASTER CONTEXT заново.

- Работать только по отдельной команде PHASE X; следующую фазу автоматически не выполнять.
- Modular monolith: Next.js → NestJS REST → PostgreSQL. TypeScript strict, pnpm workspace. Drizzle, PostGIS, FTS/pg_trgm, Docker, S3-compatible storage.
- QRG — локальная витрина Караганды. Покупатель платит продавцу напрямую. QRG не принимает оплату товара, не хранит buyer payments, seller wallets/balances, payouts, escrow; нет комиссии с продаж в MVP.
- Покупательская сущность CustomerRequest/Lead, статусы NEW/VIEWED/CONTACTED/CONFIRMED/CLOSED/REJECTED. CONFIRMED не означает оплату. Просмотр, WhatsApp, 2GIS и заявки доступны без регистрации.
- Доход QRG — QRG BUSINESS, 10 000 KZT/месяц с продавца. Optional trial выключен по умолчанию. Подписки ACTIVE/PAST_DUE/GRACE/SUSPENDED/CANCELLED; grace 5 дней. При suspension данные сохраняются, витрина скрывается, кабинет и оплата доступны.
- Публичны только ACTIVE магазины после admin verification и активной подписки. Shop states: DRAFT/PENDING_VERIFICATION/CHANGES_REQUESTED/VERIFIED/ACTIVE/SUSPENDED/REJECTED.
- Seller роли SHOP_OWNER/SHOP_MANAGER/SHOP_EMPLOYEE; разрешения вычисляются через authenticated user → shop_members → permission → resource. Никогда не доверять frontend shop_id/owner_id/role. Обязательны IDOR/BOLA/horizontal escalation tests.
- ADMIN имеет отдельную защищённую area, обязательные 2FA, audit и контролируемые sessions.
- Auth: opaque server-side sessions, hash токена в БД, HttpOnly/Secure/SameSite cookie, Argon2id, CSRF и auth abuse protection.
- Halyk ePay через PaymentProvider abstraction; интеграции только по актуальной официальной документации. Backend определяет сумму; activation после server verification. Проверки merchant/payment/amount/currency/status/association/signature/replay, UNIQUE provider_payment_id, transactional idempotency. PAN/CVV/PIN/OTP/3DS не хранить.
- PostgreSQL: FK/UNIQUE/CHECK/indexes/transactions. Не создавать сложную reservation/WMS. Seller отвечает за availability.
- 2GIS: проверяемые HTTPS ссылки на официальные домены; WhatsApp: нормализованный номер, корректное URL encoding. Реализация в будущих фазах.
- Upload JPEG/PNG/WEBP до 10 MB, максимум 10 фото; MIME/decode/dimensions/EXIF removal/resize, безопасные случайные S3 keys; SVG/HTML запрещены.
- Минимизировать ПД; consent по типу, версии, времени и subject reference. Marketing отдельно, выключен. Основная БД ПД, backups и соответствующие logs — Казахстан. Yandex Cloud KZ плюс независимая encrypted backup copy у второго KZ-провайдера и restore tests.
- DB/private admin/debug/metrics порты не публиковать в интернет. Секреты — secret manager, не git. Не логировать secrets, passwords/hashes/tokens, authorization, тела заявок с телефонами. Raw IP не использовать как постоянный analytics identifier.
- Публичный UI: светлый, графитовый текст, золотисто-песочный accent, mobile-first, semantic HTML, accessibility и SEO; не создавать фальшивые reviews/ratings/counts.
- Не добавлять Redis, microservices, Kubernetes, брокеры, OpenSearch/Elasticsearch или глобальное client state без доказанной необходимости. В MVP нет reviews, доставки QRG, мобильного приложения, AI поиска/рекомендаций и loyalty/WMS.
- После каждой фазы: typecheck, lint, относящиеся tests, существующие critical tests, production build; исправить ошибки. Не удалять tests, не отключать TS/security, не использовать any для обхода, не подменять production mocks.
- Отчёт: Сделано; Изменённые файлы; Database; Security; Tests; Typecheck; Lint; Production Build; Известные проблемы; Технический долг; Следующая рекомендуемая фаза (не выполнять).
