# FEAT-0006 Registration Conversation Flow (Diagram)

This diagram visualizes the conversational registration flow, reflecting FEAT-0006 scenarios and Domain rules.
Principle: steps are UX segmentation only; backend continuously extracts missing fields while profileStatus='collecting' (or in explicit edit), and adapts the next prompt based on gaps. Confirmation is a derived phase (not a stored status): when all required fields are present, show summary and request confirmation; upon positive confirmation set profileStatus='complete'.

```mermaid
flowchart TD
  %% Entry
  A[Incoming message\nPOST /api/chat] --> B{Valid API key?}
  B -- No --> B1[401/403]
  B -- Yes --> C{User exists?}
  C -- No --> C1[404 User not found]
  C -- Yes --> L{Explicit language change?}

  L -- Yes --> L1[Update user.languageCode\n(BR-USER-006)] --> R
  L -- No --> M{Detected language ≠ languageCode?}
  M -- Yes --> M1[Ask switch confirmation\n("Switch to <lang>?"\nBR-UX-001)] --> R
  M -- No --> R[Proceed]

  R --> S{profileStatus === 'complete'?}
  S -- Yes --> N[Normal chat\nLLMService.generateResponse\nregistrationComplete=true]
  S -- No --> P[Parse message\n(LLM, ProfileParser)\nBR-AI-003]

  P --> Q{Ambiguous/unknown units?}
  Q -- Yes --> Q1[Ask short clarification\nBR-USER-009, BR-AI-005] --> P
  Q -- No --> U[Persist captured fields\n(age, gender, height, weight,\n fitnessLevel, fitnessGoal)\nBR-USER-008, BR-USER-012]

  U --> T{All required fields present?\n(age, gender, height, weight,\n fitnessLevel, fitnessGoal)}
  T -- No --> T1[Ask only missing fields\nDo not re-ask captured\nBR-USER-005, BR-USER-008]\n --> Z[Helpful response\nregistrationComplete=false]
  T -- Yes --> V[Show full profile summary\nAsk for confirmation\nBR-USER-011] --> W{Confirm?}
  W -- Yes --> W1[Set profileStatus='complete'\nregistrationComplete=true]
  W -- Edit --> W2[Go back to collect/clarify\n(updated fields override\nBR-USER-012)] --> P
  W -- No/unclear --> V

  %% Post-completion edit
  N --> E{Intent: Edit profile?}
  E -- Yes --> E1[Show current profile\nPropose updates\nBR-USER-013] --> E2{Confirm changes?}
  E2 -- Yes --> E3[Persist changes] --> N
  E2 -- No --> N
  E -- No --> N

  %% Durability
  classDef note fill:#f7f7f7,stroke:#bbb,color:#333;
  D[(Persistence note:\nData is saved incrementally;\nresumes after restart\nBR-USER-010)]:::note
  D -.-> U
```

Legend
- Only missing fields are requested (BR-USER-005/008).
- Ambiguous inputs trigger a single clarification (BR-USER-009, BR-AI-005).
- Latest user-provided value overrides prior ones during registration (BR-USER-012).
- Completion requires explicit confirmation of a full summary (BR-USER-011).
- Collection runs only while profile is incomplete or an explicit edit session is active (BR-USER-014/015).
- Language: explicit request switches immediately; auto-detected mismatch requires confirmation (BR-USER-006, BR-UX-001).
- Progress is durable across restarts (BR-USER-010).
