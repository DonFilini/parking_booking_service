# Сервис бронирования офисной парковки

Сервис для бронирования парковочных мест в офисе с ролями `employee`, `manager`, `admin`.

Проект состоит из:

- `backend/` — REST API на FastAPI, бизнес-правила бронирований, JWT-аутентификация, SQLAlchemy, SQLite.
- `frontend/` — SPA на React/Vite, production-сборка отдается через nginx.
- `docker-compose.yml` — развертывание, приближенное к production-сценарию, двумя контейнерами: `frontend` и `backend`.

## Архитектура

```text
Браузер пользователя
  |
  | HTTP/HTTPS
  | GET /, /assets/*
  | GET/POST/PATCH/DELETE /api/*
  v
контейнер frontend: nginx
  - порт контейнера: 80/tcp
  - публикация на хосте: ${FRONTEND_BIND_IP:-0.0.0.0}:${FRONTEND_PORT:-8080}
  - отдает статические файлы React
  - проксирует /api/* в backend
  |
  | HTTP внутри Docker-сети
  | http://backend:8000/*
  v
контейнер backend: FastAPI/Uvicorn
  - порт контейнера: 8000/tcp
  - по умолчанию не публикуется на хост
  - аутентификация: JWT Bearer token
  |
  | файловый доступ SQLite через SQLAlchemy
  v
Docker Compose volume: parking_data
  - путь в backend-контейнере: /data/parking.db
```

### Карта сетевого взаимодействия и протоколов

| Участок | Протокол | Источник | Назначение | Для чего используется |
|---|---:|---|---|---|
| Браузер пользователя -> nginx | HTTP или HTTPS через внешний обратный прокси | Клиент | `http://<host>:${FRONTEND_PORT}` | Интерфейс, статические файлы, API-запросы по пути `/api` |
| nginx -> backend | HTTP | сервис `frontend` | `backend:8000` в Docker-сети | Обратное проксирование API |
| JavaScript frontend -> API | HTTP-запрос по пути того же origin | Браузер | `/api/*` | `fetch()`-запросы с заголовком `Authorization: Bearer <jwt>` |
| backend -> БД | локальный файловый ввод-вывод | сервис `backend` | `/data/parking.db` | Хранение SQLite-данных |

### Порты во время выполнения

| Компонент | Порт контейнера | Публикация на хосте | Примечание |
|---|---:|---:|---|
| nginx frontend | `80/tcp` | `${FRONTEND_BIND_IP:-0.0.0.0}:${FRONTEND_PORT:-8080}` | Основная публичная точка входа |
| FastAPI backend | `8000/tcp` | Не публикуется | Доступен только как `http://backend:8000` внутри Docker-сети |
| SQLite | нет | нет | Файл в Docker Compose volume |

Если сервис размещается за обратным прокси уровня хоста, например Caddy, Traefik, nginx, HAProxy или балансировщиком нагрузки, публикуйте frontend только на localhost:

```env
FRONTEND_BIND_IP=127.0.0.1
FRONTEND_PORT=8080
CORS_ORIGINS=https://parking.example.com
```

После этого внешний адрес `https://parking.example.com` должен проксироваться на `http://127.0.0.1:8080`.

## Основные возможности

- Вход по логину и паролю с выдачей JWT.
- Проверка текущей сессии через `/auth/me`.
- Просмотр доступности парковочных мест за выбранный период.
- Создание и удаление бронирований пользователем.
- Администрирование пользователей, парковочных мест, бронирований и глобального переключателя бронирований.
- Отчетность администратора: Excel-совместимый `.xls`-отчет за сегодня или выбранную дату.
- Ролевые правила бронирования.

## Роли и правила

### Сотрудник

- Может бронировать только следующий рабочий день.
- Бронирование открывается после 18:00 в часовом поясе `APP_TIME_ZONE`.
- В пятницу целевой день бронирования — понедельник.
- Может иметь только одно активное или будущее бронирование.

### Менеджер

- Может бронировать текущую или следующую неделю.
- Максимальная длительность бронирования — 5 рабочих дней.
- Может иметь одно бронирование на текущую неделю и одно на следующую.

### Администратор

- Может создавать бронирования на любой свободный период, включая выходные.
- Может управлять пользователями, парковочными местами, бронированиями и глобальной доступностью бронирований.
- Может формировать отчеты по бронированиям.

## Production-развертывание через Docker Compose

### 1. Установить зависимости на сервере

На Linux-хосте должны быть доступны Docker и Docker Compose plugin:

```bash
docker --version
docker compose version
```

Если Docker не установлен, установите Docker Engine и Docker Compose plugin из официальных пакетов вашего дистрибутива.

### 2. Склонировать репозиторий

```bash
git clone https://github.com/DonFilini/parking_booking_service.git
cd parking_booking_service
```

### 3. Создать файл окружения

```bash
cp .env.example .env
```

Отредактируйте `.env`.

Минимально нужно изменить:

```env
SECRET_KEY=<длинный-случайный-секрет>
DEFAULT_SEED_PASSWORD=<временный-стартовый-пароль>
```

Сгенерировать секрет можно так:

```bash
openssl rand -hex 32
```

Пример `.env` для развертывания на одном хосте по HTTP:

```env
FRONTEND_BIND_IP=0.0.0.0
FRONTEND_PORT=8080
CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
APP_TIME_ZONE=Europe/Moscow
SECRET_KEY=replace-with-a-long-random-secret
DEFAULT_SEED_PASSWORD=replace-with-an-initial-strong-password
DATABASE_URL=sqlite:////data/parking.db
```

Пример `.env`, если HTTPS завершается внешним обратным прокси:

```env
FRONTEND_BIND_IP=127.0.0.1
FRONTEND_PORT=8080
CORS_ORIGINS=https://parking.example.com
APP_TIME_ZONE=Europe/Moscow
SECRET_KEY=replace-with-a-long-random-secret
DEFAULT_SEED_PASSWORD=replace-with-an-initial-strong-password
DATABASE_URL=sqlite:////data/parking.db
```

### 4. Собрать и запустить

```bash
docker compose up --build -d
```

Открыть локально:

```text
http://localhost:8080
```

Если сервис запущен на удаленном сервере:

```text
http://<server-ip>:8080
```

### 5. Первый вход

При первом запуске с пустой базой backend создает стартовых пользователей:

- `admin`
- `manager`
- `employee`

Все три пользователя получают пароль из переменной `DEFAULT_SEED_PASSWORD`.

Production-чеклист после первого входа:

1. Войти под `admin`.
2. Сменить пароли стартовых пользователей.
3. Отключить или удалить учетные записи, которые не нужны в production.
4. Создать реальных пользователей и парковочные места.
5. Не публиковать `.env` и не коммитить его в репозиторий.

## Переменные окружения

### Docker-level `.env`

| Переменная | Обязательная | Значение по умолчанию | Где используется | Описание |
|---|---:|---|---|---|
| `FRONTEND_BIND_IP` | нет | `0.0.0.0` | compose | IP-адрес хоста, на котором публикуется nginx. За обратным прокси используйте `127.0.0.1`. |
| `FRONTEND_PORT` | нет | `8080` | compose | Порт хоста для публичного frontend/nginx контейнера. |
| `CORS_ORIGINS` | нет | localhost-адреса | backend | Список origin-адресов браузера через запятую для прямого доступа к API. |
| `APP_TIME_ZONE` | нет | `Europe/Moscow` в compose | backend | IANA timezone для правил бронирования и timestamp-полей. |
| `SECRET_KEY` | да | нет в compose | backend | Ключ подписи JWT. Должен быть стабильным и секретным. |
| `DEFAULT_SEED_PASSWORD` | да | нет в compose | backend | Стартовый пароль seeded-пользователей, если база пустая. |
| `DATABASE_URL` | нет | `sqlite:////data/parking.db` | backend | SQLAlchemy database URL. |
| `ACCESS_TOKEN_EXPIRE_HOURS` | нет | `12` | backend | Срок жизни JWT в часах. |

### Переменные backend для локальной разработки

Смотрите [backend/.env.example](backend/.env.example).

### Переменные frontend для локальной разработки

Смотрите [frontend/.env.example](frontend/.env.example).

В Docker frontend собирается со значением:

```text
VITE_API_URL=/api
```

Это означает, что браузер обращается к API по пути того же origin:

```text
http://<host>:8080/api/*
```

nginx убирает префикс `/api/` и проксирует запросы в:

```text
http://backend:8000/*
```

## Docker-сервисы

### `backend`

Контекст сборки:

```text
./backend
```

Среда выполнения:

```text
python:3.12-slim
uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips *
```

Проверка здоровья:

```text
GET http://127.0.0.1:8000/health
```

Постоянные данные:

```text
volume parking_data -> /data/parking.db
```

### `frontend`

Контекст сборки:

```text
./frontend
```

Этап сборки:

```text
node:22-alpine
npm ci
npm run build
```

Среда выполнения:

```text
nginx:1.27-alpine
```

Проверка здоровья:

```text
GET http://127.0.0.1/health
```

Задачи nginx:

- отдавать статические файлы React из `/usr/share/nginx/html`;
- отдавать SPA fallback через `try_files ... /index.html`;
- проксировать `/api/*` в `http://backend:8000/*`;
- выставлять базовые заголовки безопасности;
- включать gzip для типовых статических файлов;
- кэшировать hashed assets на 30 дней.

## Обзор API

Все защищенные маршруты требуют заголовок:

```http
Authorization: Bearer <access_token>
```

Аутентификация:

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/auth/login` | Вход через OAuth2 password form, возвращает JWT и пользователя |
| `GET` | `/auth/me` | Текущий активный пользователь |

Общие маршруты:

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/health` | Проверка здоровья backend |
| `GET` | `/spots` | Список активных мест по умолчанию |
| `GET` | `/availability?start=YYYY-MM-DD&end=YYYY-MM-DD` | Доступные и занятые места за период |
| `GET` | `/bookings/my` | Бронирования текущего пользователя |
| `POST` | `/bookings` | Создать бронирование |
| `DELETE` | `/bookings/{id}` | Удалить свое бронирование или любое бронирование администратором |

Только для администратора:

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/users` | Список пользователей |
| `POST` | `/users` | Создать пользователя |
| `PATCH` | `/users/{id}` | Обновить пользователя |
| `DELETE` | `/users/{id}` | Удалить пользователя, если у него нет бронирований |
| `POST` | `/spots` | Создать парковочное место |
| `PATCH` | `/spots/{id}` | Обновить парковочное место |
| `DELETE` | `/spots/{id}` | Удалить место, если по нему нет бронирований |
| `GET` | `/bookings` | Список всех бронирований |
| `PATCH` | `/bookings/{id}` | Обновить бронирование |
| `GET` | `/booking-settings` | Получить состояние глобального переключателя бронирований |
| `PATCH` | `/booking-settings` | Включить или отключить бронирования глобально |
| `GET` | `/admin/dashboard` | Счетчики пользователей, мест и бронирований |

## Локальная разработка без Docker

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

URL backend для разработки:

```text
http://127.0.0.1:8000
```

Интерактивная документация API:

```text
http://127.0.0.1:8000/docs
```

### Frontend

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev -- --host 127.0.0.1 --port 5173
```

URL frontend для разработки:

```text
http://127.0.0.1:5173
```

При локальной разработке `VITE_API_URL=http://localhost:8000`, поэтому браузер обращается к FastAPI напрямую по HTTP.

## Тестирование и проверка

Модульные тесты backend:

```bash
cd backend
python -B -m unittest discover
```

Сборка frontend для промышленного окружения:

```bash
cd frontend
npm ci
npm run build
```

Проверка конфигурации Docker Compose:

```bash
docker compose config
```

Полная быстрая проверка Docker-развертывания:

```bash
docker compose up --build -d
docker compose ps
curl -i http://127.0.0.1:${FRONTEND_PORT:-8080}/health
curl -i http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health
```

Ожидаемый результат:

- `/health` возвращает `200 ok` от nginx;
- `/api/health` возвращает `{"status":"ok"}` от FastAPI через nginx proxy.

## Эксплуатация

### Логи

```bash
docker compose logs -f
docker compose logs -f backend
docker compose logs -f frontend
```

### Перезапуск

```bash
docker compose restart
```

### Остановка без удаления базы

```bash
docker compose down
```

### Остановка с удалением volume базы

```bash
docker compose down -v
```

Эта команда удаляет SQLite volume. Используйте ее только если намеренно хотите сбросить все данные.

### Обновление развертывания

```bash
git pull
docker compose up --build -d
docker compose ps
```

## Резервное копирование и восстановление

База приложения — SQLite-файл в Compose volume `parking_data`.
При стандартном имени директории репозитория Docker обычно создает физический volume `parking_booking_service_parking_data`.
Если директория или Compose project name отличаются, точное имя можно проверить командой `docker volume ls`.

### Резервная копия

```bash
mkdir -p backups
docker compose exec -T backend python - <<'PY' > backups/parking-$(date +%F-%H%M%S).db
import sys
from pathlib import Path
sys.stdout.buffer.write(Path("/data/parking.db").read_bytes())
PY
```

Альтернативная резервная копия со стороны хоста:

```bash
docker run --rm \
  -v parking_booking_service_parking_data:/data \
  -v "$PWD/backups:/backups" \
  alpine sh -c 'cp /data/parking.db /backups/parking-$(date +%F-%H%M%S).db'
```

### Восстановление

Сначала остановите сервисы:

```bash
docker compose down
```

Восстановите файл БД:

```bash
docker run --rm \
  -v parking_booking_service_parking_data:/data \
  -v "$PWD/backups:/backups" \
  alpine sh -c 'cp /backups/<backup-file>.db /data/parking.db'
```

Запустите сервисы:

```bash
docker compose up -d
```

## Замечания по безопасности

Для production обязательно:

- использовать сильный `SECRET_KEY` и сохранять его между перезапусками;
- задать сильный `DEFAULT_SEED_PASSWORD`;
- сразу после первого входа сменить пароли seeded-пользователей;
- поставить сервис за HTTPS для реальных пользователей;
- если TLS завершается вне Docker, публиковать frontend только на `127.0.0.1` и наружу открывать только обратный прокси;
- ограничить firewall-доступ к `${FRONTEND_PORT}` или только к внешнему TLS proxy;
- не публиковать backend-порт `8000` в Интернет;
- не коммитить `.env`, реальные SQLite-дампы, backup-файлы и секреты;
- регулярно делать backup Docker volume.

Текущая модель аутентификации:

- JWT bearer token хранится в браузерном `localStorage`;
- это допустимо для небольшого внутреннего сервиса при контролируемом XSS-риске;
- для более строгого корпоративного развертывания стоит перенести хранение сессии в HttpOnly Secure cookies и добавить CSRF-защиту.

Текущая модель БД:

- SQLite прост и достаточен для небольших внутренних развертываний;
- для высокой конкуренции, HA или масштабирования backend в несколько инстансов нужно мигрировать на PostgreSQL и заменить механизм блокировок, специфичный для SQLite.

## Диагностика проблем

### Ошибка `SECRET_KEY` или `DEFAULT_SEED_PASSWORD` при запуске

Compose намеренно требует эти переменные.

Исправление:

```bash
cp .env.example .env
nano .env
docker compose up --build -d
```

### Интерфейс открывается, API не работает

Проверьте nginx-to-backend proxy:

```bash
curl -i http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health
docker compose logs backend
docker compose logs frontend
```

### Вход перестал работать после перезапуска

Если изменился `SECRET_KEY`, старые JWT становятся недействительными. Нужно выйти и войти заново. В production `SECRET_KEY` должен быть стабильным.

### Seeded-пользователи не создаются заново

Seeded-пользователи создаются только когда таблица `users` пустая. Существующий DB volume сохраняет уже созданных пользователей.

Чтобы намеренно сбросить все данные:

```bash
docker compose down -v
docker compose up --build -d
```

### Нужно изменить публичный URL

Обновите `.env`:

```env
CORS_ORIGINS=https://new.example.com
```

Затем примените конфигурацию:

```bash
docker compose up -d
```

## Гигиена репозитория

Локально игнорируются:

- `.env`;
- виртуальные окружения;
- `node_modules`;
- результат frontend-сборки;
- Python cache;
- метаданные IDE.

Файлы развертывания, которые должны быть в репозитории:

- `.env.example`;
- `.dockerignore`;
- `docker-compose.yml`;
- `backend/Dockerfile`;
- `frontend/Dockerfile`;
- `frontend/nginx.conf`;
- `backend/.env.example`;
- `frontend/.env.example`.
