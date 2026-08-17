# Развертывание shared-postgres в Docker Swarm через один image и GitFlic Registry

Этот документ описывает самый простой вариант поставки ветки `shared-postgres` в Docker Swarm:

- собирается один Docker image с frontend и backend;
- image публикуется в GitFlic Container Registry;
- Swarm запускает один сервис `app` из готового image;
- PostgreSQL не входит в image и не запускается в Swarm;
- backend подключается напрямую к общей PostgreSQL-БД через `DATABASE_URL`;
- авторизация выполняется через LDAPS;
- nginx внутри контейнера отдает frontend и проксирует `/api/` на backend внутри того же контейнера.

## Что уже добавлено в проект

Для этого сценария используются файлы:

```text
Dockerfile.swarm-single
Dockerfile для сборки общего image с frontend, backend и nginx.

deploy/nginx-single.conf
nginx-конфиг для общего контейнера. `/api/` проксируется на `127.0.0.1:8000`.

deploy/start-single.py
Стартовый скрипт без supervisor/s6. Запускает nginx и uvicorn, завершает контейнер при падении одного из процессов.

docker-stack.single.yml
Stack-файл для Docker Swarm. В нем один сервис `app`, готовый `image:` и блок `deploy`.
```

Обычный `docker-compose.yml` остается для локального/простого Docker Compose запуска и не используется как основной файл Swarm-деплоя.

## Как работает итоговая схема

```text
Пользователь
  |
  | HTTP/HTTPS
  v
Docker Swarm service: parking_app
  |
  | published port, например 8081 -> 80
  v
контейнер app
  |
  | nginx:80
  | - отдает React frontend
  | - проксирует /api/* на 127.0.0.1:8000
  v
uvicorn/FastAPI:8000 внутри того же контейнера
  |
  | DATABASE_URL
  v
общая PostgreSQL-БД office_parking_prod

uvicorn/FastAPI
  |
  | LDAPS
  v
LDAP/Active Directory
```

## Что нужно поправить под свою инфраструктуру

### 1. Имя image в GitFlic

Нужно выбрать итоговое имя image в GitFlic Registry.

Для project-level registry формат такой:

```text
registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/<imageName>:<tag>
```

Пример:

```text
registry.gitflic.ru/project/my-company/office-parking/parking-app:1.0.0
```

Что заменить:

```text
<ownerAlias>    алиас пользователя, команды или компании в GitFlic
<projectAlias>  алиас проекта в GitFlic
<imageName>     имя Docker package, например parking-app
<tag>           версия, например 1.0.0 или 2026-08-17
```

Для простоты дальше в примерах используется переменная:

```bash
export APP_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-app:1.0.0'
```

### 2. Порт сервиса

Если сервис должен открываться пользователям на `8081`, задайте:

```bash
export FRONTEND_PORT=8081
```

Тогда Swarm опубликует:

```text
http://<swarm-node-ip>:8081
```

Если перед сервисом будет внешний reverse proxy и пользователи будут открывать домен, например `https://parking.company.ru`, порт можно оставить внутренним для прокси, а наружную публикацию настроить по правилам вашей инфраструктуры.

### 3. CORS_ORIGINS

`CORS_ORIGINS` должен совпадать с адресом, который видит браузер пользователя.

Если пользователи открывают по IP и порту:

```bash
export CORS_ORIGINS='http://<swarm-node-ip>:8081'
```

Если пользователи открывают по домену:

```bash
export CORS_ORIGINS='https://parking.company.ru'
```

Если временно нужны оба варианта:

```bash
export CORS_ORIGINS='http://<swarm-node-ip>:8081,https://parking.company.ru'
```

### 4. PostgreSQL

В Swarm не создается контейнер PostgreSQL. Нужна уже существующая БД.

Для текущих имен:

```text
БД: office_parking_prod
Пользователь БД: parking_app_user
```

Переменная подключения:

```bash
export DATABASE_URL='postgresql+psycopg://parking_app_user:<db_password>@<postgres_host>:5432/office_parking_prod'
```

Что заменить:

```text
<db_password>    пароль пользователя parking_app_user
<postgres_host>  DNS-имя или IP PostgreSQL-сервера
5432             порт PostgreSQL, если он не изменен
```

Если в пароле есть спецсимволы `@`, `#`, `:`, `/`, `?`, `&`, `%`, их нужно URL-кодировать.

Пример:

```text
Abc@123 -> Abc%40123
```

### 5. LDAPS

Нужно задать параметры подключения к LDAP/AD:

```bash
export LDAP_URL='ldaps://ldap.example.local:636'
export LDAP_BIND_DN='CN=parking-bind,OU=Service Accounts,DC=example,DC=local'
export LDAP_BIND_PASSWORD='<ldap_bind_password>'
export LDAP_USER_SEARCH_BASE='OU=Users,DC=example,DC=local'
export LDAP_USER_FILTER='(sAMAccountName={username})'
export LDAP_USER_FULL_NAME_ATTRIBUTE='displayName'
export LDAP_TLS_VALIDATE='true'
export LDAP_CA_CERT_FILE=''
export LDAP_CONNECT_TIMEOUT='5'
```

Если используется LDAPS с внутренним корпоративным CA, контейнеру может понадобиться CA-сертификат. В текущем простом варианте файл сертификата внутрь контейнера не монтируется. Самый простой путь для первого запуска - использовать сертификат, доверенный системой, или временно проверить доступность LDAP с `LDAP_TLS_VALIDATE=false`, а затем вернуть проверку TLS.

### 6. Первый администратор

Так как роли в LDAP не хранятся, первый администратор задается вручную через переменную:

```bash
export INITIAL_ADMIN_USERNAMES='admin_login'
```

Можно указать несколько LDAP-логинов через запятую:

```bash
export INITIAL_ADMIN_USERNAMES='admin_login,second_admin'
```

### 7. SECRET_KEY

Сгенерируйте ключ для подписи JWT:

```bash
openssl rand -hex 32
```

И задайте:

```bash
export SECRET_KEY='<результат openssl rand -hex 32>'
```

Ключ должен сохраняться между перезапусками. Если поменять `SECRET_KEY`, текущие пользовательские сессии станут недействительными.

## Подготовка PostgreSQL

Таблицы вручную создавать не нужно: backend создает их при старте.

На стороне PostgreSQL нужно создать БД и пользователя:

```sql
CREATE DATABASE office_parking_prod;
CREATE USER parking_app_user WITH PASSWORD 'сложный_пароль';
GRANT ALL PRIVILEGES ON DATABASE office_parking_prod TO parking_app_user;
```

Затем подключиться к БД:

```sql
\c office_parking_prod
```

И выдать права на схему:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO parking_app_user;
ALTER SCHEMA public OWNER TO parking_app_user;
```

Если БД уже создана администратором PostgreSQL, достаточно получить:

```text
host
port
database name
user
password
```

И собрать из них `DATABASE_URL`.

## Сборка image на машине разработчика

Перейдите в корень проекта:

```bash
cd /path/to/parking_booking_service
```

Убедитесь, что выбрана ветка:

```bash
git branch --show-current
```

Должно быть:

```text
shared-postgres
```

Задайте имя image:

```bash
export APP_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-app:1.0.0'
```

Соберите общий image:

```bash
docker build -f Dockerfile.swarm-single -t "$APP_IMAGE" .
```

Что происходит при сборке:

1. Docker берет `node:22-alpine`.
2. Выполняет `npm ci` во frontend.
3. Собирает React/Vite frontend через `npm run build`.
4. Берет `python:3.12-slim`.
5. Устанавливает `nginx` и `curl`.
6. Устанавливает Python-зависимости backend из `backend/requirements.txt`.
7. Копирует backend-код.
8. Копирует собранный frontend в `/usr/share/nginx/html`.
9. Копирует nginx-конфиг и стартовый Python-скрипт.

## Публикация image в GitFlic Registry

В GitFlic создайте transport token для доступа к package/container registry.

Залогиньтесь в registry:

```bash
docker login registry.gitflic.ru
```

В качестве username используйте свой GitFlic username. В качестве password используйте transport token.

После успешного логина Docker должен показать:

```text
Login Succeeded
```

Запушьте image:

```bash
docker push "$APP_IMAGE"
```

На этом этапе пакет в GitFlic готов: Swarm сможет скачать image из registry при деплое.

## Что передать человеку, который будет деплоить в Swarm

Достаточный набор:

```text
1. docker-stack.single.yml
2. имя image из GitFlic Registry
3. DATABASE_URL
4. SECRET_KEY
5. INITIAL_ADMIN_USERNAMES
6. LDAP_URL
7. LDAP_BIND_DN
8. LDAP_BIND_PASSWORD
9. LDAP_USER_SEARCH_BASE
10. LDAP_USER_FILTER
11. LDAP_USER_FULL_NAME_ATTRIBUTE
12. LDAP_TLS_VALIDATE
13. LDAP_CA_CERT_FILE, если нужен
14. LDAP_CONNECT_TIMEOUT
15. FRONTEND_PORT
16. CORS_ORIGINS
```

Минимальный пример env для Swarm-машины:

```bash
export APP_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-app:1.0.0'
export FRONTEND_PORT=8081
export APP_REPLICAS=2

export DATABASE_URL='postgresql+psycopg://parking_app_user:<db_password>@<postgres_host>:5432/office_parking_prod'
export SECRET_KEY='<long_random_secret>'
export CORS_ORIGINS='http://<swarm-node-ip>:8081'
export INITIAL_ADMIN_USERNAMES='admin_login'

export LDAP_URL='ldaps://ldap.example.local:636'
export LDAP_BIND_DN='CN=parking-bind,OU=Service Accounts,DC=example,DC=local'
export LDAP_BIND_PASSWORD='<ldap_bind_password>'
export LDAP_USER_SEARCH_BASE='OU=Users,DC=example,DC=local'
export LDAP_USER_FILTER='(sAMAccountName={username})'
export LDAP_USER_FULL_NAME_ATTRIBUTE='displayName'
export LDAP_TLS_VALIDATE='true'
export LDAP_CA_CERT_FILE=''
export LDAP_CONNECT_TIMEOUT='5'
```

## Деплой в Swarm, когда пакет уже опубликован

Этот шаг выполняется на Swarm manager node.

Если Swarm еще не инициализирован:

```bash
docker swarm init
```

Если registry private, на Swarm node нужно выполнить login:

```bash
docker login registry.gitflic.ru
```

После задания env-переменных:

```bash
docker stack deploy -c docker-stack.single.yml parking
```

Проверка:

```bash
docker stack services parking
docker stack ps parking
docker service logs parking_app
```

Ожидаемо должен появиться сервис:

```text
parking_app
```

Если `APP_REPLICAS=2`, Swarm поднимет две реплики одного и того же image.

## Обновление версии

На машине сборки:

```bash
export APP_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-app:1.0.1'
docker build -f Dockerfile.swarm-single -t "$APP_IMAGE" .
docker push "$APP_IMAGE"
```

На Swarm manager node:

```bash
export APP_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-app:1.0.1'
docker stack deploy -c docker-stack.single.yml parking
```

Swarm выполнит rolling update согласно `deploy.update_config`.

## Остановка сервиса

На Swarm manager node:

```bash
docker stack rm parking
```

Это удалит сервис приложения из Swarm, но не затронет внешнюю PostgreSQL-БД.

## Важные ограничения простого варианта

1. В одном контейнере работают два процесса: nginx и uvicorn.
2. Process manager не используется. За процессами следит `deploy/start-single.py`.
3. Если nginx или uvicorn завершается, контейнер завершается, а Swarm перезапускает реплику.
4. PostgreSQL не входит в image и не управляется этим stack-файлом.
5. Backup PostgreSQL нужно организовывать отдельно на стороне БД.
6. Для multi-node Swarm image обязательно должен быть доступен всем нодам через registry.
7. Если GitFlic Registry private, каждая нода, которая может запускать контейнер, должна иметь доступ к registry.

## Короткая шпаргалка

На машине сборки:

```bash
cd /path/to/parking_booking_service
export APP_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-app:1.0.0'
docker login registry.gitflic.ru
docker build -f Dockerfile.swarm-single -t "$APP_IMAGE" .
docker push "$APP_IMAGE"
```

На Swarm manager node:

```bash
export APP_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-app:1.0.0'
export FRONTEND_PORT=8081
export APP_REPLICAS=2
export DATABASE_URL='postgresql+psycopg://parking_app_user:<db_password>@<postgres_host>:5432/office_parking_prod'
export SECRET_KEY='<long_random_secret>'
export CORS_ORIGINS='http://<swarm-node-ip>:8081'
export INITIAL_ADMIN_USERNAMES='admin_login'
export LDAP_URL='ldaps://ldap.example.local:636'
export LDAP_BIND_DN='CN=parking-bind,OU=Service Accounts,DC=example,DC=local'
export LDAP_BIND_PASSWORD='<ldap_bind_password>'
export LDAP_USER_SEARCH_BASE='OU=Users,DC=example,DC=local'
export LDAP_USER_FILTER='(sAMAccountName={username})'
export LDAP_USER_FULL_NAME_ATTRIBUTE='displayName'
export LDAP_TLS_VALIDATE='true'
export LDAP_CA_CERT_FILE=''
export LDAP_CONNECT_TIMEOUT='5'

docker login registry.gitflic.ru
docker stack deploy -c docker-stack.single.yml parking
docker stack services parking
```
