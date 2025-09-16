ADR-0004 User Profile and Context Storage

Context

We need a minimal, evolvable storage model for registration, optional onboarding, changing preferences, and time-series metrics. Requirements: strict invariants for registration data, fast reads for chat, minimal number of tables now, flexible growth later, and clear separation of immutable vs. change-tracked data. Vector search may be added later for semantic preferences matching.

Decision

- Keep users thin; move registration data into a 1:1 profile; keep onboarding/preferences in a 1:1 JSONB context; track measurements in a 1:N metrics table; use a separate embeddings table only when needed.

Schema (minimum)
- users
  - id (pk), provider, provider_user_id, language_code
  - profile_status in ('registration','onboarding','active') default 'registration'
- user_profile (1:1 → users.id)
  - sex, date_of_birth, height_cm, weight_kg, fitness_level, goal, training_location
  - health_restrictions text[], equipment_present text[]
  - availability jsonb
- user_context (1:1 → users.id)
  - context jsonb (coachSettings, preferences, healthNotes[], schedule, nutrition, equipmentExtra, notes)
- user_metrics (1:N → users.id) [optional at start]
  - measured_at timestamptz, weight_kg?, circumferences?, body_fat?, resting_hr?, bp?
- user_context_embedding (1:N → users.id) [optional]
  - kind text, embedding vector(dim), source_path text, segment_id?, source_hash text

Invariants and rules
- registration fields live in user_profile; activation depends on a complete profile and explicit confirmation (confirmation is derived).
- Extract and persist only while profile_status='registration' or in explicit edit; normal chat otherwise.
- Store normalized enums and metric units; accept inputs in any language/units.
- Measurements are append-only in user_metrics and update the snapshot weight in user_profile.

Why this design
- Clarity: profile_status and registration phase have strict invariants separate from fluid onboarding data.
- Simplicity: minimal tables for MVP; JSONB for flexible onboarding/preferences without frequent migrations.
- Performance: fast reads from users + user_profile; opt-in joins for context.
- Evolution: easy to promote hot JSONB keys to columns/tables; optional vector search without impacting core schema.

Consequences
- Application must validate JSONB shape (Zod/TypeScript) and enforce enum/unit normalization.
- Add targeted indexes: GIN on user_context, GIN on user_profile.equipment_present, and path-specific indexes as needed.
- For vector search, maintain embeddings via deterministic projections and update on relevant context changes.

Migration plan (concise)
1) Add user_profile and user_context; set users.profile_status default to 'registration'.
2) Backfill registration data where available; set profile_status accordingly.
3) Update services to read/write registration data via user_profile; onboarding writes to user_context.
4) Add user_metrics when regular measurements appear; update write-path to dual-write snapshot + metrics.
5) Optionally add user_context_embedding with pgvector for ANN use cases.

Testing plan (concise)
- Registration: assert registration completeness gates confirmation and status transitions.
- Context: write/read JSONB sections; ensure no API drift (chat returns content+timestamp only).
- Metrics: insert new measurement updates profile snapshot; history remains append-only.
- Indexes: add integration tests for basic filters (equipment available/unavailable) and performance sanity.

References
- docs/features/FEAT-0006-registration-flow.md:1
- docs/features/FEAT-0007-registration-quick-setup.md:1
- docs/domain/user.spec.md:1
- README.md:1320, 1360, 1547
