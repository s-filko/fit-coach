# ADR 0001: Basic AI Chat Integration (MVP)

## Context

The Fit Coach project requires basic AI chat functionality for MVP. We need to implement AI logic using LangChain with minimal integration into the Fastify/Drizzle architecture.

### Current State
- Architecture follows strict layering: app → domain → infra
- AI integration is provided via an infra `LLMService` behind a domain port
- Dependency injection with tokens is established
- LangChain/OpenAI may be used by the infra `LLMService`

### Requirements (MVP)
- Basic AI chat functionality
- Simple message → response processing (stateless)
- No complex context management
- No embeddings or vector search
- Follow project's architectural constraints

## Decision

### Architecture Integration (Simplified)
1. **LLM Service in Infra Layer**: Provide `infra/ai/llm.service.ts`
   - LangChain integration with OpenAI
   - Basic prompt management
   - Simple response generation

2. **API Layer**: Fastify route in `app/routes/chat.routes.ts`
   - POST `/api/chat`: Send chat messages
   - Simple request/response handling

### Key Design Decisions

#### 1. Layer Separation
- **Infra**: LLM integration only
- **App**: HTTP transport, validation, routing
- **Domain**: No AI logic in MVP

#### 2. Message Processing (Simplified)
1. Message validation
2. Direct LLM call via port
3. Response return

#### 3. No Complex Features
- No session management
- No message history
- No embeddings
- No context building

### Implementation Plan
1. Provide infra LLM service behind a domain port
2. Add chat endpoint `/api/chat` with Zod schemas
3. Add unit/integration tests for route and service

## Consequences

### Positive
- Simple and fast implementation
- Follows architectural principles
- Easy to test and debug
- Foundation for future features

### Negative
- Limited functionality
- No conversation memory
- No personalization

### Risks
- LLM service reliability
- Response quality

## Future Considerations

### Extensibility
- Session management
- Message history
- User context
- Embeddings and vector search

## Implementation Status

### Status
- Implemented (MVP): infra LLM service and `/api/chat` route exist
- Stateless processing; no session/memory in MVP
- Tests present; coverage and performance vary by environment

---

*Status: Implemented (MVP)*
*Decision Date: 2024-03-20*
*Author: AI Assistant*
