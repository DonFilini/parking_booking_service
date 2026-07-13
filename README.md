# Сервис бронирования парковки

Эта ветка предназначена для развертывания сервиса без собственного контейнера PostgreSQL. Приложение подключается к общей внешней БД PostgreSQL по переменной `DATABASE_URL`.

Frontend отдается nginx, backend работает на FastAPI, логин и пароль проверяются только через LDAPS. Роли пользователей не берутся из LDAP-групп: они хранятся локально в общей PostgreSQL-БД и назначаются администратором вручную.

## Состав проекта

- `frontend/` - React/Vite SPA: бронирование, администрирование, отчетность.
- `backend/` - FastAPI REST API: бизнес-правила, JWT-сессии, роли, PostgreSQL, LDAPS.
- `docker-compose.yml` - запуск только `backend` и `frontend`.
- `.env.example` - шаблон настроек окружения для подключения к общей БД и LDAPS.

## Схема взаимодействия

```mermaid
flowchart LR
    U["Браузер пользователя"] -->|HTTP на FRONTEND_PORT| F["frontend: nginx :80"]
    F -->|HTTP /api/* внутри docker network| B["backend: FastAPI :8000"]
    B -->|PostgreSQL protocol к внешнему хосту| P["Общий PostgreSQL"]
    B -->|LDAPS :636 во внешнюю сеть| L["LDAP/Active Directory"]
```

## Сервисы и порты

| Сервис | Внутри контейнера | Снаружи хоста | Назначение |
|---|---:|---:|---|
| `frontend` | `80/tcp` | `${FRONTEND_BIND_IP}:${FRONTEND_PORT}` | nginx, SPA, прокси `/api` в backend |
| `backend` | `8000/tcp` | не публикуется | REST API, JWT, правила бронирования |
| общий PostgreSQL | внешний порт БД | адрес из `DATABASE_URL` | постоянное хранение данных |
| LDAPS | обычно `636/tcp` | внешний адрес `LDAP_URL` | проверка логина и пароля |

Внутренний порт backend `8000` не конфликтует с портом `8000` на сервере, потому что наружу не пробрасывается. В этой ветке compose не создает PostgreSQL-контейнер и не создает volume для БД.

## Хранение данных

Данные хранятся в общей PostgreSQL-БД, адрес которой задается переменной:

```env
DATABASE_URL=postgresql+psycopg://user:password@postgres-host:5432/parking
```

Перед запуском проекта в общей БД должны быть:

- создана сама база данных;
- создан пользователь БД;
- выданы права на подключение, создание таблиц и работу с таблицами;
- разрешен сетевой доступ от Docker-хоста с приложением до PostgreSQL-хоста.

Backend создает таблицы через SQLAlchemy при старте. Полноценной системы миграций пока нет, поэтому изменения структуры БД в будущем нужно планировать отдельно.

## Авторизация и роли

LDAPS - единственный способ проверки логина и пароля. Локальной проверки пароля в БД нет.

Порядок входа:

1. Frontend отправляет `POST /api/auth/login`.
2. Nginx проксирует запрос в backend `/auth/login`.
3. Backend ищет пользователя в LDAP/AD через `LDAP_BIND_DN` и `LDAP_USER_SEARCH_BASE`.
4. Backend проверяет пароль отдельным bind-ом найденного DN.
5. Backend создает или обновляет локальную запись `users` в PostgreSQL.
6. Backend выдает JWT.

Роли не берутся из LDAP-групп. Роли задаются вручную в админке и хранятся локально в PostgreSQL в таблице `users`.

Если LDAP-пользователь входит впервые и его еще нет в локальной таблице, backend создает его с ролью `employee` и `active=true`. После этого администратор может вручную поменять роль или отключить пользователя.

Чтобы первый администратор смог войти в чистую БД, в `.env` нужно указать `INITIAL_ADMIN_USERNAMES`. Это один или несколько LDAP-логинов через запятую. При старте backend создаст для них локальные записи с ролью `admin`, но пароль все равно будет проверяться только через LDAPS.

## Роли

- `employee` - сотрудник бронирует одно активное место на сегодня, а после 18:00 также на следующий рабочий день.
- `manager` - менеджер бронирует в рамках текущей или следующей недели, может иметь несколько непересекающихся броней.
- `admin` - администратор управляет пользователями, ролями, активностью, местами, бронированиями, настройками и отчетностью.

## Основные API

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/health` | healthcheck backend с проверкой подключения к БД |
| `POST` | `/auth/login` | вход через LDAPS, выдача JWT |
| `GET` | `/auth/me` | текущий пользователь |
| `GET` | `/spots` | список мест |
| `GET` | `/availability?start=YYYY-MM-DD&end=YYYY-MM-DD` | свободные и занятые места |
| `GET` | `/bookings/my` | бронирования текущего пользователя |
| `POST` | `/bookings` | создать бронирование |
| `DELETE` | `/bookings/{id}` | удалить бронь |
| `GET` | `/users` | пользователи, только admin |
| `POST` | `/users` | создать локальный профиль пользователя, только admin |
| `PATCH` | `/users/{id}` | изменить роль, активность или имя пользователя, только admin |
| `GET/PATCH` | `/booking-settings` | включение или отключение бронирований, только admin |

## Переменные окружения

| Переменная | Обязательна | Пример | Назначение |
|---|---|---|---|
| `FRONTEND_BIND_IP` | нет | `0.0.0.0` | IP публикации frontend |
| `FRONTEND_PORT` | нет | `8081` | внешний порт frontend |
| `CORS_ORIGINS` | нет | `http://10.0.0.5:8081` | разрешенные origin для прямого API-доступа |
| `APP_TIME_ZONE` | нет | `Europe/Moscow` | часовой пояс бизнес-правил |
| `SECRET_KEY` | да | `openssl rand -hex 32` | подпись JWT |
| `DATABASE_URL` | да | `postgresql+psycopg://parking:pass@10.0.0.20:5432/parking` | подключение к общей PostgreSQL-БД |
| `INITIAL_ADMIN_USERNAMES` | да | `ivanov,petrov` | LDAP-логины первичных администраторов |
| `LDAP_URL` | да | `ldaps://dc01.example.local:636` | адрес LDAP/AD |
| `LDAP_BIND_DN` | да | `CN=parking-bind,...` | сервисная учетная запись поиска |
| `LDAP_BIND_PASSWORD` | да | пароль | пароль сервисной учетной записи |
| `LDAP_USER_SEARCH_BASE` | да | `OU=Users,DC=example,DC=local` | база поиска пользователей |
| `LDAP_USER_FILTER` | нет | `(sAMAccountName={username})` | фильтр поиска пользователя |
| `LDAP_USER_FULL_NAME_ATTRIBUTE` | нет | `displayName` | атрибут ФИО |
| `LDAP_TLS_VALIDATE` | нет | `true` | проверка сертификата LDAPS |
| `LDAP_CA_CERT_FILE` | нет | `/certs/root-ca.pem` | путь к корпоративному CA внутри backend-контейнера |
| `LDAP_CONNECT_TIMEOUT` | нет | `5` | таймаут LDAP-соединения |

## Первый запуск

```bash
cp .env.example .env
nano .env
```

Минимально заменить:

- `SECRET_KEY`
- `DATABASE_URL`
- `INITIAL_ADMIN_USERNAMES`
- `LDAP_URL`
- `LDAP_BIND_DN`
- `LDAP_BIND_PASSWORD`
- `LDAP_USER_SEARCH_BASE`
- `FRONTEND_PORT`, если нужен не `8080`

Запуск:

```bash
docker compose up -d --build
```

Проверка:

```bash
docker compose ps
curl -I http://127.0.0.1:${FRONTEND_PORT:-8080}/health
curl http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health
```

Ожидаемо должны быть `running` или `healthy` у `backend` и `frontend`. Если backend не становится `healthy`, первым делом проверьте доступность общего PostgreSQL из контейнера backend и корректность `DATABASE_URL`.

## Проверка доступа к общей БД

С Docker-хоста:

```bash
nc -vz postgres-host 5432
```

Из backend-контейнера после запуска:

```bash
docker compose exec backend python -c "import os; from sqlalchemy import create_engine, text; e=create_engine(os.environ['DATABASE_URL']); c=e.connect(); print(c.execute(text('select 1')).scalar()); c.close()"
```

Команда должна вывести `1`.

## Обновление

```bash
git pull
docker compose up -d --build
```

Полная пересборка без кэша:

```bash
docker compose build --no-cache --progress=plain
docker compose up -d
```

## Остановка

```bash
docker compose down
```

В этой ветке `docker compose down -v` не удаляет общую PostgreSQL-БД, потому что compose не управляет ее volume. Но команду все равно стоит использовать осторожно, если в проект позже будут добавлены другие volume.

## Тесты backend

```bash
cd backend
python -m pip install -r requirements.txt
python -m unittest test_booking_rules.py
```

## Эксплуатационные замечания

- Не коммитить `.env`, дампы БД, backup-файлы и реальные секреты.
- `SECRET_KEY` должен быть постоянным; при смене ключа старые JWT станут недействительными.
- Backup общей PostgreSQL-БД должен выполняться на стороне владельца общей БД или отдельным регламентом.
- Для LDAPS рекомендуется `LDAP_TLS_VALIDATE=true`.
- Если используется корпоративный CA, добавьте сертификат в backend-контейнер и укажите путь в `LDAP_CA_CERT_FILE`.
