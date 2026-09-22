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

**Always from the project root.** The db service mounts its data directory with a
*relative* path (`./data/local/postgres` in the root `docker-compose.yml`), so the
cluster is created relative to wherever you ran the command. Starting it from a git
worktree (or any subdirectory) silently creates a *second, empty* cluster there —
`data/local/postgres` under that worktree — and the container keeps that path until it
is recreated. Symptoms: `fitcoach_dev` appears to have lost its data, or a stray
`.worktrees/<slug>/data/local/postgres` directory turns up that nobody can explain.
Verify what the running container is actually bound to with:

```bash
docker inspect fitcoach-db --format '{{range .Mounts}}{{.Source}}{{end}}'
```

If that path is not `<repo root>/data/local/postgres`, recreate the container from the
repo root (`docker compose up -d --force-recreate db`) after checking which of the two
directories holds the data you want to keep.

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
npm run db:local:migrate   # applies drizzle/ migrations to the local database
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
  run_id UUID,                    -- conversation run that produced the turn (nullable, not backfilled)
  seq INTEGER,                    -- per-run monotonic order; null only on pre-migration rows and rows with no run_id
  kind TEXT NOT NULL DEFAULT 'human',  -- 'human' | 'ai' | 'tool_call' | 'tool_result' | 'system_note' | 'summary'
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Optimized for loading conversation history by (userId, phase) in chronological order
CREATE INDEX idx_conversation_turns_user_phase_created
  ON conversation_turns(user_id, phase, created_at);

-- Per-run lookups: the human-row dedup and the MAX(seq) read on every append (BR-LLM-011)
CREATE INDEX idx_conversation_turns_run_id ON conversation_turns(run_id);
```

**Purpose**: The durable record of everything said — read by humans and by the transcript tooling, never by the prompt.
- **Append-only**: Turns are never updated, only inserted
- **Not the prompt's history**: since P4 the dialogue the model sees comes from the checkpointed `messages` channel; no node reads this table to build a prompt (ADR-0013 INV-LLM-001). The pre-P4 laws this block used to state — per-phase context isolation and a sliding window of the last 20 turns — were retired with that refactor; `phase` survives as an analytics column
- **Ordered per run**: rows belonging to a run carry its `run_id` and a `seq` number (`infra/conversation/seq.ts`); only pre-migration rows and rows with no run (a `clearContext` `system_note`) have neither
- **Cascade delete**: All conversation history deleted when user removed

#### conversation_runs
One row per conversation run — the measurement base for the LLM core refactor
(ADR-0013 §8): phase in/out, model, prompt versions, tokens, latency, tool calls,
transition, outcome.

```sql
CREATE TYPE conversation_run_outcome AS ENUM('ok', 'llm_unavailable', 'core_error', 'budget_exhausted');

CREATE TABLE conversation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase_in TEXT NOT NULL,         -- conversation_phase enum
  phase_out TEXT,                 -- conversation_phase enum, null when no transition
  trigger TEXT NOT NULL DEFAULT 'user_message',
  client TEXT NOT NULL DEFAULT 'telegram',
  model TEXT NOT NULL,
  prompt_versions JSONB,
  tokens_in INTEGER,
  tokens_out INTEGER,
  latency_ms INTEGER NOT NULL,
  tool_calls JSONB,               -- [{name, argsHash, outcomeKind}] (ADR-0013 §8)
  transition JSONB,
  outcome conversation_run_outcome NOT NULL,
  budget_report JSONB,
  error_class TEXT,               -- non-'ok' runs only: the thrown value's class
  error_message TEXT,             -- non-'ok' runs only: truncated to 500 chars
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_runs_user_created ON conversation_runs(user_id, created_at);
```

#### llm_calls
One row per model invocation made on behalf of a conversation run — the exact request sent and the
answer received, written by the LLM callback handler regardless of `LOG_LEVEL` (INV-LLM-008). A
run-less call (a background job) is logged but not recorded: `run_id` is `NOT NULL`. Payload columns age out (see `LLM_CALLS_RETENTION_DAYS`);
the rows themselves are never deleted.

```sql
CREATE TABLE llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,           -- not an FK: a call is recorded before any conversation_runs row need exist
  call_index INTEGER NOT NULL,    -- 1-based within the run
  model TEXT NOT NULL,
  request JSONB,                  -- nullable: the payload ages out, the row does not
  response JSONB,
  latency_ms INTEGER NOT NULL,
  error_class TEXT,
  error_message TEXT,
  prompt_hashes TEXT[],           -- prompt_blobs referenced by this request; never nulled by retention
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- The recorder's next-call_index lookup, on the synchronous path of every model call (BR-LLM-011)
CREATE INDEX idx_llm_calls_run_id_call_index ON llm_calls(run_id, call_index);
-- The retention prune's blob-liveness check: array containment, not a scan of llm_calls (BR-LLM-011)
CREATE INDEX idx_llm_calls_prompt_hashes_gin ON llm_calls USING gin(prompt_hashes);
```

#### prompt_blobs
Each distinct system message stored once by content hash, referenced from `llm_calls.request` instead
of being repeated per call. Content is nulled when no unpruned call still references it; the hash row
stays.

```sql
CREATE TABLE prompt_blobs (
  hash TEXT PRIMARY KEY,
  content TEXT,                   -- nullable: aged out by retention
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```


### Schema Management

- **Migrations**: Managed by Drizzle Kit — the only mechanism that changes the schema
- **Schema generate**: `npm run drizzle:generate` (create a migration from `schema.ts` changes)
- **Apply locally**: `npm run db:local:migrate`
- **Durable environments** (dev/prod): migrations are applied only by `deploy/deploy.sh`
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
