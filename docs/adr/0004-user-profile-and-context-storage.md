# ADR-0004: User Profile and Context Storage

**Status**: Partially Implemented (MVP with simplified schema)
**Decision Date**: 2024-03-20 (Updated: 2025-01-15)

## Context

We need a minimal, evolvable storage model for registration, optional onboarding, changing preferences, and time-series metrics. Requirements:
- Strict invariants for registration data
- Fast reads for chat
- Minimal number of tables now
- Flexible growth later
- Clear separation of immutable vs. change-tracked data
- Vector search may be added later for semantic preferences matching

## Decision

### Current Implementation (MVP - Simplified Schema)

**Rationale for simplification**: Start with minimal complexity, validate product-market fit, defer normalization until usage patterns are clear.

#### Schema (As Implemented)

##### users
Main user table with embedded profile data:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Provider authentication
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT DEFAULT 'en',

  -- Profile data (embedded for MVP)
  gender TEXT,                    -- 'male' | 'female'
  age INTEGER,                    -- years
  height INTEGER,                 -- cm
  weight INTEGER,                 -- kg
  fitness_level TEXT,             -- 'beginner' | 'intermediate' | 'advanced'
  fitness_goal TEXT,

  -- Status tracking
  profile_status TEXT DEFAULT 'registration',  -- 'registration' | 'complete'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

##### user_accounts
Provider-based authentication linkage (1:N → users):
```sql
CREATE TABLE user_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,         -- 'telegram', 'google', etc.
  provider_user_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);
```

##### conversation_turns
Conversation history for all phases (see ADR-0005):
```sql
CREATE TABLE conversation_turns (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,            -- 'registration' | 'chat' | 'training' | 'planning'
  role TEXT NOT NULL,             -- 'user' | 'assistant' | 'system' | 'summary'
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_user_phase_created (user_id, phase, created_at)
);
```

#### Current Invariants and Rules

- **Registration fields** live directly in `users` table (6 fields: age, gender, height, weight, fitnessLevel, fitnessGoal)
- **Status model**: Simple two-state (`'registration'` | `'complete'`)
- **Extraction rules**: Extract and persist only while `profile_status='registration'` or in explicit edit; normal chat otherwise
- **Normalization**: Store normalized enums and metric units; accept inputs in any language/units
- **Confirmation**: Derived (not stored); completeness check: all 6 fields present + explicit user confirmation

#### Why This Design (MVP)

**Advantages**:
- ✅ **Simplicity**: Single table for profile data, no joins for reads
- ✅ **Fast iteration**: Schema changes via Drizzle migrations, no complex data migrations
- ✅ **Sufficient for MVP**: Covers core registration flow with 6 essential fields
- ✅ **Low latency**: No 1:1 joins on hot path (chat reads)

**Trade-offs**:
- ⚠️ **No separation**: Registration data mixed with user metadata in same table
- ⚠️ **No optional context**: No flexible storage for onboarding preferences
- ⚠️ **No time-series**: Weight changes overwrite previous value
- ⚠️ **No semantic search**: No embeddings for preference matching

---

## Future Evolution (Planned - Extended Schema)

**When to migrate**: When we add onboarding phase, measurement tracking, or semantic preference matching.

### Extended Schema (Target Design)

#### users (thin)
Core identity and status only:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  provider TEXT,                  -- Deprecated: use user_accounts
  provider_user_id TEXT,          -- Deprecated: use user_accounts
  language_code TEXT DEFAULT 'en',
  profile_status TEXT DEFAULT 'registration',  -- 'registration' | 'onboarding' | 'planning' | 'active'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### user_profile (1:1 → users.id)
Structured registration data:
```sql
CREATE TABLE user_profile (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Demographics
  sex TEXT NOT NULL,              -- 'male' | 'female'
  date_of_birth DATE NOT NULL,

  -- Physical metrics (snapshot)
  height_cm INTEGER NOT NULL,
  weight_kg INTEGER NOT NULL,

  -- Fitness profile
  fitness_level TEXT NOT NULL,    -- 'beginner' | 'intermediate' | 'advanced'
  goal TEXT NOT NULL,

  -- Training context
  training_location TEXT,         -- 'home' | 'gym' | 'outdoor'
  health_restrictions TEXT[],     -- Array of restriction strings
  equipment_present TEXT[],       -- Array of available equipment
  availability JSONB,             -- Flexible schedule representation

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_profile_equipment ON user_profile USING GIN(equipment_present);
```

#### user_context (1:1 → users.id)
Flexible onboarding and preferences (JSONB):
```sql
CREATE TABLE user_context (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  context JSONB NOT NULL DEFAULT '{}',
  -- JSONB structure:
  -- {
  --   coachSettings: { tone, verbosity, motivation_style },
  --   preferences: { workout_duration, preferred_exercises },
  --   healthNotes: ["note1", "note2"],
  --   schedule: { weekly_pattern },
  --   nutrition: { diet_type, restrictions },
  --   equipmentExtra: { available: [], unavailable: [] },
  --   notes: "free-form user notes"
  -- }
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_context_gin ON user_context USING GIN(context);
```

#### user_metrics (1:N → users.id)
Time-series measurements (append-only):
```sql
CREATE TABLE user_metrics (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,

  -- Measurements (nullable, partial updates allowed)
  weight_kg DECIMAL(5,2),
  circumferences JSONB,           -- { chest, waist, hips, thigh, arm }
  body_fat_percentage DECIMAL(4,2),
  resting_heart_rate INTEGER,
  blood_pressure JSONB,           -- { systolic, diastolic }

  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_user_metrics_user_measured (user_id, measured_at DESC)
);
```

#### user_context_embedding (1:N → users.id) - Optional
Semantic search via pgvector:
```sql
CREATE TABLE user_context_embedding (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,             -- 'preferences' | 'goals' | 'restrictions'
  embedding VECTOR(1536),         -- OpenAI ada-002 or similar
  source_path TEXT,               -- JSONB path reference
  segment_id TEXT,                -- Optional chunk identifier
  source_hash TEXT NOT NULL,      -- Detect stale embeddings
  created_at TIMESTAMP DEFAULT NOW(),

  INDEX idx_embedding_kind ON user_context_embedding(user_id, kind),
  INDEX idx_embedding_vector ON user_context_embedding USING ivfflat(embedding vector_cosine_ops)
);
```

### Extended Invariants and Rules

- **Registration fields** live in `user_profile`; activation depends on complete profile + explicit confirmation (confirmation is derived)
- **Extract and persist** only while `profile_status='registration'` or in explicit edit; normal chat otherwise
- **Status model**: Multi-phase (`'registration'` → `'onboarding'` → `'planning'` → `'active'`)
- **Normalization**: Store normalized enums and metric units; accept inputs in any language/units
- **Measurements**: Append-only in `user_metrics`; snapshot weight in `user_profile` updated on new measurements
- **JSONB validation**: Application enforces shape via Zod/TypeScript schemas

### Why Extended Design

**Advantages**:
- ✅ **Clarity**: `profile_status` and registration phase have strict invariants separate from fluid onboarding data
- ✅ **Simplicity**: Minimal tables for core data; JSONB for flexible onboarding/preferences without frequent migrations
- ✅ **Performance**: Fast reads from `users` + `user_profile`; opt-in joins for `user_context`
- ✅ **Evolution**: Easy to promote hot JSONB keys to columns/tables; optional vector search without impacting core schema
- ✅ **Time-series**: Clean separation of snapshot (profile) vs. history (metrics)
- ✅ **Semantic search**: Embeddings enable personalized recommendations and preference matching

**Complexity costs**:
- ⚠️ **More tables**: 3 additional tables vs. MVP
- ⚠️ **Joins required**: Profile reads require `users` + `user_profile` join
- ⚠️ **JSONB maintenance**: Must validate context shape in application layer
- ⚠️ **Embedding sync**: Keep embeddings updated on context changes

---

## Migration Plan (MVP → Extended)

### When to Migrate
Trigger points for migration:
1. **Onboarding phase** is added (FEAT-0007 expanded)
2. **Measurement tracking** is needed (user wants to log progress)
3. **Semantic preferences** required (AI coach personalization)
4. **Performance degradation** from `users` table size (unlikely until 100K+ users)

### Migration Steps

#### Phase 1: Add user_profile (Non-breaking)
1. Create `user_profile` table
2. Backfill from `users` (copy gender → sex, age → calculate date_of_birth, etc.)
3. Update services to **dual-write** (write to both `users` and `user_profile`)
4. Validate consistency for 1-2 weeks
5. Switch reads to `user_profile`
6. Drop profile columns from `users`

#### Phase 2: Add user_context (Additive)
1. Create `user_context` table
2. Update `RegistrationService` to write onboarding data to `user_context.context` JSONB
3. No backfill needed (starts empty)
4. Add GIN index on `context` for JSONB queries

#### Phase 3: Add user_metrics (Additive)
1. Create `user_metrics` table
2. Update weight change flow to:
   - Append new row to `user_metrics`
   - Update snapshot in `user_profile.weight_kg`
3. Add index on `(user_id, measured_at DESC)` for recent reads

#### Phase 4: Add user_context_embedding (Optional)
1. Add pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;`
2. Create `user_context_embedding` table
3. Implement embedding generation pipeline (background job or trigger)
4. Add ivfflat index for ANN search
5. Integrate with recommendation/matching features

### Testing Plan

#### Current MVP Tests
- ✅ Registration: assert registration completeness gates confirmation and status transitions
- ✅ Chat: `/api/chat` returns `{data: {content, timestamp}}` (no API drift)
- ✅ Status transitions: `'registration'` → `'complete'` on confirmation

#### Extended Schema Tests
- [ ] Registration: assert completeness from `user_profile` fields only
- [ ] Context: write/read JSONB sections in `user_context`; ensure no API drift
- [ ] Metrics: insert new measurement updates `user_profile` snapshot; history remains append-only
- [ ] Indexes: integration tests for equipment filters (available/unavailable) and performance
- [ ] Embeddings: verify embedding updates on context changes; ANN search returns relevant results

---

## Consequences

### Current MVP

**Positive**:
- ✅ Minimal complexity enables fast iteration
- ✅ Single-table reads are fast
- ✅ Drizzle migrations handle schema evolution smoothly
- ✅ Sufficient for validating core registration flow

**Negative**:
- ⚠️ No onboarding flexibility (JSONB context)
- ⚠️ No measurement history tracking
- ⚠️ Weight changes overwrite (no time-series)
- ⚠️ No semantic search capabilities

### Future Extended Schema

**Positive**:
- ✅ Clear separation of concerns (identity, profile, context, metrics)
- ✅ Flexible JSONB for onboarding without schema churn
- ✅ Time-series metrics enable progress tracking
- ✅ Vector embeddings unlock personalization and recommendations
- ✅ Gradual migration path from MVP

**Negative**:
- ⚠️ More tables increase cognitive load
- ⚠️ Joins add latency (mitigated by caching)
- ⚠️ JSONB requires application-layer validation
- ⚠️ Embedding sync adds operational complexity

---

## References

### Current Implementation
- `apps/server/src/infra/db/schema.ts` - Drizzle schema definitions
- `docs/DB_SETUP.md` - Database setup and current schema
- `docs/features/FEAT-0006-registration-data-collection.md` - Registration flow
- `docs/domain/user.spec.md` - User domain rules

### Related ADRs
- ADR-0005: Conversation context with sliding window
- ADR-0001: AI system integration via LangChain

### Future Feature References
- `docs/features/FEAT-0007-registration-quick-setup.md` - Onboarding plans
- `docs/features/FEAT-0008-training-plan-generation.md` - Workout planning (requires extended schema)

---

## Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| `users` table (thin) | ✅ Implemented | Contains embedded profile data (MVP) |
| `user_accounts` table | ✅ Implemented | Provider authentication |
| `conversation_turns` table | ✅ Implemented | See ADR-0005 |
| `user_profile` table | 🔄 Planned | Future: Extract profile from users |
| `user_context` table | 🔄 Planned | Future: Onboarding + preferences |
| `user_metrics` table | 🔄 Planned | Future: Time-series measurements |
| `user_context_embedding` | 🔄 Planned | Future: Semantic search |

**Current approach**: Simplified schema validates MVP, extended schema ready for future phases.
