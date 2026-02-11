# Fit Coach — AI Fitness Coach

AI-powered personal fitness coach with conversational interface via Telegram.

## 📚 Documentation

### Start Here
- [Architecture](ARCHITECTURE.md) — System design, tech stack, layering rules
- [API Specification](docs/API_SPEC.md) — REST API contracts
- [Contributing (AI)](docs/CONTRIBUTING_AI.md) — Guide for AI assistants

### Development
- [Database Setup](docs/DB_SETUP.md) — PostgreSQL, migrations, schema
- [Testing Guide](apps/server/TESTING.md) — Unit, Integration, E2E tests
- [Product Vision](docs/PRODUCT_VISION.md) — Features roadmap

### Architecture Decisions
- [ADR-0001: AI System Integration](docs/adr/0001-ai-system-integration.md)
- [ADR-0002: Interface Organization](docs/adr/0002-interface-organization-principles.md)
- [ADR-0003: Config Layer](docs/adr/0003-config-layer-and-main-composition.md)
- [ADR-0004: User Profile Storage](docs/adr/0004-user-profile-and-context-storage.md)
- [ADR-0005: Conversation Context](docs/adr/0005-conversation-context-session.md)

### Domain Specifications
- [User Domain](docs/domain/user.spec.md)
- [Conversation Domain](docs/domain/conversation.spec.md)
- [AI Domain](docs/domain/ai.spec.md)
- [Training Domain](docs/domain/training.spec.md)

### Features
- [FEAT-0006: Registration Data Collection](docs/features/FEAT-0006-registration-data-collection.md) ✅ Implemented
- [FEAT-0009: Conversation Context](docs/features/FEAT-0009-conversation-context.md) ✅ Implemented
- [All Features](docs/features/) — See full list

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Setup database (PostgreSQL via Docker)
docker-compose up -d
cd apps/server && npm run db:migrate

# Configure environment
# Create apps/server/.env with required variables (see docs/DB_SETUP.md)

# Start development server
cd apps/server && npm run dev

# Start Telegram bot (in another terminal)
cd apps/bot && npm run serve-bot
```

## 🏗️ Project Structure

```
fit_coach/
├── apps/
│   ├── server/        # Backend (Fastify, Drizzle ORM, LangChain)
│   └── bot/           # Telegram bot client
├── packages/
│   └── shared/        # Shared types
└── docs/              # Documentation
```

## 🧪 Testing

```bash
cd apps/server

# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests (requires DB)
RUN_DB_TESTS=1 npm run test:integration
```

## 📝 Tech Stack

- **Backend**: Node.js, TypeScript, Fastify
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: LangChain with OpenAI-compatible APIs
- **Testing**: Jest (Unit, Integration, E2E)
- **Architecture**: Layered (app → domain → infra) with DI

## 📖 Documentation System

All documentation follows a strict docs-first workflow:
- **English only** for all docs
- **Unique IDs** for invariants (INV-*), business rules (BR-*), scenarios (S-*), acceptance criteria (AC-*)
- **Single source of truth** — `ARCHITECTURE.md` for architecture, `API_SPEC.md` for API contracts

See [Documentation Guide](docs/DOCUMENTATION_GUIDE.md) for details.

## 🤝 Contributing

For AI assistants: See [CONTRIBUTING_AI.md](docs/CONTRIBUTING_AI.md) for detailed guidelines.

## 📄 License

[Add license information]
