# PHASE 8B — рабочий план

Статус: IN PROGRESS. Этот файл не является итоговым отчётом о готовности.

## Аудит

- EXISTING: Nest/Next, opaque sessions, shop_members authorization, product CRUD/variants, secure image pipeline и orphan cleanup, moderation и отдельные admin sessions/TOTP, subscriptions, immutable audit_logs, Phase 8 analytics.
- NEEDS IMPROVEMENT: форма товара с техническими ID, список без полезных фильтров, управление изображениями, admin permissions и навигация, объяснение публичности магазина.
- MISSING: Quick Add/Wizard, устойчивые черновики, duplicate/bulk, onboarding/checklist/academy, bootstrap с обязательной сменой пароля, platform admin roles, user/product/admin management.
- MUST NOT DUPLICATE: auth, media processor/storage, moderation, subscriptions/payment truth, analytics, audit log.

## Очерёдность

1. Серверные черновики и операции seller; tests tenant isolation/idempotency.
2. Quick Add/Wizard, изображения, список, обучение/onboarding.
3. Расширение существующих admin security и control center; bootstrap через secret injection.
4. Security tests, UX mobile 375/390/430, полный regression и quality gate.

## Ограничения

- Действующие пользовательские магазины и товары сохранить.
- Публичность требует существующих moderation/subscription условий.
- Gate Halyk PHASE 7B остаётся закрыт до проверки merchant integration.
- Bootstrap пароль не записывать в исходники, migration, logs или отчёты.
- PHASE 9 не запускать.
