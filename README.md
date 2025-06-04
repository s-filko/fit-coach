Fit Coach

⸻

1. Project Goal

Fit Coach is a fitness app with an AI coach. The user keeps a journal, receives personalized plans and recommendations, and engages in a personal dialogue with the AI coach, which takes into account their habits, limitations, and communication style.

⸻

2. Core Stack and Architecture
   •	Backend: Node.js, Express, TypeScript
   •	ORM: Drizzle ORM + drizzle-kit (migrations)
   •	Database: PostgreSQL (with pgvector extension for embeddings)
   •	AI Orchestrator: Built on LangChain (langchain npm package). All chains, memory handling, embeddings, prompting, and LLM integration are implemented through it.
   •	AI Layer:
   •	server/ai/orchestrator.ts — LangChain-based orchestrator logic (memory, tool calling, embeddings, etc.)
   •	server/ai/llm.service.ts — LLM provider integration (OpenAI, others)
   •	Monorepo: Not used
   •	Bot and Server: Completely independent; each has its own package.json, node_modules, launch process, and no shared dependencies
   •	Bot: node-telegram-bot-api, a separate application with no access to the database or server code
   •	Communication: Only via REST API
   •	API only: No UI; only a Telegram bot (other messengers/clients will use the same API in the future)

⸻

3. Architecture and Modules

Backend (server) structure:

server/
ai/
orchestrator.ts         // AI orchestrator using LangChain
llm.service.ts          // LLM integration
db/
schema.ts               // Drizzle schema
db.ts                   // Database connection
services/
ai.service.ts           // AI logic and orchestration service
userAccount.service.ts  // Account linking logic
user.service.ts         // User profile logic
src/
api/
message.ts            // /api/message routing
user.ts               // /api/user routing
index.ts                // Express entry-point
package.json

Bot structure:

bot/
index.ts
handlers.ts
package.json

⸻

4. Key Entities and Database
   •	users — main user profile (id, gender, age, units, goals, communication style, etc.)
   •	user_metrics — user metrics with timestamp (weight, measurements, height, etc.), always in SI units (kg, cm)
   •	user_accounts — user-to-provider link (Telegram, etc.).
   Composite unique key: (provider, providerUserId).
   Username is stored, but not firstName/lastName.
   •	exercises — exercises (name, category, description, technique, is_global, embedding)
   •	workouts, workout_exercises — workouts and many-to-many exercises
   •	exercise_logs — logs per exercise (date, sets, reps, weight, comments)
   •	ai_sessions — AI session logs (userId, sessionType, startedAt, endedAt, embedding, summary)
   •	coach_settings — AI coach behavior settings (tone, encouragement, rules)
   •	user_memories — “memory” (embedding + text) for personalized recommendations

⸻

5. Interaction and Services
   •	The bot only sends and receives data via HTTP API. It has no logic, database, or shared types with the server.
   •	The server implements:
   •	User registration/update (POST /api/user, via userAccountService)
   •	Message processing and AI logic invocation (POST /api/message, via ai.service + orchestrator)
   •	Other services follow single responsibility (e.g., user.service for profile, userAccount.service for external accounts)
   •	All AI context and memory handled via LangChain (orchestrator.ts)

⸻

6. Best Practices and Rules
   •	All business logic, embedding handling, analysis, memory, and intelligence reside solely on the server
   •	AI orchestrator — only through LangChain (orchestrator.ts). No manual logic or direct LLM calls
   •	All metric data must be in SI units (kg, cm); conversion only on the client side
   •	No importing code/types/node_modules between bot and server
   •	Changes only after review/approval
   •	All code comments must be in English only
   •	Each endpoint must follow the responsibility principle (e.g., user, message, etc.)

⸻

7. Key Scenarios
   •	Registration:
    1.	The bot receives the first message (e.g., /start)
    2.	The bot sends POST /api/user with: provider, providerUserId, username, languageCode
    3.	The server calls userAccountService.upsertUserAccount(provider, providerUserId, { … })
    4.	If account doesn’t exist — it’s created; otherwise — updated
    5.	The bot uses only the userId returned from the server
          •	AI Dialogue:
    1.	POST /api/message — all user messages go here
    2.	Server finds/creates user, session, logs it, calls orchestrator (LangChain)
    3.	The response is sent back to the bot and forwarded to the user

⸻

8. Scaling Principles
   •	New clients (messengers, UI) are separate apps using the same API
   •	The server remains unchanged; the API only extends
   •	All AI interaction logic — strictly through orchestrator.ts (LangChain)

⸻

9. Strictly Prohibited
   •	Do not import code/types between bot and server
   •	Do not create shared node_modules
   •	Do not give the bot access to the database or server logic
   •	Do not place business logic in the bot

⸻

Summary:
Fit Coach follows a server-centric architecture where all AI intelligence is implemented via the LangChain-based orchestrator. The bot is merely a transport layer. The database has a strict format, with agreed rules for storage, units, and processing. All changes are subject to approval.