# FEAT-0006 Registration Conversation Flow (Diagram)

x-status: Proposed

Scope (authoritative, compact)
- Status model: `registration` → `onboarding` → `planning` (plan creation happens in a separate feature) → `active`.
- Registration fields (required to leave registration): goal, sex, dateOfBirth, height, weight, fitnessLevel, healthRestrictions, trainingLocation, equipmentPresent, availability.
- Confirmation is derived (not stored): show full summary and require explicit confirmation before switching to `onboarding`.
- Onboarding captures extended context; once optional questions are completed or explicitly skipped, set profileStatus='planning' and hand off to the plan feature.
- Extraction only while `registration` or explicit edit session is active; otherwise normal chat.
- Continue capturing missing context silently even during planning/active conversations when new information appears.
- API unchanged: client always receives `{ data: { content, timestamp } }`.

```mermaid
flowchart TD
  %% Entry
  A[Incoming message] --> B{Valid API key?}
  B -- No --> B1[401/403]
  B -- Yes --> C{User exists?}
  C -- No --> C1[404 User not found]
  C -- Yes --> L{Explicit language change?}

  L -- Yes --> L1[Update user.languageCode] --> R
  L -- No --> M{Detected language ≠ languageCode?}
  M -- Yes --> M1[Ask switch confirmation 'Switch to lang?'] --> R
  M -- No --> R[Proceed]

  R --> S{profileStatus === 'planning'?}
  S -- Yes --> N[Planning stage (handled separately)]
  S -- No --> P[Parse message LLM ProfileParser]

  P --> Q{Ambiguous/unknown units?}
  Q -- Yes --> Q1[Ask short clarification] --> P
  Q -- No --> U[Persist captured registration fields: goal, sex, dateOfBirth, height, weight, fitnessLevel, healthRestrictions, trainingLocation, equipmentPresent, availability]

  U --> T{All registration fields present?}
  T -- No --> T1[Ask only missing fields] --> Z[Helpful response]
  T -- Yes --> V[Show full profile summary Ask for confirmation] --> W{Confirm?}
  W -- Yes --> W1[Set profileStatus='onboarding'] --> O[Onboarding optional extended questions]
  O --> Y{Completed or skip?}
  Y -- Yes --> A1[Set profileStatus='planning']
  Y -- No  --> O
  W -- Edit --> W2[Go back to collect/clarify] --> P
  W -- No/unclear --> V

  %% Durability
  classDef note fill:#f7f7f7,stroke:#bbb,color:#333;
  D[(Persistence note: Data is saved incrementally resumes after restart)]:::note
  D -.-> U
```

Legend
- Ask only missing fields.
- One concise clarification on ambiguity; persist after clarity.
- Last write wins during registration.
- Show full summary → explicit confirmation → switch to `onboarding`; after completion or explicit skip → set `planning` (separate feature drives activation).
- Extract only in `registration` or explicit edit; normal chat otherwise.
- Language: explicit switch on request; propose switch on detected mismatch.

References
- Domain rules: `docs/domain/user.spec.md:1`.
- Scenarios: `docs/features/FEAT-0006-registration-conversation-improvements.md:1`, `docs/features/FEAT-0007-registration-quick-setup.md:1`.
