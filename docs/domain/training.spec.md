Domain: Training

Terms
	• TrainingContext: container for a user's active plan

Invariants
	• INV-TRAINING-001: A user can have only one active TrainingContext

Business Rules
	• BR-TRAINING-001: Creating a new active context archives the previous one

Ports
	• TrainingContextService (TRAINING_CONTEXT_SERVICE_TOKEN)
	• getContext(userId): TrainingContext | null [BR-TRAINING-001]
	• createContext(userId, data): TrainingContext [BR-TRAINING-001]
	• updateContext(id, data): TrainingContext | null
	• deleteContext(id): boolean

Rules:
- One file per domain (≤ 50 lines).
- Matches apps/server/src/domain/training/ports.ts.
