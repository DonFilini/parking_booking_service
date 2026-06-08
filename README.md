# Office Parking Booking Service

Stack:
- Backend: FastAPI + SQLAlchemy + SQLite
- Frontend: React + Vite
- Auth: JWT bearer token
- DB: SQLite file `parking.db`

## Запуск backend

```bash
cd backend
python -m venv .venv
# activate venv
pip install -r requirements.txt
uvicorn main:app --reload
```

Настройки можно передать через переменные окружения. Пример лежит в `backend/.env.example`.

## Запуск frontend

```bash
cd frontend
npm install
npm run dev
```

По умолчанию frontend ждёт backend на `http://localhost:8000`.
Настройки Vite лежат в `frontend/.env.example`.

## Запуск в Docker на локальной Linux-машине

Нужны Docker и Docker Compose plugin.

```bash
git clone https://github.com/DonFilini/parking_booking_service.git
cd parking_booking_service
docker compose up --build -d
```

После запуска приложение доступно по адресу:

```text
http://localhost:8080
```

Frontend работает через nginx и проксирует API-запросы на backend по пути `/api`.
SQLite-база хранится в Docker volume `parking_booking_service_parking_data`.

Полезные команды:

```bash
docker compose logs -f
docker compose ps
docker compose restart
docker compose down
```

Чтобы удалить контейнеры вместе с локальной базой:

```bash
docker compose down -v
```

Перед реальным использованием поменяйте `SECRET_KEY` в `docker-compose.yml`.

## Тестовые пользователи

Пароль у всех: `password`

- `employee`
- `manager`
- `admin`

## Что реализовано

- 3 роли: сотрудник, менеджер, администратор
- главная страница: календарь, сетка мест, список бронирований пользователя
- меню пользователя
- CRUD для мест, пользователей, бронирований для администратора
- ограничения по бронированию в зависимости от роли

## Правила

### Сотрудник
- только следующий рабочий день
- бронирование открывается в 18:00 текущего дня
- в пятницу доступно бронирование на понедельник
- только одно активное бронирование

### Менеджер
- до 2 бронирований: одно на текущую неделю, одно на следующую
- доступно весь день
- длина брони максимум 5 рабочих дней

### Администратор
- любые свободные места, любой срок
- управление пользователями, местами и бронированиями

> Для продакшена нужно добавить HTTPS, нормальную систему ролей/прав и более строгую валидацию дат.
