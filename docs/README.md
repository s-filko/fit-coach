# Docs Index

This repository follows a strict docs‑first workflow. Start here to navigate documentation types and their responsibilities.

## Core Documentation

- **API Spec**: `docs/API_SPEC.md` - Canonical API contracts and endpoints
- **Architecture**: `docs/ARCHITECTURE.md` - Single source of truth for system architecture
- **Database Setup**: `docs/DB_SETUP.md` - PostgreSQL setup and schema documentation
- **Product Vision**: `docs/PRODUCT_VISION.md` - Product narrative (no technical details)
- **TODOs**: `docs/TODO.md` - Current tasks and completed work

## Technical References

- **ADRs**: `docs/adr/` - Architecture Decision Records
  - ADR-0001: AI system integration via LangChain
  - ADR-0002: Interface organization by functional areas
  - ADR-0003: Config layer with Zod validation
  - ADR-0004: User profile and context storage model
  - ADR-0005: Conversation context with sliding window
- **Domain Specs**: `docs/domain/` - Domain rules and invariants
  - `user.spec.md` - User domain rules
  - `ai.spec.md` - AI/LLM domain rules
  - `conversation.spec.md` - Conversation context rules ✨ NEW
  - `training.spec.md` - Training domain rules (planned)

## Feature Documentation

- **Feature Specs**: `docs/features/` - Detailed feature specifications
  - **FEAT-0001**: User upsert
  - **FEAT-0002**: User retrieval
  - **FEAT-0003**: AI Chat (updated with conversation context) ✨ UPDATED
  - **FEAT-0006**: Registration data collection (unified JSON mode) ✨ UPDATED
  - **FEAT-0007**: Registration quick setup
  - **FEAT-0008**: Training plan generation (planned)
  - **FEAT-0009**: Conversation context architecture

## Implementation Guides

- **Conversation Context**: `docs/CONVERSATION_CONTEXT_ARCHITECTURE.md` - Implementation details
- **Plan Creation Phase**: `docs/PLAN_CREATION_PHASE.md` - Workout plan creation flow ✨ NEW
- **MVP Training Session**: `docs/MVP_TRAINING_SESSION_MANAGEMENT.md` - Original MVP plan
- **Implementation Plan**: `docs/IMPLEMENTATION_PLAN.md` - Step-by-step progress tracking
- **Testing Rules**: `docs/TESTING.md` (→ `apps/server/TESTING.md`)
- **Contribution Guide for AI**: `docs/CONTRIBUTING_AI.md`
- **Documentation Guide**: `docs/DOCUMENTATION_GUIDE.md`

## Templates

- **Templates**: `docs/templates/` - Document templates for new features

## AI Reading Order

For AI assistants working on this codebase:
1. **Feature Spec** (`docs/features/FEAT-*.md`) - What needs to be built
2. **Domain Spec** (`docs/domain/*.spec.md`) - Business rules and invariants
3. **API Spec** (`docs/API_SPEC.md`) - External contracts
4. **Architecture** (`docs/ARCHITECTURE.md`) - System design and structure
5. **ADRs** (`docs/adr/*.md`) - Design decisions and rationale

## Recent Updates

### 2026-02-13
- ✅ **Plan Creation Phase**: New conversation phase for creating long-term workout plans
- ✅ **Workout Plan Schema**: Structured plan with templates, recovery rules, and progression
- ✅ **Exercise Catalog Integration**: LLM uses real exercises from database
- ✅ **Phase Transition Validation**: Enforces plan existence before session planning
- ✅ **Registration Flow Update**: Now transitions to plan_creation instead of session_planning

### 2025-01
- ✅ **Unified Registration**: Single LLM call with JSON mode (FEAT-0006)
- ✅ **Conversation Context**: Persistent dialogue history with sliding window (FEAT-0009)
- ✅ **Phase-based Routing**: Automatic service selection in chat endpoint (FEAT-0003)
- ✅ **LLM Integration**: OpenAI-compatible API abstraction with debug support
- ✅ **Fastify Migration**: Complete migration from Express to Fastify
- ✅ **Database Schema**: Added conversation_turns table for context storage
- ✅ **Debug Endpoints**: Development tools for monitoring LLM requests

## Quick Links

- [Getting Started](../README.md)
- [Database Setup](DB_SETUP.md)
- [API Documentation](API_SPEC.md)
- [Architecture Overview](ARCHITECTURE.md)
- [Current TODOs](TODO.md)
