# Сервис бронирования офисной парковки

Сервис для бронирования парковочных мест в офисе с ролями `employee`, `manager`, `admin`.

Эта ветка предназначена для развертывания без собственной БД внутри `docker-compose.yml`. Backend подключается напрямую к общей внешней PostgreSQL-БД через SQLAlchemy по строке `DATABASE_URL`, в которой указаны host, port, database, user и password пользователя БД. Логин и пароль пользователей проверяются только через LDAPS. Роли пользователей не берутся из LDAP-групп: роли и активность учетных записей хранятся в PostgreSQL и назначаются администратором вручную.

Проект состоит из:

- `backend/` - REST API на FastAPI, бизнес-правила бронирований, JWT-сессии, SQLAlchemy, PostgreSQL, LDAPS.
- `frontend/` - SPA на React/Vite, production-сборка отдается через nginx.
- `docker-compose.yml` - развертывание двумя контейнерами: `frontend` и `backend`.
- `.env.example` - шаблон настроек для подключения к общей PostgreSQL-БД и LDAPS.
- `docs/SWARM_TWO_IMAGES_GITFLIC.md` - пошаговая инструкция для Docker Swarm деплоя `shared-postgres` двумя образами: `backend` и `frontend`.

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
  - аутентификация: LDAPS -> JWT Bearer token
  |
  | прямое подключение к PostgreSQL
  | DATABASE_URL: host, port, database, user, password
  v
общая PostgreSQL-БД

контейнер backend
  |
  | LDAPS
  | LDAP_URL, обычно 636/tcp
  v
LDAP/Active Directory
```

### Карта сетевого взаимодействия и протоколов

| Участок | Протокол | Источник | Назначение | Для чего используется |
|---|---:|---|---|---|
| Браузер пользователя -> nginx | HTTP или HTTPS через внешний обратный прокси | Клиент | `http://<host>:${FRONTEND_PORT}` | Интерфейс, статические файлы, API-запросы по пути `/api` |
| nginx -> backend | HTTP | сервис `frontend` | `backend:8000` в Docker-сети | Обратное проксирование API |
| JavaScript frontend -> API | HTTP-запрос по пути того же origin | Браузер | `/api/*` | `fetch()`-запросы с заголовком `Authorization: Bearer <jwt>` |
| backend -> PostgreSQL | прямое подключение к PostgreSQL по `DATABASE_URL` | сервис `backend` | адрес из `DATABASE_URL` | Постоянное хранение пользователей, ролей, мест, броней и настроек |
| backend -> LDAP/AD | LDAPS | сервис `backend` | адрес из `LDAP_URL` | Проверка логина и пароля пользователя |

### Порты во время выполнения

| Компонент | Порт контейнера | Публикация на хосте | Примечание |
|---|---:|---:|---|
| nginx frontend | `80/tcp` | `${FRONTEND_BIND_IP:-0.0.0.0}:${FRONTEND_PORT:-8080}` | Основная публичная точка входа |
| FastAPI backend | `8000/tcp` | Не публикуется | Доступен только как `http://backend:8000` внутри Docker-сети |
| Общая PostgreSQL-БД | обычно `5432/tcp` | Внешний адрес из `DATABASE_URL` | Compose этой ветки БД не создает и не обслуживает |
| LDAP/AD | обычно `636/tcp` для LDAPS | Внешний адрес из `LDAP_URL` | Нужен доступ из backend-контейнера |

Если сервис размещается за обратным прокси уровня хоста, например Caddy, Traefik, nginx, HAProxy или балансировщиком нагрузки, публикуйте frontend только на localhost:

```env
FRONTEND_BIND_IP=127.0.0.1
FRONTEND_PORT=8080
CORS_ORIGINS=https://parking.example.com
```

После этого внешний адрес `https://parking.example.com` должен проксироваться на `http://127.0.0.1:8080`.

## Отличие этой ветки от варианта с локальной БД

В этой ветке:

- нет сервиса `postgres` в `docker-compose.yml`;
- нет Docker volume `postgres_data`;
- нет переменных `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`;
- backend не стартует без `DATABASE_URL`;
- резервное копирование и права доступа к БД находятся вне compose-файла приложения;
- `docker compose down -v` не удаляет общую PostgreSQL-БД, потому что compose ей не управляет.

## Основные возможности

- Вход через LDAPS с выдачей JWT.
- Проверка текущей сессии через `/auth/me`.
- Просмотр доступности парковочных мест за выбранный период.
- Создание и удаление бронирований пользователем.
- Администрирование пользователей, ролей, активности учетных записей, парковочных мест, бронирований и глобального переключателя бронирований.
- Отчетность администратора: Excel-совместимый `.xls`-отчет за сегодня или выбранную дату.
- Ролевые правила бронирования.
- Работа с общей PostgreSQL-БД, которая может обслуживаться отдельно от приложения.

## Роли и правила

### Сотрудник

- Может бронировать текущий рабочий день.
- После 18:00 в часовом поясе `APP_TIME_ZONE` дополнительно может бронировать следующий рабочий день.
- В пятницу после 18:00 следующим доступным днем будет понедельник.
- Может иметь только одно активное или будущее бронирование.

### Менеджер

- Может бронировать текущую или следующую неделю.
- Максимальная длительность бронирования - 5 рабочих дней.
- Может создавать несколько бронирований в рамках одной недели, если их даты не пересекаются.
- Может выбирать только места из пула свободных мест за выбранный период.

### Администратор

- Может создавать бронирования на любой свободный период, включая выходные.
- Может создать для одного пользователя несколько броней в один день на разные места.
- Не может занять одно и то же место несколько раз на пересекающийся период.
- Может управлять пользователями, ролями, активностью учетных записей, парковочными местами, бронированиями и глобальной доступностью бронирований.
- Может формировать отчеты по бронированиям.

## Авторизация через LDAPS

LDAPS - единственный способ проверки логина и пароля. Локального пароля в PostgreSQL нет.

Порядок входа:

1. Frontend отправляет `POST /api/auth/login`.
2. Nginx проксирует запрос в backend `/auth/login`.
3. Backend подключается к LDAP/AD через `LDAP_URL`.
4. Backend выполняет service bind через `LDAP_BIND_DN` и `LDAP_BIND_PASSWORD`.
5. Backend ищет пользователя в `LDAP_USER_SEARCH_BASE` по `LDAP_USER_FILTER`.
6. Backend проверяет пароль отдельным bind-ом найденного DN.
7. Backend создает или обновляет локальную запись `users` в PostgreSQL.
8. Backend выдает JWT.

Роли не берутся из LDAP-групп. Роли задаются вручную в админке и хранятся локально в PostgreSQL.

Если LDAP-пользователь входит впервые и его еще нет в таблице `users`, backend создает его с ролью `employee` и `active=true`. После этого администратор может вручную поменять роль или отключить пользователя.

Чтобы первый администратор смог войти в чистую БД, в `.env` нужно указать `INITIAL_ADMIN_USERNAMES`. Это один или несколько LDAP-логинов через запятую. При старте backend создаст для них локальные записи с ролью `admin`, но пароль все равно будет проверяться только через LDAPS.

## Требования к общей PostgreSQL-БД

До запуска приложения нужно подготовить общую БД.

Минимально требуется:

- PostgreSQL доступен с Docker-хоста, где запускается приложение;
- открыт сетевой доступ на порт PostgreSQL, обычно `5432/tcp`;
- создана база данных, например `parking`;
- создан пользователь БД, например `parking_app`;
- пользователь имеет права на подключение к БД;
- пользователь имеет права на создание таблиц и индексов в целевой схеме;
- пользователь имеет права на чтение, запись, обновление и удаление данных в созданных таблицах.

Пример подготовки БД на стороне PostgreSQL-администратора:

```sql
CREATE DATABASE parking;
CREATE USER parking_app WITH PASSWORD 'replace-with-strong-password';
GRANT CONNECT ON DATABASE parking TO parking_app;
\c parking
GRANT USAGE, CREATE ON SCHEMA public TO parking_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO parking_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO parking_app;
```

Если таблицы уже созданы другим владельцем, дополнительно могут понадобиться явные `GRANT` на существующие таблицы и sequence.

Backend создает таблицы через SQLAlchemy при старте. Полноценной системы миграций пока нет, поэтому изменения структуры БД в будущем нужно планировать отдельно.

## Production-развертывание через Docker Compose

### 1. Установить зависимости на сервере

На Linux-хосте должны быть доступны Docker и Docker Compose plugin:

```bash
docker --version
docker compose version
```

Если Docker не установлен, установите Docker Engine и Docker Compose plugin из официальных пакетов вашего дистрибутива.

### 2. Получить сетевые параметры

Перед запуском нужны данные от администратора PostgreSQL и LDAP/AD:

```text
PostgreSQL host: postgres.example.local
PostgreSQL port: 5432
PostgreSQL database: parking
PostgreSQL user: parking_app
PostgreSQL password: ********

LDAP URL: ldaps://dc01.example.local:636
LDAP bind DN: CN=parking-bind,OU=Service Accounts,DC=example,DC=local
LDAP bind password: ********
LDAP user search base: OU=Users,DC=example,DC=local
LDAP user filter: (sAMAccountName={username})
```

### 3. Проверить сетевую доступность с сервера

Проверка PostgreSQL:

```bash
nc -vz postgres.example.local 5432
```

Проверка LDAPS:

```bash
nc -vz dc01.example.local 636
openssl s_client -connect dc01.example.local:636 -showcerts
```

Если LDAPS использует корпоративный CA, сертификат CA нужно добавить в backend-контейнер или передать файлом и указать путь в `LDAP_CA_CERT_FILE`.

### 4. Склонировать репозиторий и выбрать ветку

```bash
git clone https://github.com/DonFilini/parking_booking_service.git
cd parking_booking_service
git checkout shared-postgres
```

### 5. Создать файл окружения

```bash
cp .env.example .env
nano .env
```

Минимально нужно изменить:

```env
SECRET_KEY=<длинный-случайный-секрет>
DATABASE_URL=postgresql+psycopg://parking_app:<пароль>@postgres.example.local:5432/parking
INITIAL_ADMIN_USERNAMES=<ldap-логин-первого-админа>
LDAP_URL=ldaps://dc01.example.local:636
LDAP_BIND_DN=CN=parking-bind,OU=Service Accounts,DC=example,DC=local
LDAP_BIND_PASSWORD=<пароль-сервисной-учетки>
LDAP_USER_SEARCH_BASE=OU=Users,DC=example,DC=local
```

Сгенерировать секрет можно так:

```bash
openssl rand -hex 32
```

Пример `.env` для развертывания на одном хосте по HTTP:

```env
FRONTEND_BIND_IP=0.0.0.0
FRONTEND_PORT=8080
CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://<server-ip>:8080
APP_TIME_ZONE=Europe/Moscow
SECRET_KEY=replace-with-a-long-random-secret
DATABASE_URL=postgresql+psycopg://parking_app:replace-with-password@postgres.example.local:5432/parking
INITIAL_ADMIN_USERNAMES=ivanov
LDAP_URL=ldaps://dc01.example.local:636
LDAP_BIND_DN=CN=parking-bind,OU=Service Accounts,DC=example,DC=local
LDAP_BIND_PASSWORD=replace-with-ldap-bind-password
LDAP_USER_SEARCH_BASE=OU=Users,DC=example,DC=local
LDAP_USER_FILTER=(sAMAccountName={username})
LDAP_USER_FULL_NAME_ATTRIBUTE=displayName
LDAP_TLS_VALIDATE=true
LDAP_CA_CERT_FILE=
LDAP_CONNECT_TIMEOUT=5
```

Пример `.env`, если HTTPS завершается внешним обратным прокси:

```env
FRONTEND_BIND_IP=127.0.0.1
FRONTEND_PORT=8080
CORS_ORIGINS=https://parking.example.com
APP_TIME_ZONE=Europe/Moscow
SECRET_KEY=replace-with-a-long-random-secret
DATABASE_URL=postgresql+psycopg://parking_app:replace-with-password@postgres.example.local:5432/parking
INITIAL_ADMIN_USERNAMES=ivanov
LDAP_URL=ldaps://dc01.example.local:636
LDAP_BIND_DN=CN=parking-bind,OU=Service Accounts,DC=example,DC=local
LDAP_BIND_PASSWORD=replace-with-ldap-bind-password
LDAP_USER_SEARCH_BASE=OU=Users,DC=example,DC=local
LDAP_USER_FILTER=(sAMAccountName={username})
LDAP_USER_FULL_NAME_ATTRIBUTE=displayName
LDAP_TLS_VALIDATE=true
LDAP_CA_CERT_FILE=
LDAP_CONNECT_TIMEOUT=5
```

### 6. Собрать и запустить

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

### 7. Проверить запуск

```bash
docker compose ps
curl -i http://127.0.0.1:${FRONTEND_PORT:-8080}/health
curl -i http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health
```

Ожидаемый результат:

- `frontend` в статусе `running` или `healthy`;
- `backend` в статусе `running` или `healthy`;
- `/health` возвращает `200 ok` от nginx;
- `/api/health` возвращает `{"status":"ok"}` от FastAPI через nginx proxy.

### 8. Первый вход

Первый администратор задается через:

```env
INITIAL_ADMIN_USERNAMES=ivanov
```

Это должен быть LDAP-логин. Пароль в приложении не задается, он проверяется через LDAPS.

После первого входа:

1. Открыть админку.
2. Проверить, что первый пользователь имеет роль `admin`.
3. Создать или дождаться первого входа остальных пользователей.
4. Назначить пользователям роли вручную.
5. Отключить лишние учетные записи, если нужно.
6. Проверить парковочные места и глобальную доступность бронирований.

## Переменные окружения

### Docker-level `.env`

| Переменная | Обязательная | Значение по умолчанию | Где используется | Описание |
|---|---:|---|---|---|
| `FRONTEND_BIND_IP` | нет | `0.0.0.0` | compose | IP-адрес хоста, на котором публикуется nginx. За обратным прокси используйте `127.0.0.1`. |
| `FRONTEND_PORT` | нет | `8080` | compose | Порт хоста для публичного frontend/nginx контейнера. |
| `CORS_ORIGINS` | нет | localhost-адреса | backend | Список origin-адресов браузера через запятую для прямого доступа к API. |
| `APP_TIME_ZONE` | нет | `Europe/Moscow` | backend и сборка frontend | IANA timezone для правил бронирования, календаря, отчетов и timestamp-полей. |
| `SECRET_KEY` | да | нет | backend | Ключ подписи JWT. Должен быть стабильным и секретным. |
| `DATABASE_URL` | да | нет | backend | SQLAlchemy URL общей PostgreSQL-БД. |
| `ACCESS_TOKEN_EXPIRE_HOURS` | нет | `12` | backend | Срок жизни JWT в часах. |
| `INITIAL_ADMIN_USERNAMES` | да | нет | backend | LDAP-логины первичных администраторов через запятую. |
| `LDAP_URL` | да | нет | backend | Адрес LDAP/AD, обычно `ldaps://host:636`. |
| `LDAP_BIND_DN` | да | нет | backend | DN сервисной учетной записи для поиска пользователей. |
| `LDAP_BIND_PASSWORD` | да | нет | backend | Пароль сервисной учетной записи. |
| `LDAP_USER_SEARCH_BASE` | да | нет | backend | База поиска пользователей. |
| `LDAP_USER_FILTER` | нет | `(sAMAccountName={username})` | backend | Фильтр поиска пользователя. |
| `LDAP_USER_FULL_NAME_ATTRIBUTE` | нет | `displayName` | backend | LDAP-атрибут полного имени пользователя. |
| `LDAP_TLS_VALIDATE` | нет | `true` | backend | Проверять сертификат LDAPS-сервера. |
| `LDAP_CA_CERT_FILE` | нет | пусто | backend | Путь к CA-сертификату внутри backend-контейнера. |
| `LDAP_CONNECT_TIMEOUT` | нет | `5` | backend | Таймаут LDAP-соединения в секундах. |

### Переменные backend для локальной разработки

Смотрите [backend/.env.example](backend/.env.example). Для текущей ветки при локальном запуске backend также нужно задать `DATABASE_URL` на доступную PostgreSQL-БД.

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

Особенность healthcheck:

- endpoint `/health` выполняет `SELECT 1` через SQLAlchemy;
- если общая PostgreSQL-БД недоступна, backend healthcheck будет падать;
- из-за этого `frontend` может не стартовать до healthy-состояния backend.

Постоянные данные:

```text
общая PostgreSQL-БД из DATABASE_URL
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
| `POST` | `/auth/login` | Вход через OAuth2 password form, пароль проверяется через LDAPS, возвращает JWT и пользователя |
| `GET` | `/auth/me` | Текущий активный пользователь |

Общие маршруты:

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/health` | Проверка здоровья backend и подключения к БД |
| `GET` | `/spots` | Список активных мест по умолчанию |
| `GET` | `/availability?start=YYYY-MM-DD&end=YYYY-MM-DD` | Доступные и занятые места за период |
| `GET` | `/bookings/my` | Бронирования текущего пользователя |
| `POST` | `/bookings` | Создать бронирование |
| `DELETE` | `/bookings/{id}` | Удалить свое бронирование или любое бронирование администратором |

Только для администратора:

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/users` | Список пользователей |
| `POST` | `/users` | Создать локальный профиль пользователя без локального пароля |
| `PATCH` | `/users/{id}` | Обновить пользователя, роль или активность |
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
```

Перед запуском нужно задать переменные окружения. Минимальный пример:

```bash
export DATABASE_URL='postgresql+psycopg://parking_app:password@postgres.example.local:5432/parking'
export SECRET_KEY='dev-secret-key'
export INITIAL_ADMIN_USERNAMES='ivanov'
export LDAP_URL='ldaps://dc01.example.local:636'
export LDAP_BIND_DN='CN=parking-bind,OU=Service Accounts,DC=example,DC=local'
export LDAP_BIND_PASSWORD='service-password'
export LDAP_USER_SEARCH_BASE='OU=Users,DC=example,DC=local'
```

Запуск:

```bash
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

Тесты backend используют временную SQLite-БД для проверки бизнес-правил и не требуют общей PostgreSQL-БД.

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

## Проверка общей PostgreSQL-БД

Проверка доступности порта с Docker-хоста:

```bash
nc -vz postgres.example.local 5432
```

Проверка из backend-контейнера:

```bash
docker compose exec backend python -c "import os; from sqlalchemy import create_engine, text; e=create_engine(os.environ['DATABASE_URL']); c=e.connect(); print(c.execute(text('select 1')).scalar()); c.close()"
```

Ожидаемый результат:

```text
1
```

Если команда не проходит, проверьте:

- DNS-имя или IP PostgreSQL-хоста;
- порт PostgreSQL;
- firewall между Docker-хостом и PostgreSQL;
- логин, пароль и имя БД в `DATABASE_URL`;
- права пользователя БД;
- настройки `pg_hba.conf` на стороне PostgreSQL.

## Проверка LDAPS

Проверка порта:

```bash
nc -vz dc01.example.local 636
```

Проверка сертификата:

```bash
openssl s_client -connect dc01.example.local:636 -showcerts
```

Если сертификат выдан корпоративным CA, backend-контейнер должен доверять этому CA. Для диагностики можно временно поставить:

```env
LDAP_TLS_VALIDATE=false
```

Для production рекомендуется:

```env
LDAP_TLS_VALIDATE=true
LDAP_CA_CERT_FILE=/certs/company-ca.pem
```

Если CA-файл передается в контейнер, нужно дополнительно смонтировать его в `docker-compose.yml` или добавить в образ backend.

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

### Остановка

```bash
docker compose down
```

### Обновление развертывания

```bash
git pull
docker compose up --build -d
docker compose ps
```

### Пересборка без кэша

```bash
docker compose build --no-cache --progress=plain
docker compose up -d
```

## Резервное копирование и восстановление

В этой ветке БД является общей и находится вне `docker-compose.yml`. Поэтому штатный backup должен быть организован на стороне владельца PostgreSQL или отдельным регламентом.

Пример логического backup, если у оператора есть доступ к PostgreSQL:

```bash
pg_dump "$DATABASE_URL" > backups/parking-$(date +%F-%H%M%S).sql
```

Пример восстановления:

```bash
psql "$DATABASE_URL" < backups/<backup-file>.sql
```

Если база общая для нескольких сервисов, перед восстановлением обязательно согласуйте окно работ и целевую схему с владельцем БД.

## Замечания по безопасности

Для production обязательно:

- использовать сильный `SECRET_KEY` и сохранять его между перезапусками;
- поставить сервис за HTTPS для реальных пользователей;
- если TLS завершается вне Docker, публиковать frontend только на `127.0.0.1` и наружу открывать только обратный прокси;
- ограничить firewall-доступ к `${FRONTEND_PORT}` или только к внешнему TLS proxy;
- не публиковать backend-порт `8000` в Интернет;
- не коммитить `.env`, дампы БД, backup-файлы и секреты;
- использовать `LDAP_TLS_VALIDATE=true` для LDAPS;
- ограничить права PostgreSQL-пользователя только нужной БД и схемой;
- настроить backup общей PostgreSQL-БД.

Текущая модель аутентификации:

- пароль проверяется через LDAPS;
- JWT bearer token хранится в браузерном `localStorage`;
- это допустимо для небольшого внутреннего сервиса при контролируемом XSS-риске;
- для более строгого корпоративного развертывания стоит перенести хранение сессии в HttpOnly Secure cookies и добавить CSRF-защиту.

Текущая модель БД:

- приложение работает с PostgreSQL через SQLAlchemy;
- compose не управляет жизненным циклом PostgreSQL;
- при запуске нескольких экземпляров backend нужно отдельно оценить конкурентные сценарии бронирования и миграционную стратегию.

## Диагностика проблем

### Ошибка `DATABASE_URL` при запуске

Backend намеренно не стартует без `DATABASE_URL`.

Исправление:

```bash
cp .env.example .env
nano .env
docker compose up --build -d
```

### Backend не становится healthy

`/health` проверяет подключение к БД. Проверьте:

```bash
docker compose logs backend
docker compose exec backend python -c "import os; print(os.environ['DATABASE_URL'])"
```

Не публикуйте реальные пароли из `DATABASE_URL` в чатах, тикетах и логах.

### Интерфейс открывается, API не работает

Проверьте nginx-to-backend proxy:

```bash
curl -i http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health
docker compose logs backend
docker compose logs frontend
```

### Не получается войти

Проверьте:

- доступность `LDAP_URL` из backend-контейнера;
- корректность `LDAP_BIND_DN`;
- корректность `LDAP_BIND_PASSWORD`;
- корректность `LDAP_USER_SEARCH_BASE`;
- подходит ли `LDAP_USER_FILTER` для вашего каталога, например `(sAMAccountName={username})` или `(uid={username})`;
- не отключен ли пользователь локально в админке.

### Первый администратор не появился

Проверьте:

```env
INITIAL_ADMIN_USERNAMES=ivanov
```

Запись создается при старте backend, если такого username еще нет в таблице `users`. Если пользователь уже был создан с другой ролью, поменяйте роль вручную в БД или через другого администратора.

### Вход перестал работать после перезапуска

Если изменился `SECRET_KEY`, старые JWT становятся недействительными. Нужно выйти и войти заново. В production `SECRET_KEY` должен быть стабильным.

### Нужно изменить публичный URL

Обновите `.env`:

```env
CORS_ORIGINS=https://new.example.com
```

Затем примените конфигурацию:

```bash
docker compose up -d
```

### `docker compose down -v` не удалил данные

Это ожидаемо для этой ветки. PostgreSQL-БД внешняя и не управляется compose-файлом приложения.

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
