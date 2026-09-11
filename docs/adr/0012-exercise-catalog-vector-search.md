# ADR 0012: Exercise Catalog — Vector Search & LLM-Driven Discovery

**Status**: IMPLEMENTED  
**Date**: 2026-03-12  
**Deciders**: Product + Engineering  
**Extends**: ADR-0007 (LangGraph migration — training tools), ADR-0011 (training tool hardening)

---

## Context

### Problem 1: Fragile off-plan exercise resolution

When a user performs an exercise not in the session plan, `TrainingService.ensureCurrentExercise()` resolves it by loading the entire exercise catalog and doing an exact `name.toLowerCase()` match:

```typescript
// training.service.ts, lines 240-246
const allExercises = await this.exerciseRepo.findAll();
const matchByName = allExercises.find(
  ex => ex.name.toLowerCase() === (opts.exerciseName ?? '').toLowerCase()
);
```

This breaks on any variation: partial names ("bench" vs "Barbell Bench Press"), alternative phrasing ("chest press" vs "Bench Press"), and transliteration from Russian input. The LLM must guess the exact DB name — if it's wrong by a single character, the set is not logged and the user gets an error.

### Problem 2: Full catalog in prompt does not scale

Both `plan-creation.subgraph.ts` and `session-planning.subgraph.ts` load the entire exercise catalog via `exerciseRepository.findAllWithMuscles()` and inject it into the system prompt as `=== AVAILABLE EXERCISES (N total) ===`.

At the current catalog size (59 exercises) this works — approximately 2,000 tokens. At a realistic catalog size (500–2,000 exercises), this would consume 20,000–80,000 tokens per LLM call, degrading response quality and increasing cost by 10–40×.

### Problem 3: Rigid pre-loading prevents flexible discovery

The current architecture pre-loads a fixed exercise list before the LLM runs. The LLM cannot search for exercises dynamically. If a user wants a yoga session but the pre-loaded list contains only strength exercises, the LLM has no mechanism to find yoga poses. Similarly, the LLM cannot filter by equipment, complexity, or muscle group on demand.

### Existing infrastructure

- **Pgvector**: the database image is already `ankane/pgvector` (`deploy/docker-compose.yml`). The extension can be enabled with `CREATE EXTENSION IF NOT EXISTS vector`.
- **Exercise schema**: `exercises` table has `name`, `category`, `equipment`, `exerciseType`, `complexity`, `energyCost`, `description`. The `exercise_muscle_groups` table links exercises to muscle groups with `involvement` (primary/secondary). Indexes exist on `category`, `exerciseType`, `energyCost`, and `muscle_group`.
- **VPS resources**: 3.7 GB RAM total, ~1.5 GB available. 2 CPU cores. A local embedding model (~80 MB RAM) is feasible.

---

## Decision

Replace the full-catalog-in-prompt approach with an **LLM-driven exercise discovery tool** powered by local embeddings and pgvector. The LLM decides when to search, what to search for, and which filters to apply. No exercise list is pre-loaded into any prompt.

### Architecture overview

```
User message
     │
     ▼
LLM (plan_creation / session_planning / training)
     │
     │── decides it needs exercises
     │
     ▼
search_exercises tool call(s)
     │
     ├─ query text ──► EmbeddingService.embed() ──► 384-dim vector
     │                 (local all-MiniLM-L6-v2, in-memory, <10ms)
     │
     ├─ filters ──► SQL WHERE clauses
     │              (equipment, category, muscleGroup, etc.)
     │
     └─► ExerciseRepository.searchByEmbedding()
         │
         ├─ pgvector cosine similarity (embedding <=> $vector)
         ├─ SQL filters (AND equipment IN (...) AND ...)
         ├─ JOIN exercise_muscle_groups (if muscleGroup filter)
         └─ ORDER BY distance ASC LIMIT $limit
              │
              ▼
         Top-N results with similarity scores
              │
              ▼
         LLM receives results, continues planning/logging
```

The LLM may call `search_exercises` multiple times in a single response (parallel tool calls). Each call is independent and executes in parallel. For plan creation, a typical flow involves 3–5 parallel search calls (one per muscle group), returning 30–50 exercises total.

---

### 1. EmbeddingService

New infrastructure service providing local text-to-vector embedding.

**File**: `apps/server/src/infra/ai/embedding.service.ts`

```typescript
interface IEmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

**Implementation details:**

- Model: `all-MiniLM-L6-v2` via `@huggingface/transformers` (ONNX runtime, pure JavaScript, no Python dependency)
- 384-dimensional vectors, cosine similarity
- Lazy-loaded singleton: model loaded on first `embed()` call, kept in memory (~80 MB)
- All queries and embeddings are in **English only**. The model performs best on English text. Russian user input is translated to English by the LLM before calling `search_exercises`.
- DI token: `EMBEDDING_SERVICE_TOKEN` registered in `register-infra-services.ts` (called from bootstrap)
- Warm-up: `embeddingService.warmUp()` called during server startup to pre-load the model (~2–3 seconds cold start)

### 2. Composite embedding text

Exercise embeddings are generated from a composite text that encodes the full semantic profile, not just the name:

```typescript
function buildEmbeddingText(exercise: Exercise, muscles: MuscleGroupInfo[]): string {
  const primary = muscles
    .filter(m => m.involvement === 'primary')
    .map(m => m.muscleGroup).join(', ');
  const secondary = muscles
    .filter(m => m.involvement === 'secondary')
    .map(m => m.muscleGroup).join(', ');

  return [
    exercise.name,
    `${exercise.category} ${exercise.exerciseType} exercise`,
    `Equipment: ${exercise.equipment}`,
    primary && `Primary muscles: ${primary}`,
    secondary && `Secondary muscles: ${secondary}`,
    `Difficulty: ${exercise.complexity}`,
    exercise.description,
  ].filter(Boolean).join('. ');
}
```

Example output for Barbell Bench Press:

```
Barbell Bench Press. compound strength exercise. Equipment: barbell.
Primary muscles: chest. Secondary muscles: shoulders_front, triceps.
Difficulty: intermediate. Classic chest compound movement with barbell
```

This enables semantic queries like `"compound chest exercise with barbell"` to rank Bench Press higher than Cable Flyes, because the embedding captures equipment, movement pattern, and muscle involvement — not just the name.

### 3. Schema changes

**File**: `apps/server/src/infra/db/schema.ts`

Add to `exercises` table:

- `embedding: vector('embedding', { dimensions: 384 })` — nullable (existing rows not broken, populated by seed/migration)
- `userId: uuid('user_id').references(() => users.id)` — nullable (infrastructure for future personal exercises, no application logic yet)
- HNSW index on `embedding` for fast approximate nearest neighbor search

**Drizzle migration** required. The migration also runs `CREATE EXTENSION IF NOT EXISTS vector` to enable pgvector.

### 4. ExerciseRepository — searchByEmbedding

**Interface** (`apps/server/src/domain/training/ports/repository.ports.ts`):

```typescript
interface IExerciseRepository {
  // ... existing methods ...

  searchByEmbedding(
    embedding: number[],
    filters?: {
      equipment?: string[];
      category?: string;
      muscleGroup?: string;
    },
    limit?: number,
  ): Promise<Array<ExerciseWithMuscles & { similarity: number }>>;
}
```

**Implementation** (`apps/server/src/infra/db/repositories/exercise.repository.ts`):

Uses pgvector `<=>` (cosine distance) operator. Filters are standard SQL `WHERE` clauses applied **before** the vector ranking, so pgvector only scans relevant rows:

```sql
SELECT e.*, 1 - (e.embedding <=> $1) AS similarity
FROM exercises e
-- optional: JOIN exercise_muscle_groups for muscleGroup filter
WHERE e.embedding IS NOT NULL
  AND ($2::text[] IS NULL OR e.equipment = ANY($2))
  AND ($3::text IS NULL OR e.category = $3)
  -- muscleGroup filter via JOIN if provided
ORDER BY e.embedding <=> $1 ASC
LIMIT $4
```

### 5. `search_exercises` tool

Universal tool available in **all three phases**: `plan_creation`, `session_planning`, `training`.

**Schema:**

```typescript
z.object({
  query: z.string().describe(
    'Search query in English. Describe the exercise by name, movement pattern, '
    + 'target muscles, or any combination. Examples: "compound chest press", '
    + '"lateral shoulder raise cable", "bodyweight back exercise".'
  ),
  muscleGroup: z.string().optional().describe(
    'Filter by primary muscle group. Values: chest, back_lats, back_traps, '
    + 'shoulders_front, shoulders_side, shoulders_rear, quads, hamstrings, '
    + 'glutes, calves, biceps, triceps, forearms, abs, lower_back, core, etc.'
  ),
  equipment: z.array(z.string()).optional().describe(
    'Filter by allowed equipment. Values: barbell, dumbbell, bodyweight, '
    + 'machine, cable, none. Pass multiple to allow any of them.'
  ),
  category: z.string().optional().describe(
    'Filter by exercise category. Values: compound, isolation, cardio, '
    + 'functional, mobility.'
  ),
  limit: z.number().int().min(1).max(20).optional().describe(
    'Max results to return. Default: 10.'
  ),
})
```

**Return format:**

```
Found 5 exercises:
1. [ID:1] Barbell Bench Press (similarity: 0.92)
   Compound | Barbell | Primary: chest | Secondary: shoulders_front, triceps
2. [ID:2] Incline Dumbbell Press (similarity: 0.87)
   Compound | Dumbbell | Primary: chest | Secondary: shoulders_front, triceps
3. ...
```

**Implementation flow:**

1. Receive query + filters from LLM
2. `embeddingService.embed(query)` → 384-dim vector (~1ms)
3. `exerciseRepository.searchByEmbedding(vector, filters, limit)` → ranked results (~5ms)
4. Format results as text → return to LLM

### 6. Remove pre-loaded exercise lists from prompts

**Files affected (all done ✅):**

- `plan-creation.subgraph.ts` — removed `findAllWithMuscles()` call, replaced `ToolNode` with `buildDedupToolNode`
- `session-planning.subgraph.ts` — removed `findAllWithMuscles()` call, replaced `ToolNode` with `buildDedupToolNode`
- `session-planning.node.ts` — removed `AVAILABLE EXERCISES` section and `exercises` parameter
- `plan-creation.node.ts` — removed exercises section and `exercises` parameter

The prompts are updated to instruct the LLM to use `search_exercises` instead:

```
Use the search_exercises tool to find exercises for the plan.
Call it with relevant queries and filters (muscle group, equipment, category).
You may call search_exercises multiple times in parallel to search
for different muscle groups simultaneously.
```

### 7. Replace exact-match in ensureCurrentExercise

**File**: `apps/server/src/domain/training/services/training.service.ts`

Current code (lines 240–246):

```typescript
const allExercises = await this.exerciseRepo.findAll();
const matchByName = allExercises.find(
  ex => ex.name.toLowerCase() === (opts.exerciseName ?? '').toLowerCase()
);
```

Replaced with:

```typescript
const embedding = await this.embeddingService.embed(opts.exerciseName);
const results = await this.exerciseRepo.searchByEmbedding(embedding, {}, 1);
if (results.length === 0 || results[0].similarity < 0.7) {
  throw new Error(
    `Exercise "${opts.exerciseName}" not found. Use search_exercises tool to find the correct exercise.`
  );
}
const resolvedExerciseId = results[0].id;
```

This is a **fallback** path. The primary flow is: LLM uses `search_exercises` tool, gets the exerciseId, passes it to `log_set`. The `exerciseName` fallback in `ensureCurrentExercise` is for backward compatibility and edge cases.

### 8. Training prompt update

**File**: `apps/server/src/infra/ai/graph/nodes/training.node.ts`

Add `search_exercises` to the TOOLS section:

```
- search_exercises: Find exercises in the catalog by name, movement pattern,
  or target muscles. Query must be in English. Use this to identify off-plan
  exercises before logging. Always verify the matched exercise with the user
  before calling log_set.
```

Update existing rule 5 (off-plan exercises):

```
5. Off-plan exercises: If the user does something not in the plan, call
   search_exercises to find the exercise. Present the top result to the user:
   "Hammer Curl (ID:15) — is that what you did?" Only after confirmation,
   call log_set with the confirmed exerciseId. NEVER pass exerciseName
   to log_set without first confirming via search_exercises.
```

Add anti-pattern:

```
❌ User says "did hammer curls" → you call log_set with exerciseName
   without first calling search_exercises (WRONG — always search first,
   confirm with user, then log with exerciseId)
```

### 9. Seed embeddings

**File**: `apps/server/src/infra/db/seeds/seed-embeddings.ts`

After inserting exercises and muscle groups, generate embeddings:

1. Load all exercises with muscle groups
2. Build composite text for each via `buildEmbeddingText()`
3. `embeddingService.embedBatch(texts)` — single batch call
4. Update `embedding` column for each exercise

Idempotent: skip exercises that already have a non-null `embedding`.

### 10. Deploy

**`deploy/docker-compose.yml`** — add volume to server service:

```yaml
server:
  volumes:
    - hf-cache-${DEPLOY_ENV}:/app/.cache/huggingface
```

**`apps/server/Dockerfile`** — set HuggingFace cache directory:

```dockerfile
ENV HF_HOME=/app/.cache/huggingface
```

`@huggingface/transformers` is installed as a standard npm dependency — no special Docker steps needed. On first startup the model is downloaded to `HF_HOME` (~80 MB). The Docker volume persists it across container restarts.

### 11. Bootstrap

**File**: `apps/server/src/main/register-infra-services.ts` (invoked from bootstrap)

- Register `EmbeddingService` with DI token `EMBEDDING_SERVICE_TOKEN`
- Call `embeddingService.warmUp()` during startup to pre-load the model (non-blocking, fire-and-forget)
- Register `search_exercises` tool in all three subgraphs: `plan_creation`, `session_planning`, `training`

### 12. Data integrity guarantees

Without a pre-loaded exercise list in the prompt, the LLM may hallucinate or misremember exercise IDs returned by `search_exercises`. Two layers of protection prevent invalid IDs from reaching the database:

**Layer 1: Tool-level validation with corrective error messages**

All tools that accept `exerciseId` validate it against the database before writing. If validation fails, the tool returns a structured error message that tells the LLM **how to fix the problem** — not just that an error occurred. The LLM self-corrects within the existing agent→tools→agent loop (ADR-0011 retry budget allows 1 retry).

**`save_workout_plan`** (`plan-creation.tools.ts`):

Before saving, extract all `exerciseId` values from `input.sessionTemplates[*].exercises`, batch-query `exerciseRepo.findByIds(ids)`, and verify all were found. If any are missing:

```
LLM_ERROR: Exercise IDs not found in catalog: [150, 999].
These IDs were used for exercises named "Hammer Curl", "Fake Press".
Call search_exercises for each missing exercise to find the correct ID,
then resubmit save_workout_plan with corrected IDs.
```

The LLM calls `search_exercises` for each missing exercise, gets the correct IDs, and resubmits the full plan. The user sees nothing — the correction happens inside the tool loop.

**`start_training_session`** (`session-planning.tools.ts`):

Same validation pattern. Extract `exerciseId` from `input.exercises`, verify all exist. Return corrective error if any are missing.

**`log_set`** (`training.tools.ts`):

`ensureCurrentExercise` already throws when the exercise is not found. The error message is updated to instruct the LLM to use `search_exercises`:

```
LLM_ERROR: Exercise ID 150 not found. Call search_exercises to find
the correct exercise, then retry log_set with the correct exerciseId.
```

**Layer 2: Database foreign key constraints**

`session_exercises.exercise_id` has a FK reference to `exercises.id`. Even if tool validation is bypassed (code bug), the database rejects invalid IDs at INSERT time. This is the last line of defense — it should never be reached in normal operation.

**User experience:** The user never sees exercise IDs or error messages. All corrections happen within the LLM tool loop. The LLM reports the final result to the user in natural language ("Plan saved!" / "Set logged!").

### 13. Tool call ordering for search_exercises in training subgraph

The training subgraph uses a custom `sequentialToolNode` with a priority map (ADR-0011). `search_exercises` must execute **before** `log_set` — if the LLM calls both in one response (search + log), the search must resolve first so `log_set` has the correct `exerciseId`.

Add `search_exercises` to the priority map:

```typescript
const TOOL_PRIORITY: Record<string, number> = {
  search_exercises: 0,           // runs first (read-only, no side effects)
  log_set: 1,
  complete_current_exercise: 2,
  delete_last_sets: 3,
  update_last_set: 3,
  finish_training: 4,
};
```

However, `search_exercises` returns data that the LLM needs to **read and decide on** before calling `log_set`. Executing both in the same batch means `log_set` runs with the `exerciseId` the LLM already decided on, not the one returned by search. The correct behavior is:

1. LLM calls `search_exercises` alone → gets results
2. LLM reads results, calls `log_set` with the correct ID in the next turn

This is enforced via prompt instruction:

```
NEVER call search_exercises and log_set in the same response.
Search first, wait for results, confirm with the user, then log.
```

If the LLM violates this, the priority map ensures search runs first, and `log_set` will either succeed (if the ID happens to be correct) or fail with a corrective error (Layer 1 validation).

### 14. buildDedupToolNode (plan-creation & session-planning)

**File**: `apps/server/src/infra/ai/graph/dedup-tool-node.ts`

Plan-creation and session-planning subgraphs use `buildDedupToolNode(tools)` instead of the default `ToolNode`.
When the LLM calls `search_exercises` multiple times with identical parameters in a single response, only
the first call is executed (embed + DB query); duplicates receive the cached result. Non-`search_exercises`
tools run normally.

Training subgraph uses `sequentialToolNode` with priority ordering and does not use `buildDedupToolNode`.

### 15. invokeWithRetry (all subgraphs)

**File**: `apps/server/src/infra/ai/graph/invoke-with-retry.ts`

All three subgraphs use `invokeWithRetry(model, messages, userId)` instead of direct `model.invoke()`.
If the LLM returns an empty response (no content, no tool calls), the call is retried once with an
added `SystemMessage` nudge. This handles models (e.g. Gemini via OpenRouter) that sometimes skip their
reply after a successful tool call.

---

## Affected files

| File | Change | Status |
|------|--------|--------|
| `apps/server/src/infra/ai/embedding.service.ts` | NEW — EmbeddingService with local model | ✅ |
| `apps/server/src/infra/ai/embedding-text.util.ts` | NEW — `buildEmbeddingText()` utility | ✅ |
| `apps/server/src/infra/ai/graph/tools/search-exercises.tool.ts` | NEW — `search_exercises` LangChain tool | ✅ |
| `apps/server/src/infra/ai/graph/dedup-tool-node.ts` | NEW — Deduplicating tool node for search_exercises | ✅ |
| `apps/server/src/infra/ai/graph/invoke-with-retry.ts` | NEW — Retry wrapper for empty LLM responses | ✅ |
| `apps/server/src/domain/training/ports/embedding.ports.ts` | NEW — `IEmbeddingService` interface (domain port) | ✅ |
| `apps/server/src/infra/db/seeds/seed-embeddings.ts` | NEW — Generate and store embeddings | ✅ |
| `apps/server/drizzle/0006_large_apocalypse.sql` | NEW — Migration: vector extension, `embedding`/`userId` columns, HNSW index | ✅ |
| `apps/server/src/infra/db/schema.ts` | Add `embedding`, `userId` columns to exercises | ✅ |
| `apps/server/src/domain/training/ports/repository.ports.ts` | Add `searchByEmbedding`, `updateEmbedding` to IExerciseRepository | ✅ |
| `apps/server/src/infra/db/repositories/exercise.repository.ts` | Implement `searchByEmbedding`, `updateEmbedding` | ✅ |
| `apps/server/src/domain/training/services/training.service.ts` | Replace exact name match with three-step fallback (exact → embedding → ilike) | ✅ |
| `apps/server/src/main/register-infra-services.ts` | Register EmbeddingService, warm-up, pass to subgraphs | ✅ |
| `apps/server/src/infra/ai/graph/conversation.graph.ts` | Add `IEmbeddingService` to ConversationGraphDeps | ✅ |
| `apps/server/src/infra/ai/graph/tools/plan-creation.tools.ts` | Add `search_exercises`, exerciseId validation in `save_workout_plan` | ✅ |
| `apps/server/src/infra/ai/graph/tools/session-planning.tools.ts` | Add `search_exercises`, exerciseId validation in `start_training_session` | ✅ |
| `apps/server/src/infra/ai/graph/tools/training.tools.ts` | Add `search_exercises` tool | ✅ |
| `apps/server/src/infra/ai/graph/nodes/plan-creation.node.ts` | Remove exercises section, add search instructions | ✅ |
| `apps/server/src/infra/ai/graph/nodes/session-planning.node.ts` | Remove AVAILABLE EXERCISES, add search instructions | ✅ |
| `apps/server/src/infra/ai/graph/subgraphs/plan-creation.subgraph.ts` | Remove `findAllWithMuscles()`, use `buildDedupToolNode`, `invokeWithRetry` | ✅ |
| `apps/server/src/infra/ai/graph/subgraphs/session-planning.subgraph.ts` | Remove `findAllWithMuscles()`, use `buildDedupToolNode`, `invokeWithRetry` | ✅ |
| `apps/server/src/infra/ai/graph/subgraphs/training.subgraph.ts` | Add `search_exercises` to priority map, use `invokeWithRetry` | ✅ |
| `deploy/docker-compose.yml` | Add hf-cache volume | ⬜ deferred |
| `apps/server/Dockerfile` | Set HF_HOME env | ⬜ deferred |

---

## Consequences

**Positive:**

- Off-plan exercise resolution becomes robust — semantic similarity instead of exact string match
- Exercise catalog scales to any size without impacting prompt length or cost
- LLM has full control over exercise discovery — searches what it needs, when it needs it
- Unified mechanism across all phases (plan creation, session planning, training)
- SQL filters (equipment, category, muscleGroup) provide precise control over results
- Local model: zero API cost, zero external dependency, sub-10ms per query
- ~80 MB RAM footprint — negligible on the VPS
- Extensible: new filters (complexity, exerciseType, excludeIds, userId) are trivial additions — one SQL `AND` clause each

**Negative / Risks:**

- **LLM may not call the tool when needed.** If the LLM forgets to call `search_exercises` during plan creation, it has no exercise data and may hallucinate IDs. Mitigation: (1) system prompts explicitly instruct to always use the tool; (2) `save_workout_plan` and `start_training_session` validate all exerciseIds and return corrective errors with instructions to call `search_exercises` (Section 12).
- **LLM may hallucinate exerciseIds** even after calling `search_exercises` — misremembering or combining IDs from different search results. Mitigation: tool-level validation catches all invalid IDs before they reach the database. The corrective error message instructs the LLM to re-search and resubmit. The user never sees the error (Section 12).
- **Additional LLM round-trips.** Plan creation may require 3–5 tool calls to gather exercises, adding ~5 seconds of LLM processing time. Mitigation: parallel tool calls reduce this to a single round-trip; embedding + SQL execution is sub-10ms and not the bottleneck.
- **Cold start.** First `embed()` call loads the model (~2–3 seconds). Mitigation: warm-up during server bootstrap, before any user requests.
- **Embedding quality for similar exercises.** "Bench Press" and "Incline Bench Press" have very close embeddings (delta ~0.05). Vector search alone cannot reliably distinguish them. Mitigation: the LLM sees the full result list with names and attributes, and asks the user for clarification when results are ambiguous.
- **Embedding drift.** If the model is updated, all stored embeddings must be regenerated. Mitigation: store model identifier in config; provide a regeneration script/seed command.
- **Model size constraint.** `all-MiniLM-L6-v2` has a 256-token input limit. Composite embedding texts must stay under ~50 words. Current format (~30–40 words) fits comfortably.
- **Domain→Infra dependency.** `TrainingService` (domain layer) needs `EmbeddingService` (infra layer) for the `ensureCurrentExercise` fallback. Mitigation: define `IEmbeddingService` interface as a domain port; inject the infra implementation via DI. This preserves the dependency inversion principle (ADR-0002).

---

## Future expansion (not implemented, architecture supports)

- **Personal exercises**: `userId` column already added to `exercises`. Future: users create custom exercises visible only to them. `searchByEmbedding` already supports `WHERE (user_id IS NULL OR user_id = $userId)` filter shape.
- **User history boost**: exercises previously performed by this user get a score boost in search results. Implementation: `LEFT JOIN` on `session_exercises` grouped by `user_id`, adjust similarity score. Applicable only to training runtime — plan creation should not be biased toward familiar exercises.
- **Clarification flow**: when top results have close similarity scores (delta < 0.05), the LLM asks the user to disambiguate before logging: "Подтягивания — wide grip or close grip?" Mandatory confirmation for any off-plan exercise.
- **Environment filtering**: `training_environment` field on workout plan metadata (`'gym' | 'home' | 'home_equipped'`). Maps to equipment SQL filter applied automatically during session planning.
- **`availableEquipment` in plan metadata**: more precise than environment — user specifies exact equipment they have access to. SQL filter uses the list directly.
- **Additional tool filters**: `complexity`, `exerciseType`, `excludeIds` (already selected), `energyCost` — each is a single SQL `AND` clause added to `searchByEmbedding`.

---

## Execution Order

Each phase includes its own tests. CI must pass at the end of every phase.

```
Phase 1: Infrastructure ✅ DONE
  Code:
    ✅ EmbeddingService (local model, embed/embedBatch)
    ✅ IEmbeddingService port in domain layer
    ✅ Schema migration (embedding column, userId column, HNSW index, vector extension)
    ✅ ExerciseRepository.searchByEmbedding()
    ✅ Seed embeddings for existing 59 exercises
    ⬜ Deploy config (Docker volume, HF_HOME) — deferred to deploy phase
    ✅ Bootstrap: DI registration, warm-up
  Tests:
    ✅ embedding-text.util.unit.test.ts — buildEmbeddingText composite text
    ⬜ training.repository.integration.test.ts — searchByEmbedding (deferred, requires pgvector in CI)

Phase 2: search_exercises tool + data integrity ✅ DONE
  Code:
    ✅ search_exercises tool implementation (embed + searchByEmbedding + format)
    ✅ Register tool in all three subgraphs (training, session_planning, plan_creation)
    ✅ Add search_exercises to training subgraph priority map (priority: 0)
    ✅ Add exerciseId validation in save_workout_plan tool
    ✅ Add exerciseId validation in start_training_session tool
    ✅ buildDedupToolNode — per-turn deduplication of identical search calls
    ✅ invokeWithRetry — retry + SystemMessage nudge for empty LLM responses
  Tests:
    ✅ search-exercises.tool.unit.test.ts — embed→search pipeline, filters, formatting, errors
    ✅ dedup-tool-node.unit.test.ts — dedup cache, non-search passthrough
    ✅ invoke-with-retry.unit.test.ts — retry logic, nudge insertion
    ✅ plan-creation.tools.unit.test.ts — exerciseId validation
    ✅ session-planning.tools.unit.test.ts — exerciseId validation
    ✅ training.subgraph.unit.test.ts — search_exercises in priority map

Phase 3: Prompt migration ✅ DONE
  Code:
    ✅ Training prompt: add search_exercises to TOOLS, update off-plan protocol
    ✅ Session planning prompt: remove AVAILABLE EXERCISES section, add search instructions
    ✅ Plan creation prompt: remove exercises section, replace "Use ONLY from list" rule
    ✅ Remove findAllWithMuscles() calls from plan-creation.subgraph and session-planning.subgraph
    ✅ Remove exercises parameter from prompt builder function signatures
  Tests:
    ✅ plan-creation.subgraph.unit.test.ts — mock fixes (embeddingService, no findAllWithMuscles)
    ✅ session-planning.subgraph.unit.test.ts — mock fixes
    ✅ conversation.graph.unit.test.ts — mock fixes
  Manual testing: see "Manual testing checklist" section above

Phase 4: ensureCurrentExercise hardening ✅ DONE
  Code:
    ✅ Replace exact name match with three-step fallback (exact → embedding → ilike)
    ✅ Inject IEmbeddingService into TrainingService via DI
  Tests:
    ✅ training-service-hardening.unit.test.ts — embedding fallback, ilike fallback
```

All four phases are complete. Two items deferred:
- Deploy config (Docker volume, HF_HOME) — will be done during deployment to VPS
- `searchByEmbedding` integration test — requires pgvector extension in CI database

### Test summary

#### Unit tests

| File | New/Update | What it covers |
|------|------------|----------------|
| `src/infra/ai/__tests__/embedding-text.util.unit.test.ts` | NEW | `buildEmbeddingText()` — composite text format, primary/secondary muscle grouping, optional fields |
| `src/infra/ai/graph/tools/__tests__/search-exercises.tool.unit.test.ts` | NEW | `search_exercises` — embed→search pipeline, filter passthrough, result formatting, error handling |
| `src/infra/ai/graph/__tests__/dedup-tool-node.unit.test.ts` | NEW | `buildDedupToolNode` — deduplication of identical search calls, cache per turn, non-search tools unaffected |
| `src/infra/ai/graph/__tests__/invoke-with-retry.unit.test.ts` | NEW | `invokeWithRetry` — empty response retry, SystemMessage nudge insertion, normal pass-through |
| `src/infra/ai/graph/tools/__tests__/plan-creation.tools.unit.test.ts` | UPDATE | exerciseId validation in `save_workout_plan`, embeddingService in mocks |
| `src/infra/ai/graph/tools/__tests__/session-planning.tools.unit.test.ts` | UPDATE | exerciseId validation in `start_training_session`, embeddingService in mocks |
| `src/infra/ai/graph/tools/__tests__/training.tools.unit.test.ts` | UPDATE | embeddingService in mocks, search_exercises in tool list |
| `src/infra/ai/graph/subgraphs/__tests__/plan-creation.subgraph.unit.test.ts` | UPDATE | mock fixes (embeddingService, no findAllWithMuscles) |
| `src/infra/ai/graph/subgraphs/__tests__/session-planning.subgraph.unit.test.ts` | UPDATE | mock fixes (embeddingService, no findAllWithMuscles) |
| `src/infra/ai/graph/__tests__/conversation.graph.unit.test.ts` | UPDATE | mock fixes (embeddingService in ConversationGraphDeps) |
| `src/domain/training/services/__tests__/training-service-hardening.unit.test.ts` | UPDATE | ensureCurrentExercise: embedding fallback, ilike fallback when no embeddingService |

#### Integration tests

| File | New/Update | What it covers |
|------|------------|----------------|
| `tests/integration/services/training.service.integration.test.ts` | UPDATE | Full training flow with exercise resolution |

#### Run commands

```bash
# All unit tests affected by this ADR
npx jest --testPathPatterns='(embedding|search-exercises|dedup-tool|invoke-with-retry|plan-creation|session-planning|training\.(tools|subgraph)|conversation\.graph)\.unit' --no-coverage

# Full test suite
npx jest --no-coverage
```

### Manual testing checklist

Manual testing validates end-to-end LLM behavior that unit tests cannot cover — actual tool calls, response quality, and search relevance.

**Prerequisites:**
- Server running (`npm run dev` in `apps/server`)
- Embeddings seeded (`npx tsx src/infra/db/seeds/seed-embeddings.ts`)
- A test user created (via registration flow or API)

#### 1. Plan creation

| Step | Action | What to validate |
|------|--------|------------------|
| 1.1 | Send message: "Создай мне программу тренировок на 4 дня, upper/lower split, для зала" | LLM responds with clarifying questions or starts planning |
| 1.2 | Answer clarifying questions, confirm goals | LLM calls `search_exercises` — check logs |
| 1.3 | Wait for plan to be created | `save_workout_plan` is called successfully |

**Validation in logs** (`tail -n 200 logs/server.log | npx pino-pretty`):
- `search_exercises` called 3–6 times (one per muscle group focus, not 14+)
- No duplicate queries within a single turn (dedup-tool-node logs: `search_exercises dedup saved calls`)
- Each search returns 5–10 relevant results (not 50+)
- `save_workout_plan` succeeds — no `LLM_ERROR: Exercise IDs not found` messages
- **Red flag**: if `search_exercises` is called >10 times total, the prompt may need tuning
- **Red flag**: if `save_workout_plan` returns `LLM_ERROR`, the LLM hallucinated exercise IDs

#### 2. Session planning

| Step | Action | What to validate |
|------|--------|------------------|
| 2.1 | Send message: "Давай потренируемся" or "Запланируй тренировку" | LLM enters session planning phase |
| 2.2 | Confirm session parameters or let LLM suggest | LLM calls `search_exercises` to find exercises for the session |
| 2.3 | Approve proposed session | `start_training_session` is called |

**Validation in logs:**
- LLM searches for exercises matching the plan's focus for today
- Exercise IDs in `start_training_session` match IDs returned by `search_exercises`
- Session is created with valid exercises — no exerciseId validation errors
- Response is not empty (invokeWithRetry handles this)
- **Red flag**: empty `data.content` in API response — the `invokeWithRetry` nudge may not be working
- **Red flag**: LLM echoes "IMPORTANT: All tool calls are complete…" — SystemMessage leak

#### 3. Exercise replacement during training

| Step | Action | What to validate |
|------|--------|------------------|
| 3.1 | During active training, say: "Этот тренажёр занят, давай заменим на что-то другое" | LLM calls `search_exercises` for alternatives |
| 3.2 | LLM proposes alternatives | Alternatives match the muscle group and equipment context |
| 3.3 | Confirm replacement | `log_set` is called with the new exercise ID |

**Validation in logs:**
- `search_exercises` called with relevant query (e.g. "chest compound dumbbell" if replacing a barbell chest press)
- `log_set` uses an ID that was returned by the preceding `search_exercises` call
- `ensureCurrentExercise` succeeds (no "Exercise not found" errors)

#### 4. Off-plan exercise (edge case)

| Step | Action | What to validate |
|------|--------|------------------|
| 4.1 | During training, say: "Я сделал 3 подхода подтягиваний" (an exercise not in the session) | LLM resolves the exercise name to an ID |
| 4.2 | Sets are logged | `log_set` or `ensureCurrentExercise` succeeds |

**Validation in logs:**
- Either `search_exercises` is called and the LLM uses the returned ID, or `ensureCurrentExercise` resolves it via embedding fallback
- No "Exercise not found in DB" error
- **Red flag**: if LLM guesses an exercise ID without searching first

#### 5. Search quality spot checks

Run these queries manually against the API or test them in conversation:

| Query context | Expected behavior |
|---------------|-------------------|
| "Упражнения для груди со штангой" | LLM searches "chest compound barbell" → results include Bench Press, Incline Press |
| "Что-нибудь для ног без тренажёров" | LLM searches with `equipment: bodyweight` or query "legs bodyweight" → squats, lunges |
| "Упражнения на спину" | LLM searches "back" → lat pulldown, rows, pull-ups |
| "Кардио для дома" | LLM searches "cardio bodyweight home" → jumping jacks, burpees |

**How to validate search quality:**
- Results should match the muscle group/equipment context from the conversation
- Primary muscles in results should align with the search intent
- No obviously irrelevant exercises (e.g. leg exercises for a chest query)

#### 6. Error recovery

| Scenario | Expected behavior |
|----------|-------------------|
| LLM passes invalid exerciseId to `save_workout_plan` | Tool returns `LLM_ERROR: Exercise IDs not found: [X, Y]. Call search_exercises…` → LLM re-searches and resubmits |
| LLM passes invalid exerciseId to `start_training_session` | Same corrective error → LLM self-corrects |
| Embedding service is down (cold start failed) | `ensureCurrentExercise` falls back to ilike search — no crash |

**Validation:** check that the user never sees error messages or exercise IDs in the conversation output.

#### 7. Performance checks

| Metric | Expected | How to measure |
|--------|----------|----------------|
| `search_exercises` latency | < 50ms per call | Log timestamps in `search-exercises-tool` logger |
| Embedding warm-up | < 5s at server start | Log `Embedding model loaded` in `embedding-service` logger |
| Total search calls per plan creation | 3–8 | Count `search_exercises completed` log lines for one conversation |
| Dedup savings per turn | 0–3 calls saved | Log `search_exercises dedup saved calls` |

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **OpenAI API embeddings** (`text-embedding-3-small`) | Better multilingual quality, but adds external API dependency and per-request cost (~$0.02/1M tokens). Can migrate later if local model quality proves insufficient. |
| **Fuzzy search** (`pg_trgm`) | Character-level trigram similarity. Fails on semantic equivalence ("pulldown" vs "lat pulldown") and cannot search by attributes ("compound chest exercise"). Inadequate for the discovery use case. |
| **Keep full catalog in prompt** (current approach) | Works at 59 exercises (~2K tokens). At 500+ exercises, prompt becomes 20K+ tokens — degraded quality, 10× cost increase. Not scalable. |
| **Pre-filtered catalog** (code selects exercises before LLM) | Code must know what the LLM needs before the LLM runs — chicken-and-egg problem. Fails for spontaneous requests ("I want yoga today" when the plan is strength-based). |
| **Batch query parameter** (array of queries in one tool call) | Added complexity in tool schema and result parsing. LLM can achieve the same effect via parallel tool calls — calling `search_exercises` 3–5 times in one response. Each call is independent and executes in parallel. |
| **LLM-powered exercise identification** (no vector search) | LLM guesses the exercise name from memory or prompt context. Unreliable (hallucination risk), expensive (depends on full catalog in context), not scalable. |

---

## References

- ADR-0007: LangGraph Gradual Migration (training tools, subgraph architecture)
- ADR-0011: Training Tool Execution Hardening (tool call ordering, ensureCurrentExercise)
- `apps/server/src/infra/db/schema.ts`: exercises table, exercise_muscle_groups table
- `apps/server/src/domain/training/ports/repository.ports.ts`: IExerciseRepository interface
- `apps/server/src/domain/training/services/training.service.ts`: ensureCurrentExercise (embedding fallback)
- `apps/server/src/infra/ai/graph/tools/search-exercises.tool.ts`: search_exercises LLM tool
- `apps/server/src/infra/ai/graph/dedup-tool-node.ts`: per-turn deduplication
- `apps/server/src/infra/ai/graph/invoke-with-retry.ts`: empty response retry
- pgvector documentation: https://github.com/pgvector/pgvector
- all-MiniLM-L6-v2: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- @huggingface/transformers: https://huggingface.co/docs/transformers.js
