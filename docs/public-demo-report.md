# QRG MARKET — временная публичная демонстрация

Дата: 5 октября 2026 года.

## Сделано

Создана и проверена публичная HTTPS-ссылка:

[Открыть демо QRG MARKET](https://troy-jane-kinda-whose.trycloudflare.com/).

Это отдельная демонстрация с существующим development fixture dataset, не production-развёртывание и не постоянный адрес. Рабочий локальный сайт на `http://localhost:3000` сохранён. Публичная демонстрация не подключена к его API, PostgreSQL или Object Storage.

Подняты отдельные контейнеры `preview` и `tunnel` проекта `qrg-market-public-preview`. Образ Cloudflare закреплён версией 2026.9.3 и полученным registry digest. Ссылка работает, пока компьютер, Docker, демо и туннель работают. После остановки и нового запуска туннеля адрес может измениться. Автозапуск постоянного публичного адреса не настроен.

## Изменённые файлы

- `compose.preview.yaml`: отдельная сеть, ресурсные ограничения, read-only filesystem, tmpfs, отсутствие опубликованных портов и реальных секретов.
- `scripts/public-preview-gateway.mjs`: ограниченный read-only gateway и запуск fixture frontend только на loopback внутри контейнера.
- `scripts/public-preview-gateway.test.mjs`: тесты границы публичного доступа.
- `Dockerfile`: отдельный target `public-preview`; рабочие runtime targets API и web не заменены.
- `package.json`: новые проверки добавлены к существующему `pnpm test`.
- `docs/public-demo-report.md`: этот отчёт.

## Database

Database: изменений нет. Миграции не выполнялись. Реальные аккаунты, магазины, товары, изображения и заявки не переносились в демо.

## Security

- Preview присоединён только к отдельной Docker-сети `preview` с `internal: true`, не к сетям рабочего приложения.
- Только контейнер туннеля имеет дополнительную исходящую сеть. Нет опубликованных портов preview, API, базы, storage или metrics туннеля.
- Все сервисы запускаются без Linux capabilities и с `no-new-privileges`; preview работает непривилегированным пользователем.
- Development frontend доступен только по loopback внутри preview. Публичный gateway разрешает лишь перечисленные страницы, статические ресурсы, локальные fixture изображения и fixture autocomplete.
- Заблокированы seller/admin, auth, CustomerRequest, payments, внутренние API, dev endpoints, WebSocket upgrade, sourcemaps и произвольные URL image optimizer.
- Gateway не передаёт cookies, Authorization, middleware bypass headers и Set-Cookie; не логирует тела запросов, телефоны или IP посетителей.
- Ограничены методы, URL/header size, время запросов, параллелизм и частота запросов. Не создавались исключения для рабочего CSRF или authorization.
- Индексация запрещена через HTML metadata, `X-Robots-Tag` и robots.txt.
- Docker build context исключает `.env`, реальный runtime environment не наследуется frontend-процессом.
- Трафик демонстрации проходит через внешний сервис Cloudflare. Это не подтверждение соответствия production-инфраструктуры требованиям Казахстана. В демо не следует вводить персональные данные, пароли или секреты; формы регистрации, заявок и оплаты недоступны.
- Настройки роутера, Windows Firewall и защиты TLS не менялись.

## Tests

- `pnpm test`: PASS, существующие unit/regression tests и 2 новых теста gateway.
- `pnpm test:smoke`: PASS, 2 проверки собранных production Next.js и API.
- `pnpm test:web:preview`: PASS, 13 проверок fixture UX, SSR, поиска, изображений и разграничения demo/live.
- `docker compose -f compose.preview.yaml config --quiet`: PASS.
- Проверки контейнера: главная, каталог, товар, магазин, fixture search — 200; кабинеты, внутренние API, запрос на запись, HMR и image SSRF — 403.
- Повторные проверки через внешний HTTPS-адрес с обычной TLS validation из отдельного Node-клиента: главная, каталог, товар, магазин — 200; seller, admin, requests, seller API, HMR и POST CustomerRequest — 403.
- В браузере проверены публичная главная, поиск «пальто» с одним результатом, переход на товар, загрузка фото (naturalWidth 640) и переход в бутик.
- Browser screenshot сохранён в локальных артефактах; публичная главная оставлена открытой.
- Полный database integration suite повторно не запускался: рабочая schema и бизнес-логика не менялись, публичное демо не использует database.

## Typecheck

`pnpm typecheck`: PASS для API и web.

## Lint

`pnpm lint`: PASS, ESLint без предупреждений и Prettier. Отдельные новые scripts и Compose также проверены форматтером.

## Production Build

Next.js и NestJS production build: PASS. Docker target `public-preview`: PASS. Успешная сборка не означает готовности к коммерческой эксплуатации.

## Известные проблемы

- Ссылка временная; Quick Tunnel не гарантирует uptime и меняет hostname при новом запуске.
- Регистрация, кабинеты, реальные заявки и платежи намеренно недоступны. Ссылки на эти разделы показывают сообщение о границах демонстрации.
- Демо использует development renderer за ограничивающим gateway; HMR и debugging endpoints намеренно заблокированы. Возможны сообщения HMR в браузерной консоли и задержки первой компиляции страницы.
- Cloudflare сообщил предупреждение о размере QUIC receive buffer; при проверке оно не помешало соединению. Настройки kernel и privileges для его подавления не расширялись.
- Один диагностический PowerShell-клиент не смог установить TLS-соединение. Проверка сертификатов не отключалась; браузер и отдельный Node-клиент успешно проверили тот же HTTPS-адрес. Причина различия клиентов не подтверждена.
- Прямой внешний доступ через домашний роутер не настроен: проверенный WAN IPv4 находится в частном диапазоне, внешний IPv6 не показан. Точная топология upstream NAT не установлена.

Первоначальная ошибка EROFS при генерации `next-env.d.ts` исправлена: frontend-копия и все генерируемые файлы располагаются в disposable tmpfs. После исправления сборка и quality checks повторены.

## Технический долг

Добавлен отдельный шлюз только для временного fixture preview. Его нельзя применять как production reverse proxy без самостоятельного review. Allowlist и tests нужно обновлять при изменении состава демонстрируемых публичных routes. Новый production dependency не добавлен.

## Следующая рекомендуемая фаза

Настройка постоянного домена и защищённого внешнего доступа после выбора публичного IP либо подходящего постоянного туннеля, а для реальных данных — прохождение существующего production gate и проверка KZ requirements. Не выполнена автоматически.

## Запуск и остановка демонстрации

Запуск из корня репозитория:

```powershell
docker compose -f compose.preview.yaml up -d --build
docker compose -f compose.preview.yaml logs tunnel
```

Новый адрес берётся из вывода туннеля, а не из старой ссылки в этом отчёте.

Остановка только демонстрации, без удаления volumes рабочего проекта:

```powershell
docker compose -f compose.preview.yaml stop
```

## Использованные источники

- [Cloudflare Quick Tunnels: назначение и ограничения](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
- [Официальный release cloudflared 2026.9.3](https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3).
- [IANA: диапазоны частных IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/).
- Встроенная документация установленного Next.js: App Router self-hosting и local development.

Навык управления интерфейсом использовался для проверки роутера и реального browser UX опубликованной демонстрации; бизнес-код им не изменялся.
