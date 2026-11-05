# Руководство по закрытой публикации, инфраструктуре и обновлению (DEPLOYMENT.md)

Документ описывает архитектуру публикации **QRG MARKET**, варианты закрытого хостинга (чтобы сайт и исходный код были доступны только вам, вашему другу и приглашённым пользователям), настройку сервера, базы данных, файлового хранилища, резервного копирования и автоматического обновления.

---

## 1. Архитектурные требования проекта к хостингу

**QRG MARKET** — это полноценное full-stack приложение, поэтому статический хостинг (вроде GitHub Pages) для него **не подходит**. Для работы сайта требуются 4 компонента:

1. **Frontend (`apps/web`)**: Серверное приложение Next.js 16.3.4 (App Router, SSR, Route Handlers для безопасного проксирования запросов к API с проверкой `Origin` и `QRG_INTERNAL_PROXY_SECRET`).
2. **Backend (`apps/api`)**: Сервер NestJS 12.0.1 (`/api/v1`), отвечающий за бизнес-логику, авторизацию, сессии, TOTP 2FA, модерацию, каталог и обработку медиафайлов через `sharp`.
3. **База данных (`PostgreSQL 17`)**: С обязательными расширениями **PostGIS** (геокоординаты бутиков) и **`pg_trgm`** (быстрый полнотекстовый и триграммный поиск по каталогу).
4. **Объектное S3-хранилище (`Media Storage`)**: Для хранения проверенных и перекодированных фотографий товаров и брендинга бутиков (в локальном/VPS-стеке используется встроенный контейнер **SeaweedFS S3**, в облаке — Managed S3 Bucket).

---

## 2. Сравнение вариантов закрытого хостинга и стоимости

> **Примечание:** Никакие платные сервисы не были подключены автоматически. Вы можете выбрать подходящий вариант ниже и развернуть проект по готовым конфигурациям из репозитория (`compose.preview.yaml` или `infra/terraform/yc-kz`).

| Вариант                                                                                                                             | Архитектура                                                                                                                                                                                                           | Как закрыть доступ от посторонних                                                                                                                                                                                       | Примерная стоимость                                                                                                                                                 | Кому подходит                                                                                                 |
| :---------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------ |
| **Вариант 1 (Рекомендуемый для совместной разработки и закрытого превью): Выделенный VPS + Docker Compose + Cloudflare Zero Trust** | Один Linux-сервер (Ubuntu 24.04 LTS, 4 vCPU, 8 GB RAM, 80 GB NVMe), где в Docker Compose (`compose.yaml` + `compose.preview.yaml`) работают `web`, `api`, `db` (PostgreSQL 17 + PostGIS) и `storage` (SeaweedFS S3).  | **Cloudflare Access (Zero Trust)** перед сайтом (пускает только по email-списку вас и друга через одноразовый PIN/Google/GitHub) + закрытые порты БД/API на фаерволе (`127.0.0.1`) + `X-Robots-Tag: noindex, nofollow`. | **VPS**: ~\$12–\$25 / мес (Hetzner, DigitalOcean, PS.kz, Servercore KZ)<br>**Cloudflare Zero Trust**: \$0 (бесплатно до 50 пользователей)<br>**Домен**: ~\$10 / год | Идеально для закрытого тестирования и совместной работы вдвоём с другом без переплаты за облачный Kubernetes. |
| **Вариант 2 (Локальный запуск + Закрытый туннель Cloudflare / Tailscale)**                                                          | Сайт запускается на вашем ПК или ПК друга через `pnpm dev:docker`. Доступ для второго участника открывается через приватную сеть **Tailscale VPN** или защищённый **Cloudflare Tunnel** со списком разрешённых email. | Доступен только устройствам внутри вашей приватной сети Tailscale или авторизованным участникам Cloudflare Access.                                                                                                      | **\$0 / мес** (полностью бесплатно)                                                                                                                                 | Отлично подходит для быстрой демонстрации друг другу в реальном времени без аренды сервера.                   |
| **Вариант 3 (Production KZ Cloud — Yandex Cloud Kazakhstan `kz1-a`)**                                                               | Полная промышленная инфраструктура, уже описанная в `infra/terraform/yc-kz` и `infra/k8s/production`: Managed Kubernetes, Managed PostgreSQL (c TLS), Object Storage S3, KMS, Lockbox.                                | Сетевые политики (VPC Security Groups), закрытый Ingress / WAF, строгая аутентификация и `QRG_PUBLIC_INDEXING_ENABLED=false` до момента публичного релиза.                                                              | **~\$180–\$350 / мес** в зависимости от размера кластера и БД                                                                                                       | Для коммерческого запуска с высокой нагрузкой и строгим соблюдением локализации ПДн в РК.                     |

---

## 3. Как закрыть опубликованный сайт от посторонних пользователей и поисковиков

В проекте уже встроены механизмы защиты от публичной индексации, которые дополняются защитой на уровне периметра:

### Уровень 1. Запрет индексации поисковиками (встроено в код)

По умолчанию в проекте переменная `QRG_PUBLIC_INDEXING_ENABLED` установлена в `false`:

- Маршрут `/robots.txt` отдаёт `Disallow: /` для всех поисковых роботов.
- Все страницы возвращают HTTP-заголовок `X-Robots-Tag: noindex, nofollow, noarchive`.

### Уровень 2. Закрытие входа на сайт на уровне периметра (Cloudflare Zero Trust Access или Nginx Basic Auth)

Чтобы посторонний человек даже по прямой ссылке не увидел витрину сайта:

- **Через Cloudflare Zero Trust (рекомендуется)**:
  1. Подключите ваш домен к Cloudflare и направьте поддомен (например, `staging.qrg-market.kz`) на IP сервера.
  2. В панели **Cloudflare Zero Trust → Access → Applications** нажмите **Add an application → Self-hosted**.
  3. Укажите домен сайта и создайте политику **Allow**: в правиле `Include → Emails` укажите только ваш email и email вашего друга.
  4. Теперь при открытии сайта любой посетитель сначала видит экран входа Cloudflare и не может попасть на сайт без подтверждения кода с вашей почты или почты друга.
- **Через Reverse Proxy (Caddy / Nginx Basic Auth + IP Allowlist)**:
  Вы можете закрыть весь сайт паролем на уровне веб-сервера Caddy или Nginx до загрузки приложения.

### Уровень 3. Внутренняя авторизация приложения

- **Кабинет продавца (`/seller/login`)**: защищён серверными HttpOnly/SameSite=Strict сессиями, Argon2id хешированием паролей и CSRF-токенами.
- **Админ-панель (`/admin/login`)**: использует изолированный контур сессий, обязательную двухфакторную аутентификацию **TOTP 2FA** (с шифрованием секретов ключом `ADMIN_MFA_ENCRYPTION_KEY`) и ролевую модель (`SUPER_ADMIN`, `MODERATION_ADMIN`, `SUPPORT_ADMIN`, `FINANCE_ADMIN`).

---

## 4. Пошаговое развёртывание на закрытом сервере (VPS с Ubuntu 24.04 LTS)

### Шаг 4.1. Подготовка сервера и фаервола

Подключитесь к серверу по SSH и установите Docker с плагином Compose, а также закройте все внешние порты, кроме SSH (22), HTTP (80) и HTTPS (443):

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw

# Установка официального Docker Engine и Docker Compose
curl -fsSL https://get.docker.com | sudo sh

# Настройка фаервола UFW (порты 3000, 3001, 5432, 8333 закрыты снаружи!)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### Шаг 4.2. Клонирование закрытого репозитория на сервер

Создайте Deploy Key (только для чтения репозитория) и добавьте его в GitHub (`Settings → Deploy keys`):

```bash
ssh-keygen -t ed25519 -C "qrg-server-deploy" -f ~/.ssh/qrg_deploy -N ""
cat ~/.ssh/qrg_deploy.pub
```

Настройте SSH-конфиг и склонируйте репозиторий:

```bash
cat << 'EOF' >> ~/.ssh/config
Host github.com
  IdentityFile ~/.ssh/qrg_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

sudo mkdir -p /opt/qrg-market
sudo chown $USER:$USER /opt/qrg-market
git clone git@github.com:<ИМЯ_ОРГАНИЗАЦИИ>/qrg-market.git /opt/qrg-market
cd /opt/qrg-market
```

### Шаг 4.3. Настройка серверных секретов (`.env.preview`)

Сгенерируйте криптографически стойкие секреты на сервере (никогда не коммитьте этот файл в Git):

```bash
cat <<EOF > /opt/qrg-market/.env.preview
POSTGRES_DB=qrg_market
POSTGRES_USER=qrg_market
POSTGRES_PASSWORD=$(openssl rand -hex 24)
AUTH_RATE_LIMIT_SECRET=$(openssl rand -hex 32)
QRG_INTERNAL_PROXY_SECRET=$(openssl rand -hex 32)
ADMIN_MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)
S3_ACCESS_KEY_ID=qrg_s3_$(openssl rand -hex 8)
S3_SECRET_ACCESS_KEY=$(openssl rand -hex 24)
APP_ORIGIN=https://ваш-закрытый-домен.example.com
QRG_SITE_URL=https://ваш-закрытый-домен.example.com
QRG_MEDIA_ORIGIN=https://ваш-закрытый-домен.example.com
QRG_PUBLIC_INDEXING_ENABLED=false
EOF
chmod 600 /opt/qrg-market/.env.preview
```

### Шаг 4.4. Запуск контейнеров

```bash
cd /opt/qrg-market
docker compose --env-file .env.preview -f compose.yaml -f compose.preview.yaml --profile app up -d --build --wait
```

Все сервисы (`web`, `api`, `db`, `storage`) запустятся во внутренней сети Docker, а наружу на `127.0.0.1:3000` и `127.0.0.1:8333` будут проброшены только loopback-порты для HTTPS reverse-proxy.

### Шаг 4.5. Настройка HTTPS (Caddy с автоматическим SSL-сертификатом Let's Encrypt и Basic Auth)

Установите Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Сгенерируйте хеш пароля для закрытого входа на сайт (`caddy hash-password`) и настройте `/etc/caddy/Caddyfile`:

```caddyfile
ваш-закрытый-домен.example.com {
    # Дополнительная защита паролем на уровне сервера (помимо Cloudflare Zero Trust)
    basicauth {
        owner $2a$14$ВАШ_ХЕШ_ПАРОЛЯ_ИЗ_CADDY
        friend $2a$14$ХЕШ_ПАРОЛЯ_ДРУГА_ИЗ_CADDY
    }

    # Проксирование обработанных изображений из S3
    handle /qrg-media-local/* {
        reverse_proxy 127.0.0.1:8333
    }

    # Проксирование основного веб-приложения Next.js
    handle {
        reverse_proxy 127.0.0.1:3000
    }
}
```

Перезапустите Caddy:

```bash
sudo systemctl reload caddy
```

---

## 5. Автоматическая проверка (CI) и обновление сайта (CD)

### 5.1. Как работает проверка кода в GitHub Actions

В файле [`.github/workflows/ci.yml`](.github/workflows/ci.yml) уже настроен полный конвейер проверки (`Quality` + `Docker Build`):

1. При каждом `push` в `main` или создании `Pull Request` поднимается контейнер PostgreSQL 17 + PostGIS.
2. Проверяется целостность исходников (`pnpm source:check`), форматирование (`pnpm format:check`), линтер (`pnpm lint`) и типы (`pnpm typecheck`).
3. Запускаются unit-тесты (`pnpm test`), миграции (`pnpm db:migrate`) и интеграционные тесты БД (`pnpm test:db`, `pnpm test:requests`, `pnpm test:admin`, `pnpm test:subscriptions`).
4. Выполняется production-сборка (`pnpm build`), smoke-тесты (`pnpm test:smoke`, `pnpm test:catalog:smoke`, `pnpm test:requests:smoke`, `pnpm test:admin:smoke`, `pnpm test:subscriptions:smoke`), проверка безопасности пакетов (`pnpm audit`) и тестовая сборка Docker-образов (`api` и `web`).
5. **Защита от поломки сайта**: если хотя бы один тест или сборка завершается с ошибкой, пайплайн блокируется и сломанный код не попадает в релиз.

### 5.2. Как обновлять сайт одной командой (или через GitHub Actions SSH Deploy)

На сервере создайте скрипт `/opt/qrg-market/update-site.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd /opt/qrg-market
git fetch origin main
git checkout main
git pull --ff-only origin main

docker compose --env-file .env.preview -f compose.yaml -f compose.preview.yaml --profile app up -d --build --wait
docker image prune -f
echo "QRG MARKET успешно обновлён до коммита $(git rev-parse --short HEAD)"
```

Сделайте его исполняемым (`chmod +x /opt/qrg-market/update-site.sh`).
При желании вы можете вызывать этот скрипт автоматически из GitHub Actions после успешного прохождения job `docker` (добавив SSH-ключ в `GitHub Settings → Secrets and variables → Actions`).

---

## 6. Резервное копирование (Backups), Мониторинг и Восстановление

### 6.1. Ежедневное резервное копирование базы данных PostgreSQL

Создайте скрипт `/opt/qrg-market/backup-db.sh` и добавьте его в `crontab -e` (например, каждый день в `03:00`):

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/qrg-market"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
docker compose --env-file /opt/qrg-market/.env.preview -f /opt/qrg-market/compose.yaml -f /opt/qrg-market/compose.preview.yaml exec -T db \
  pg_dump -U qrg_market -d qrg_market -Fc > "$BACKUP_DIR/qrg_db_${TIMESTAMP}.dump"

# Хранить локальные дампы за последние 14 дней
find "$BACKUP_DIR" -type f -name "qrg_db_*.dump" -mtime +14 -delete
```

Подробный регламент восстановления из бэкапа и проверки целостности описан в [`docs/operations/restore.md`](docs/operations/restore.md).

### 6.2. Мониторинг и проверка работоспособности

- **Liveness probe API**: `GET /api/v1/health` — проверяет, что процесс API запущен.
- **Readiness probe API**: `GET /api/v1/health/ready` — проверяет реальное соединение с PostgreSQL (`SELECT 1`).
- **Просмотр логов контейнеров**:
  ```bash
  docker compose --env-file .env.preview -f compose.yaml -f compose.preview.yaml logs -f --tail=100 web api
  ```
- Полные эксплуатационные инструкции по мониторингу и реагированию на инциденты находятся в:
  - [`docs/operations/deployment.md`](docs/operations/deployment.md)
  - [`docs/operations/monitoring-alerts.md`](docs/operations/monitoring-alerts.md)
  - [`docs/operations/incident-response.md`](docs/operations/incident-response.md)
