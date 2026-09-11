# Docs Index

This repository follows a strict docs‑first workflow. Start here to navigate documentation types and their responsibilities.

## Core Documentation

- **API Spec**: `docs/API_SPEC.md` - Canonical API contracts and endpoints
- **Architecture**: `docs/ARCHITECTURE.md` - Single source of truth for system architecture
- **Database Setup**: `docs/DB_SETUP.md` - PostgreSQL setup and schema documentation
- **Product Vision**: `docs/PRODUCT_VISION.md` - Product narrative (no technical details)
- **Project State**: `docs/STATE.md` - Orientation point: in progress / next / scope (read first)
- **Backlog**: `docs/BACKLOG.md` - Permanent parking lot for unplanned ideas/findings/wishes

## Technical References

- **ADRs**: `docs/adr/` - Architecture Decision Records
  - ADR-0001: AI system integration via LangChain
  - ADR-0002: Interface organization by functional areas
  - ADR-0003: Config layer with Zod validation
  - ADR-0004: User profile and context storage model
  - ADR-0005: Conversation context with sliding window
  - ADR-0007 … ADR-0012: see `docs/adr/`
  - ADR-0013: LLM core target architecture (graph/state/memory/prompts/errors) — **start here for the LLM stack**
- **LLM Core Refactor Plan**: `docs/LLM_CORE_REFACTOR_PLAN.md` - Phased path from current code to ADR-0013 (P0–P7, acceptance criteria, rollback)
- **Prompt Eval Framework**: `docs/PROMPT_EVAL_FRAMEWORK.md` - Datasets, rubrics, LLM-as-judge, CI gates, promptVersion traceability
- **Domain Specs**: `docs/domain/` - Domain rules and invariants
  - `user.spec.md` - User domain rules
  - `ai.spec.md` - AI/LLM domain rules
  - `conversation.spec.md` - Conversation context rules
  - `training.spec.md` - Training domain rules (planned)

## Feature Documentation

- **Feature Specs**: `docs/features/` - Detailed feature specifications
  - **FEAT-0001**: User upsert
  - **FEAT-0002**: User retrieval
  - **FEAT-0003**: AI Chat (updated with conversation context)
  - **FEAT-0006**: Registration data collection (unified JSON mode)
  - **FEAT-0007**: Registration quick setup
  - **FEAT-0008**: Training plan generation (planned)
  - **FEAT-0009**: Conversation context architecture

## Implementation Guides

- **Conversation Context**: `docs/CONVERSATION_CONTEXT_ARCHITECTURE.md` - Implementation details
- **MVP Training Session**: `docs/MVP_TRAINING_SESSION_MANAGEMENT.md` - Original MVP plan
- **Manual Test Plan**: `docs/MANUAL_TEST_PLAN.md` - Scenario source for eval datasets
- **Testing Rules**: `docs/TESTING.md` (→ `apps/server/TESTING.md`)
- **Contribution Guide for AI**: `docs/CONTRIBUTING_AI.md`
- **Documentation Guide**: `docs/DOCUMENTATION_GUIDE.md`
- **Superpowers Integration**: `docs/SUPERPOWERS_INTEGRATION.md` - SDD contract: status layer, task lifecycle, backlog

## Templates

- **Templates**: `docs/templates/` - Document templates for new features

## AI Reading Order

For AI assistants working on this codebase:
1. **Project State** (`docs/STATE.md`) - Where the project is right now; read first
2. **Feature Spec** (`docs/features/FEAT-*.md`) - What needs to be built
3. **Domain Spec** (`docs/domain/*.spec.md`) - Business rules and invariants
4. **API Spec** (`docs/API_SPEC.md`) - External contracts
5. **Architecture** (`docs/ARCHITECTURE.md`) - System design and structure
6. **ADRs** (`docs/adr/*.md`) - Design decisions and rationale

## Quick Links

- [Getting Started](../README.md)
- [Database Setup](DB_SETUP.md)
- [API Documentation](API_SPEC.md)
- [Architecture Overview](ARCHITECTURE.md)
- [Project State](STATE.md)
- [Backlog](BACKLOG.md)
