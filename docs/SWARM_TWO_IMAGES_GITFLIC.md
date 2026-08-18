# Развертывание shared-postgres в Docker Swarm двумя образами

Этот документ описывает ветку `swarm-two-images`: вариант развертывания `shared-postgres` в Docker Swarm через два отдельных Docker image.

В этом варианте:

- backend собирается в отдельный image;
- frontend собирается в отдельный image;
- PostgreSQL не запускается в Swarm и остается внешней общей БД;
- frontend nginx проксирует `/api/` на service DNS `backend:8000` внутри overlay-сети;
- Swarm запускает два сервиса: `backend` и `frontend`;
- каждый сервис можно масштабировать независимо через `BACKEND_REPLICAS` и `FRONTEND_REPLICAS`.

## Итоговая схема

```text
Пользователь
  |
  | HTTP/HTTPS
  v
Docker Swarm ingress port, например 8081
  |
  v
service frontend, nginx:80
  |
  | /api/* -> http://backend:8000/
  v
service backend, FastAPI/Uvicorn:8000
  |
  | DATABASE_URL
  v
общая PostgreSQL-БД office_parking_prod

service backend
  |
  | LDAPS
  v
LDAP/Active Directory
```

## Файлы этой ветки

```text
docker-stack.yml
Stack-файл для Docker Swarm с двумя сервисами: backend и frontend.

backend/Dockerfile
Dockerfile backend image.

frontend/Dockerfile
Dockerfile frontend image. На этапе сборки frontend получает VITE_API_URL=/api.

frontend/nginx.conf
nginx-конфиг frontend image. Проксирует /api/ на http://backend:8000/.
```

## Что нужно подготовить до деплоя

На стороне инфраструктуры должны быть:

```text
1. Docker Swarm manager node.
2. GitFlic Container Registry или другой Docker registry.
3. Общая PostgreSQL-БД office_parking_prod.
4. Пользователь PostgreSQL parking_app_user.
5. LDAPS/LDAP параметры.
6. Доступ Swarm node к PostgreSQL и LDAPS.
```

## Подготовка PostgreSQL

Таблицы вручную создавать не нужно. Backend создаст таблицы при старте.

На стороне PostgreSQL нужно подготовить БД и пользователя:

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

Строка подключения для приложения:

```bash
export DATABASE_URL='postgresql+psycopg://parking_app_user:<db_password>@<postgres_host>:5432/office_parking_prod'
```

Если в пароле есть спецсимволы `@`, `#`, `:`, `/`, `?`, `&`, `%`, их нужно URL-кодировать.

## Имена image в GitFlic Registry

Для GitFlic SaaS registry обычно используется адрес:

```text
registry.gitflic.ru
```

Формат project-level image:

```text
registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/<imageName>:<tag>
```

Для двух образов удобно использовать:

```bash
export BACKEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-backend:1.0.0'
export FRONTEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-frontend:1.0.0'
```

Что заменить:

```text
<ownerAlias>    алиас пользователя, компании или команды в GitFlic
<projectAlias>  алиас проекта в GitFlic
1.0.0           версия поставки
```

## Сборка двух образов

На машине сборки перейдите в корень проекта:

```bash
cd /path/to/parking_booking_service
```

Проверьте ветку:

```bash
git branch --show-current
```

Должно быть:

```text
swarm-two-images
```

Задайте имена image:

```bash
export BACKEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-backend:1.0.0'
export FRONTEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-frontend:1.0.0'
```

Соберите backend:

```bash
docker build -t "$BACKEND_IMAGE" ./backend
```

Соберите frontend:

```bash
docker build \
  --build-arg VITE_API_URL=/api \
  --build-arg VITE_TIME_ZONE=Europe/Moscow \
  -t "$FRONTEND_IMAGE" \
  ./frontend
```

Почему `VITE_API_URL=/api`:

```text
браузер обращается к тому же frontend-origin;
frontend nginx принимает /api/*;
nginx внутри frontend image проксирует запросы на backend service;
backend не публикуется наружу отдельным портом.
```

## Публикация образов в GitFlic Registry

Залогиньтесь в registry:

```bash
docker login registry.gitflic.ru
```

В качестве password используйте GitFlic transport token с доступом к package/container registry.

Запушьте backend image:

```bash
docker push "$BACKEND_IMAGE"
```

Запушьте frontend image:

```bash
docker push "$FRONTEND_IMAGE"
```

После этого в registry должны быть два package/image:

```text
parking-backend:1.0.0
parking-frontend:1.0.0
```

## Переменные для Swarm deploy

На Swarm manager node нужно задать переменные:

```bash
export BACKEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-backend:1.0.0'
export FRONTEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-frontend:1.0.0'

export FRONTEND_PORT=8081
export BACKEND_REPLICAS=2
export FRONTEND_REPLICAS=2

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

`CORS_ORIGINS` должен соответствовать адресу, который открывает пользователь в браузере.

Если пользователи открывают сервис по домену:

```bash
export CORS_ORIGINS='https://parking.company.ru'
```

Если нужны и IP, и домен:

```bash
export CORS_ORIGINS='http://<swarm-node-ip>:8081,https://parking.company.ru'
```

## Запуск в Docker Swarm

Если Swarm еще не инициализирован:

```bash
docker swarm init
```

Если registry private, выполните login на Swarm node:

```bash
docker login registry.gitflic.ru
```

Запустите stack:

```bash
docker stack deploy -c docker-stack.yml parking
```

Проверка сервисов:

```bash
docker stack services parking
```

Ожидаемо:

```text
parking_backend
parking_frontend
```

Проверка задач:

```bash
docker stack ps parking
```

Логи backend:

```bash
docker service logs parking_backend
```

Логи frontend:

```bash
docker service logs parking_frontend
```

Проверка снаружи:

```bash
curl http://<swarm-node-ip>:8081/health
curl http://<swarm-node-ip>:8081/api/health
```

Ожидаемо:

```text
ok
```

## Обновление версии

Соберите новые теги:

```bash
export BACKEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-backend:1.0.1'
export FRONTEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-frontend:1.0.1'

docker build -t "$BACKEND_IMAGE" ./backend
docker build \
  --build-arg VITE_API_URL=/api \
  --build-arg VITE_TIME_ZONE=Europe/Moscow \
  -t "$FRONTEND_IMAGE" \
  ./frontend

docker push "$BACKEND_IMAGE"
docker push "$FRONTEND_IMAGE"
```

На Swarm manager node задайте новые значения `BACKEND_IMAGE` и `FRONTEND_IMAGE`, затем повторите:

```bash
docker stack deploy -c docker-stack.yml parking
```

Swarm выполнит rolling update согласно `deploy.update_config`.

## Остановка

```bash
docker stack rm parking
```

Это удалит только Swarm-сервисы приложения. Внешняя PostgreSQL-БД не удаляется и не меняется.

## Важные замечания

1. В `docker-stack.yml` нет `build:`. Swarm должен получать уже готовые images.
2. Для multi-node Swarm оба image должны быть доступны всем нодам через registry.
3. Backend наружу отдельным портом не публикуется.
4. Frontend публикуется через Swarm ingress на `FRONTEND_PORT`.
5. Нельзя масштабировать встроенный PostgreSQL, но в этой ветке PostgreSQL не встроен.
6. Если GitFlic Registry private, каждая нода, где может стартовать задача, должна иметь доступ к registry.
7. Backup PostgreSQL нужно организовать отдельно на стороне БД.

## Короткая шпаргалка

На машине сборки:

```bash
export BACKEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-backend:1.0.0'
export FRONTEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-frontend:1.0.0'

docker login registry.gitflic.ru
docker build -t "$BACKEND_IMAGE" ./backend
docker build --build-arg VITE_API_URL=/api --build-arg VITE_TIME_ZONE=Europe/Moscow -t "$FRONTEND_IMAGE" ./frontend
docker push "$BACKEND_IMAGE"
docker push "$FRONTEND_IMAGE"
```

На Swarm manager node:

```bash
export BACKEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-backend:1.0.0'
export FRONTEND_IMAGE='registry.gitflic.ru/project/<ownerAlias>/<projectAlias>/parking-frontend:1.0.0'
export FRONTEND_PORT=8081
export BACKEND_REPLICAS=2
export FRONTEND_REPLICAS=2
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
docker stack deploy -c docker-stack.yml parking
docker stack services parking
```
