# Database Setup (PostgreSQL + pgvector)

## 1. Запустить Docker

Серверу нужен работающий **Docker** (контейнер с PostgreSQL).

- **macOS:** открой приложение **Docker Desktop** и дождись, пока в строке меню не будет «Docker Desktop is running».
- Если Docker не установлен: https://docs.docker.com/get-docker/

Проверка в терминале:
```bash
docker info
```
Без ошибки `Cannot connect to the Docker daemon` — можно дальше.

## 2. Запустить БД

Из корня проекта:

```bash
docker compose up -d db
```

Compose поднимает:
- host: localhost  
- port: 5432  
- user: postgres  
- password: postgres  
- db: fitcoach  

При первом запуске создай отдельную БД для dev (если в `.env` указан `fitcoach_dev`):
```bash
docker exec fitcoach-db psql -U postgres -c "CREATE DATABASE fitcoach_dev;"
```

## 3. Переменные окружения сервера

Файл `apps/server/.env` (все поля обязательны):

```
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=fitcoach_dev
BOT_API_KEY=твой_секретный_ключ
OPENAI_API_KEY=sk-...
```

## 4. Применить схему и запустить сервер

Из каталога `apps/server`:

```bash
cd apps/server
npm run drizzle:push
npm run dev
```

Сервер будет на http://localhost:3000. Проверка: `curl http://localhost:3000/health` → `{"status":"ok"}`.

---

## Test database

Для интеграционных тестов создай `apps/server/.env.test` с теми же переменными и, при необходимости, другим именем БД (например `fitcoach_test`). Запуск тестов с БД: `RUN_DB_TESTS=1 npm run test:integration`.
