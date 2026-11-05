# Руководство по совместной разработке (COLLABORATION.md)

Документ описывает полный рабочий процесс совместной разработки проекта **QRG MARKET** для владельца проекта и второго администратора репозитория (друга) с использованием **GitHub Organization**, **Antigravity** и **VS Code**.

---

## 1. Настройка закрытого GitHub Organization и прав доступа (для Владельца)

Чтобы исходный код был гарантированно **закрытым (`Private`)**, а ваш друг получил максимальные права **Admin** на уровне репозитория без передачи вашего личного аккаунта и платёжных данных:

### Шаг 1.1. Создание GitHub Organization (если ещё не создана)

1. Войдите в свой аккаунт на [https://github.com](https://github.com).
2. Нажмите на свой аватар в правом верхнем углу → **Your organizations** → кнопка **New organization**.
3. Выберите бесплатный тариф **Create a free organization**.
4. Укажите:
   - **Organization account name**: например, `qrg-market-org` (или `qrg-fashion`).
   - **Contact email**: ваш рабочий email.
   - **This organization belongs to**: выберите **My personal account**.
5. Завершите создание организации. Вы являетесь **Organization Owner** (полный владелец).

### Шаг 1.2. Создание закрытого (Private) репозитория в Organization

> **ВАЖНО ПО БЕЗОПАСНОСТИ:** Если на вашем личном аккаунте ранее существовал публичный репозиторий `Aly1007006/qrg-market`, немедленно переведите его в `Private` или перенесите в организацию (`Settings` → в самом низу блок `Danger Zone` → `Change repository visibility` → `Make private`, затем `Transfer ownership` → выберите вашу Organization).

Для создания нового закрытого репозитория в организации:

1. На странице вашей организации нажмите **New repository**.
2. **Repository name**: `qrg-market`.
3. **Visibility**: выберите строго **Private** (Закрытый).
4. **Initialize this repository with**: оставьте все галочки пустыми (код и история коммитов уже подготовлены локально).
5. Нажмите **Create repository**.

### Шаг 1.3. Привязка локального проекта к закрытому репозиторию и отправка кода

В терминале PowerShell в папке проекта выполните:

```powershell
git remote set-url origin https://github.com/<ИМЯ_ВАШЕЙ_ОРГАНИЗАЦИИ>/qrg-market.git
git push -u origin main
```

### Шаг 1.4. Выдача другу роли ADMIN на уровне репозитория

1. Откройте ваш закрытый репозиторий `https://github.com/<ИМЯ_ВАШЕЙ_ОРГАНИЗАЦИИ>/qrg-market`.
2. Перейдите во вкладку **Settings** (в верхнем меню репозитория).
3. В левом боковом меню выберите **Collaborators and teams**.
4. Нажмите зелёную кнопку **Add people**.
5. Введите **GitHub username** или email вашего друга.
6. В списке ролей выберите **Admin** (полный доступ к коду, веткам, Pull Requests, настройкам репозитория и GitHub Actions без доступа к вашему личному аккаунту, другим репозиториям и биллингу организации).
7. Нажмите **Add `<username>` to this repository**.

---

## 2. Пошаговая инструкция для друга (от принятия приглашения до деплоя)

Ниже приведена полная инструкция из 17 шагов для второго разработчика (с правами **Admin** на репозитории).

### 1. Как принять приглашение в GitHub

1. Войдите в свой личный аккаунт GitHub.
2. Проверьте письмо на почте или перейдите напрямую по ссылке: `https://github.com/<ИМЯ_ОРГАНИЗАЦИИ>/qrg-market/invitations` (также уведомление появится в верхнем колокольчике на GitHub).
3. Нажмите **Accept invitation**. После этого вам доступен весь исходный код, ветки, GitHub Actions и настройки репозитория.

### 2. Как клонировать проект на компьютер

Убедитесь, что у вас установлен [Git](https://git-scm.com/). Откройте терминал (PowerShell на Windows или Terminal на macOS/Linux) и выполните:

```powershell
git clone https://github.com/<ИМЯ_ОРГАНИЗАЦИИ>/qrg-market.git
cd qrg-market
```

### 3. Как открыть проект в VS Code

1. Установите [Visual Studio Code](https://code.visualstudio.com/).
2. Откройте папку `qrg-market` через меню **File → Open Folder...** или командой из терминала:

```powershell
code .
```

3. Рекомендуемые расширения для VS Code:
   - **ESLint** (`dbaeumer.vscode-eslint`)
   - **Prettier - Code formatter** (`esbenp.prettier-vscode`)
   - **Docker** (`ms-azuretools.vscode-docker`)

### 4. Как открыть проект в Antigravity

1. Запустите **Antigravity IDE**.
2. Нажмите **Open Workspace / Folder** и выберите папку `qrg-market`.
3. В Antigravity вы можете ставить задачи ИИ-ассистенту по фронтенду (`apps/web`), бэкенду (`apps/api`), базе данных (`apps/api/drizzle`) и инфраструктуре (`compose.yaml`, `infra/`), а также запускать команды и тесты прямо в встроенном терминале.

### 5. Как установить зависимости

Проект использует:

- **Node.js**: `24.20.0` (указан в `.node-version` и `package.json`)
- **pnpm**: `11.26.0` (указан в `packageManager` в `package.json`)
- **Docker Desktop**: с поддержкой Linux-контейнеров.

Для установки зависимостей на хост-машине выполните в корне проекта:

```powershell
pnpm install --frozen-lockfile
```

> **Примечание:** Если вы запускаете сайт через `pnpm dev:docker` (или `node scripts/local-start.mjs`), контейнеры сами используют встроенные Node.js 24.20.0 и pnpm 11.26.0 внутри Docker.

### 6. Как настроить `.env` (переменные окружения)

Реальные `.env` файлы никогда не хранятся в Git в целях безопасности. Скопируйте шаблоны `.env.example`:

**На Windows (PowerShell):**

```powershell
Copy-Item .env.example .env
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/api/.env.test.example apps/api/.env.test
Copy-Item apps/web/.env.example apps/web/.env.local
```

**На macOS / Linux (Bash/Zsh):**

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.test.example apps/api/.env.test
cp apps/web/.env.example apps/web/.env.local
```

> Если вы используете `pnpm dev:docker`, скрипт `scripts/local-start.mjs` автоматически подготовит безопасные локальные переменные для контейнеров.

### 7. Как запустить проект локально

Есть два способа запуска (выберите удобный):

#### Вариант А (Рекомендуемый — полный стек в Docker одной командой):

Запустите Docker Desktop и выполните:

```powershell
pnpm dev:docker
```

_(или `node scripts/local-start.mjs`, если локальная версия pnpm отличается)._
Эта команда поднимет PostgreSQL 17 + PostGIS, локальное S3-хранилище SeaweedFS, применит миграции БД, соберёт и запустит API (`http://localhost:3001`) и Web (`http://localhost:3000`).

#### Вариант Б (БД в Docker, а Web и API в режиме hot-reload на компьютере):

```powershell
docker compose -f compose.yaml -f compose.host.yaml up -d --build --wait db
pnpm db:migrate
pnpm dev
```

После запуска откройте в браузере:

- **Публичная витрина**: `http://localhost:3000`
- **Кабинет продавца**: `http://localhost:3000/seller/login`
- **Админ-панель**: `http://localhost:3000/admin/login`
- **Swagger документация API**: `http://localhost:3001/api/docs`

### 8. Как редактировать страницы и дизайн

- Все страницы и маршруты находятся в `apps/web/app/`:
  - Главная витрина: `apps/web/app/page.tsx`
  - Каталог и категории: `apps/web/app/catalog/`, `apps/web/app/[categorySlug]/`
  - Карточка товара: `apps/web/app/product/[slug]/page.tsx`
  - Страница бутика: `apps/web/app/shop/[slug]/page.tsx`
  - Кабинет продавца: `apps/web/app/seller/[[...segments]]/page.tsx`
  - Админ-центр: `apps/web/app/admin/[[...segments]]/page.tsx`
- Общие стили и дизайн-система находятся в `apps/web/app/globals.css`.
- Компоненты витрины лежат в `apps/web/components/market/`, кабинета продавца — в `apps/web/components/seller/`, админ-панели — в `apps/web/components/admin/`.

### 9. Как добавлять новые функции и страницы

1. Для создания новой страницы добавьте папку с файлом `page.tsx` внутри `apps/web/app/` (Next.js App Router).
2. Для добавления новой вкладки в кабинет продавца:
   - Добавьте маршрут в `apps/web/app/seller/[[...segments]]/page.tsx` и пункт навигации в `apps/web/components/seller/workspace-shell.tsx`.
   - Например, вкладка **«Быстрое размещение»** (`/seller/[shopId]/quick-add`) реализована через компонент `ProductEditor` с режимом `mode="quick"` в `apps/web/components/seller/product-editor.tsx`.

### 10. Как работать с Backend (API)

- Исходный код API находится в `apps/api/src/` (NestJS 12).
- Основные модули:
  - `apps/api/src/auth/` — регистрация, вход, сессии, CSRF, TOTP 2FA.
  - `apps/api/src/catalog/` — публичный каталог, фильтрация, поиск, витрина магазинов.
  - `apps/api/src/seller/` — управление бутиком, товарами, вариантами, черновиками и быстрым размещением.
  - `apps/api/src/media/` — загрузка изображений, проверка сигнатур, перекодирование через `sharp` и сохранение в S3.
  - `apps/api/src/requests/` — заявки покупателей и интеграция с WhatsApp.
  - `apps/api/src/admin/` — модерация магазинов, управление пользователями, ролями и журнал аудита.
  - `apps/api/src/subscriptions/` — биллинг-логика подписок и адаптер Halyk ePay.
- Все входные данные проверяются через DTO (`class-validator`), лишние поля отвергаются (`forbidNonWhitelisted: true`).

### 11. Как работать с базой данных

- Схема базы данных описана на TypeScript с помощью **Drizzle ORM** в `apps/api/src/db/schema.ts`.
- SQL-миграции хранятся в `apps/api/drizzle/`.
- Основные команды для работы с БД:
  - Сгенерировать новую миграцию после изменения `schema.ts`:
    ```powershell
    pnpm db:generate
    ```
  - Применить миграции к локальной БД:
    ```powershell
    pnpm db:migrate
    ```
  - Очистить просроченные сессии и токены:
    ```powershell
    pnpm db:cleanup
    ```

### 12. Как получать последние изменения (от владельца проекта)

Перед началом работы всегда забирайте свежие изменения с GitHub:

```powershell
git checkout main
git pull origin main
```

Если в обновлениях изменились зависимости или контейнеры:

```powershell
pnpm install --frozen-lockfile
pnpm dev:docker
```

### 13. Как сохранять и отправлять свои изменения в GitHub

#### Работа через отдельную ветку и Pull Request (рекомендуется для крупных задач):

```powershell
# 1. Создать новую ветку под задачу
git checkout -b feat/new-feature-name

# 2. Проверить статус изменённых файлов
git status

# 3. Запустить форматирование и проверки перед коммитом
pnpm format
pnpm source:check
pnpm typecheck
pnpm lint
pnpm test

# 4. Добавить файлы и сделать коммит
git add .
git commit -m "feat: описание добавленной функции"

# 5. Отправить ветку в GitHub
git push -u origin feat/new-feature-name
```

После этого откройте репозиторий на GitHub и нажмите **Compare & pull request**, дождитесь зелёной галочки GitHub Actions (`Quality`) и нажмите **Merge pull request**.

#### Быстрая отправка напрямую в `main` (если ветка не заблокирована правилами):

```powershell
git pull origin main
pnpm format
pnpm source:check
git add .
git commit -m "Update project"
git push origin main
```

### 14. Как тестировать изменения перед публикацией

В проекте настроен строгий набор автоматических проверок. Выполните перед пушем:

```powershell
# Проверка окончания строк (только LF) и отсутствия BOM
pnpm source:check

# Проверка типов TypeScript во всех пакетах
pnpm typecheck

# Проверка линтером ESLint и Prettier
pnpm lint

# Быстрые unit-тесты API и Web
pnpm test

# Полная сборка production-бандлов Web и API
pnpm build
```

Для запуска интеграционных тестов с реальной тестовой БД PostgreSQL (`*_test`):

```powershell
pnpm test:db
pnpm test:smoke
```

### 15. Как обновлять опубликованный сайт

- При отправке изменений в ветку `main` автоматически запускается пайплайн `.github/workflows/ci.yml`, который проверяет сборку, тесты, миграции БД и Docker-образы.
- Для обновления закрытого сервера (VPS / Cloud):
  1. Подключитесь к серверу по SSH (или используйте настроенный GitHub Actions Deploy runner).
  2. Выполните обновление стека:
     ```bash
     git fetch origin main
     git checkout main
     git pull --ff-only origin main
     docker compose -f compose.yaml -f compose.preview.yaml --profile app up -d --build --wait
     ```
  Подробная инструкция приведена в [DEPLOYMENT.md](DEPLOYMENT.md).

### 16. Как откатить неудачное обновление (Rollback)

Если после обновления обнаружена ошибка:

1. Узнайте хеш предыдущего стабильного коммита:
   ```bash
   git log --oneline -n 5
   ```
2. В GitHub можно нажать кнопку **Revert** в смерженном Pull Request, либо через терминал создать обратный коммит:
   ```bash
   git revert HEAD
   git push origin main
   ```
3. На сервере для мгновенного возврата к предыдущей версии образа/коммита:
   ```bash
   git checkout <COMMIT_SHA_ПРЕДЫДУЩЕЙ_ВЕРСИИ>
   docker compose -f compose.yaml -f compose.preview.yaml --profile app up -d --build --wait
   ```
   _(Важно: миграции базы данных всегда пишите обратно-совместимыми по принципу expand-and-contract, чтобы откат кода не ломал схему БД)._

### 17. Правила безопасности при совместной работе

- **Никогда не добавляйте в Git** файлы `.env`, `.env.local`, `.env.production`, приватные ключи (`*.pem`, `*.key`), дампы БД (`*.sql`, кроме миграций) и папку `output/`.
- **Все файлы исходного кода** (`.ts`, `.tsx`, `.js`, `.mjs`, `.css`) должны использовать окончания строк **LF (`\n`)**, без CRLF (`\r\n`). В проекте есть файл `.gitattributes`, а скрипт `pnpm source:check` автоматически проверит это перед коммитом.
- **Не отключайте проверки безопасности**: CSRF, проверку `Origin` в `apps/web/app/api/seller/[...path]/route.ts` и `apps/web/app/api/admin/[...path]/route.ts`, а также 2FA для администраторов.
