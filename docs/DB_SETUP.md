# Database Setup (PostgreSQL + pgvector)

## 1. Start Docker

The server requires a running **Docker** (container with PostgreSQL).

- **macOS:** open **Docker Desktop** and wait until the menu bar shows “Docker Desktop is running”.
- If Docker is not installed: https://docs.docker.com/get-docker/

Verify in the terminal:
```bash
docker info
```
If you do not see `Cannot connect to the Docker daemon`, you can proceed.

## 2. Start the database

From the project root:

```bash
docker compose up -d db
```

Compose brings up:
- host: localhost  
- port: 5432  
- user: postgres  
- password: postgres  
- db: fitcoach  

On first run, create a separate database for dev (if your `.env` uses `fitcoach_dev`):
```bash
docker exec fitcoach-db psql -U postgres -c "CREATE DATABASE fitcoach_dev;"
```

## 3. Server environment variables

File `apps/server/.env` (all fields required):

```
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=fitcoach_dev
BOT_API_KEY=your_secret_key
LLM_API_KEY=sk-...
LLM_API_URL=https://api.openai.com/v1   # optional: for a custom/new API set base URL (e.g. https://api.openrouter.ai/v1)
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.7                     # 0–2, required
```

To use a different LLM API (OpenRouter, Groq, Together, Azure, etc.), set in `.env`:
- `LLM_API_URL` — provider base URL (e.g. `https://api.openrouter.ai/v1`), no trailing slash
- `LLM_API_KEY` — API key from that provider
- `LLM_MODEL` — model name at the provider (e.g. `openai/gpt-4o-mini`)
- `LLM_TEMPERATURE` — number between 0 and 2 (required)

## 4. Apply schema and start the server

From the `apps/server` directory:

```bash
cd apps/server
npm run drizzle:push
npm run dev
```

The server will be at http://localhost:3000. Verify: `curl http://localhost:3000/health` → `{"status":"ok"}`.

---

## Test database

For integration tests, create `apps/server/.env.test` with the same variables and, if needed, a different database name (e.g. `fitcoach_test`). Run tests against the DB: `RUN_DB_TESTS=1 npm run test:integration`.
