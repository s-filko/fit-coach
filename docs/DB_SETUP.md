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

## Database Schema

The application uses Drizzle ORM with PostgreSQL. Schema is defined in `apps/server/src/infra/db/schema.ts`.

### Core Tables

#### users
User accounts and profile status.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT DEFAULT 'en',
  gender TEXT,                    -- 'male' | 'female'
  age INTEGER,
  height INTEGER,                 -- cm
  weight INTEGER,                 -- kg
  fitness_level TEXT,             -- 'beginner' | 'intermediate' | 'advanced'
  fitness_goal TEXT,
  profile_status TEXT DEFAULT 'registration',  -- 'registration' | 'complete'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### user_accounts
Provider-based authentication linkage (Telegram, etc.).

```sql
CREATE TABLE user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,         -- 'telegram', 'google', etc.
  provider_user_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);
```

#### conversation_turns
Conversation history for all phases (registration, chat, training, planning).

```sql
CREATE TABLE conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,            -- 'registration' | 'chat' | 'training' | 'planning'
  role TEXT NOT NULL,             -- 'user' | 'assistant' | 'system' | 'summary'
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Optimized for loading conversation history by (userId, phase) in chronological order
CREATE INDEX idx_conversation_turns_user_phase_created
  ON conversation_turns(user_id, phase, created_at);
```

**Purpose**: Stores all conversation dialogue for context management.
- **Append-only**: Turns are never updated, only inserted
- **Phase isolation**: Each phase has separate conversation context
- **Sliding window**: Queries use LIMIT to load recent turns (default 20)
- **Cascade delete**: All conversation history deleted when user removed

### Schema Management

- **Migrations**: Managed by Drizzle Kit
- **Schema push**: `npm run drizzle:push` (dev/test)
- **Schema generate**: `npm run drizzle:generate` (production migrations)
- **Schema location**: `apps/server/src/infra/db/schema.ts`

### Indexes

Current indexes:
- `idx_conversation_turns_user_phase_created` - Efficient conversation history queries

Future indexes (planned):
- User profile fields for filtering/search
- Compound indexes for analytics queries

---

## Test database

For integration tests, create `apps/server/.env.test` with the same variables and, if needed, a different database name (e.g. `fitcoach_test`). Run tests against the DB: `RUN_DB_TESTS=1 npm run test:integration`.
