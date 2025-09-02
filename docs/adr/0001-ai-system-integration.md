# ADR 0001: Basic AI Chat Integration (MVP)

## Context

The Fit Coach project requires basic AI chat functionality for MVP. The legacy system (server_legacy) already contains AI logic using LangChain, but we need a minimal integration into the new Fastify/Drizzle architecture.

### Current State
- Legacy system has AI services: LLMService, AIContextService
- New architecture follows strict layering: app → domain → infra
- Dependency injection with string tokens is established
- LangChain is the required framework for AI integration

### Requirements (MVP)
- Basic AI chat functionality
- Simple message processing
- No complex context management
- No embeddings or vector search
- Follow project's architectural constraints

## Decision

### Architecture Integration (Simplified)
1. **LLM Service in Infra Layer**: Create `infra/ai/llm.service.ts`
   - LangChain integration with OpenAI
   - Basic prompt management
   - Simple response generation

2. **API Layer**: Create Fastify route in `app/routes/chat.routes.ts`
   - POST `/api/chat`: Send chat messages
   - Simple request/response handling

### Key Design Decisions

#### 1. Layer Separation
- **Infra**: LLM integration only
- **App**: HTTP transport, validation, routing
- **Domain**: No AI logic in MVP

#### 2. Message Processing (Simplified)
1. Message validation
2. Direct LLM call
3. Response return

#### 3. No Complex Features
- No session management
- No message history
- No embeddings
- No context building

### Implementation Plan

#### Phase 1: Basic Integration
1. Install LangChain dependencies
2. Create simple LLM service
3. Add chat endpoint

#### Phase 2: Testing
1. Basic endpoint tests
2. LLM service tests

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

---

*Status: Accepted*
*Date: 2024-03-20*
*Author: AI Assistant*
