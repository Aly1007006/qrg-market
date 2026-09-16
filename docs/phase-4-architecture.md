# PHASE 4 — кабинет продавца и изображения

## Границы фазы

Сохранены Next.js App Router, NestJS REST `/api/v1`, Drizzle/PostgreSQL,
существующая авторизация PHASE 1 и каталог PHASE 3. Новые packages не нужны.
Нет покупательских платежей, WMS, заявок, подписок или admin panel.

`/seller/login` — регистрация/вход через существующий AuthService.
`/seller` — доступные пользователю магазины и создание DRAFT.
`/seller/[shopId]` — обзор; подразделы `products`, `requests`, `statistics`,
`subscription`, `shop`, `employees`, `settings`. Заявки и подписка явно
обозначены как будущие разделы. Статистика не имитирует просмотры/продажи:
пока доступны реальные товары и их статусы.

Server Components получают данные только из Nest, без доступа к БД.
Client Components используются для форм, загрузки и смены наличия.
Сохранены компоненты и светлая графитово-песочная система PHASE 2; skill
sites-building использован для согласованного интерфейса и доступных форм,
без смены стека, авторизации или хостинга. Публикация в Sites не выполнялась.

## Авторизация и BFF

`/api/seller/[...path]` проксирует только перечисленные маршруты и HTTP-методы.
Запрещены произвольный upstream URL, redirects и неподдерживаемые параметры.
В backend передаются только session cookie и нужные security headers.
Opaque token не попадает в JavaScript/localStorage; cookie задаёт backend.
Для mutation обязательны точный `QRG_APP_ORIGIN`, `x-qrg-client: web` и
session-bound CSRF. `QRG_APP_ORIGIN` должен совпадать с Nest `APP_ORIGIN`.
Host/X-Forwarded-* не являются источником доверия или идентификатором клиента.
Из-за этого auth rate limiter за BFF ограничивает также общий upstream IP:
отдельный trusted-proxy boundary потребуется при production-развёртывании.

Каждый seller endpoint повторно проверяет session → shop_members → permission
→ resource. Роль из shop API управляет лишь отображением UI, не полномочиями.
Сотрудники не могут менять настройки магазина, роли или владельца.
Редактирование сохраняет существующий brandId; настройки предварительно
загружают адрес, координаты и контакты. Архивация меняет статус, не удаляет данные.

## Изображения

POST `/shops/:shopId/products/:productId/images`, multipart поле `file`.
DELETE `.../images/:imageId`. GET `.../images/:imageId/content` — private read.
GET `/public/images/:imageId` — только PUBLISHED + ACTIVE.

1. Global Origin/CSRF/session guards и resource guard ДО multipart parsing.
2. Не более двух upload pipelines на процесс, без неограниченной очереди.
3. Multer: один файл, ноль дополнительных полей, 10 MiB исходных данных.
4. Allowlist MIME + сигнатура JPEG/PNG/WEBP; original filename не используется.
5. Sharp: реальное декодирование, строгий failOn, до 40 млн пикселей,
   стороны до 12000 px, одна страница/кадр. Decode timeout 15 секунд.
6. EXIF orientation применяется, metadata/EXIF удаляются; resize до 2000×2000
   внутри исходного aspect ratio без увеличения; выход WebP quality 85.
7. В БД резервируется durable PENDING intent, затем выполняется S3 PUT вне
   DB transaction. Ключ: `products/<product UUID>/<random UUID>.webp`.
8. После PUT заново проверяются session/membership/product; image row и
   ATTACHED intent фиксируются одной транзакцией. Переданные shop_id/role/key
   не могут назначить владельца или путь файла.

Shop row lock сериализует резервирования/добавления; при лимите учитываются
сохранённые фото и PENDING intents. DB unique product-position + CHECK 0..9
дополнительно ограничивают товар десятью фотографиями. Binary в БД нет.

S3 bucket приватный. Next image proxy не кеширует и не передаёт caller URL.
Загруженные фото не проходят повторный Next optimizer; его localPatterns
не разрешают `/api/images` или `/api/seller`. Это не даёт обойти смену
публичного статуса через старый optimizer URL. Уже скачанные пользователем
копии, как любые опубликованные изображения, технически отозвать нельзя.

## Очистка

`media_objects`: key PK, nullable product FK ON DELETE SET NULL, state,
created_at, retry_at, индексы и CHECK. Журнал сохраняется при удалении товара.
Миграция `0003_loose_pride.sql` не изменяет применённые миграции PHASE 1–3.

PENDING истекает через час. После удаления фото intent становится DELETING.
Фоновая обработка раз в минуту (не в test) берёт до 50 непривязанных записей,
использует FOR UPDATE SKIP LOCKED и часовую retry lease. Сетевой DELETE
выполняется вне DB transaction. Удаляются только записанные в журнал ключи,
никогда bucket или произвольный prefix. Ошибки логируются без secret/payload,
повтор возможен после retry lease. CLI: `pnpm media:cleanup`.

Неизвестные объекты, загруженные вручную в bucket вне приложения, этим
журналом не управляются. Для production нужен отдельный bucket приложения,
запрет внешних writers и lifecycle для незавершённых multipart uploads.
У приложения single PUT, оно не создаёт multipart upload sessions в S3.

## Local / production

Docker Compose поднимает SeaweedFS 4.46 в single-process mini режиме только
для local S3; наружу привязан только 127.0.0.1:8333, внутренние admin/filer
порты не публикуются. Локальные credentials явно демонстрационные.
`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` задают adapter без vendor lock-in.
Без storage config upload возвращает ошибку, а не успешный mock.

Production требует HTTPS endpoint и не принимает встроенные local credentials.
Bucket, access policy, server-side encryption, lifecycle и backups необходимо
создать в Казахстане; регион нельзя подтвердить по одному имени S3 endpoint.
Production credentials и deployment не входят в эту фазу и не создавались.
Secret manager должен предоставлять runtime secrets; web их не получает.

## Официальные источники интеграции

- [Sharp constructor и limits](https://sharp.pixelplumbing.com/api-constructor/).
- [Sharp output и metadata](https://sharp.pixelplumbing.com/api-output/).
- [AWS SDK v3: S3 operations](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html).
- [SeaweedFS mini](https://github.com/seaweedfs/seaweedfs/blob/master/README.md).
- [SeaweedFS 4.46](https://github.com/seaweedfs/seaweedfs/releases/tag/4.46).

Использованы Sharp 0.35.4 и S3 SDK 3.1127.0. Более свежий SDK 3.1128.0
не прошёл существующий minimumReleaseAge; политика не отключалась.

## Проверки

`pnpm test` — unit/security contracts. `pnpm test:db` — прежние auth/catalog
integration tests. `pnpm test:media` требует отдельную `*_test` БД и local
S3 config из API env example. `pnpm test:seller:smoke` выполняется после
`pnpm test:media` (test compilation) и `pnpm build`; проверяет собранный Next,
BFF, login/cookie, CSRF, SSR разделов, сохранение, private/public images,
архивацию и IDOR. Данные тестов и object keys удаляются по конкретным ID.
CI запускает эти проверки на disposable services. Тестовые fault-injection
обёртки S3 существуют только в test файле, production adapter настоящий.
