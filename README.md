Fit Coach

⸻

1. Project Goal

Fit Coach is a fitness app with an AI coach. The user keeps a journal, receives personalized plans and recommendations, and engages in a personal dialogue with the AI coach, which takes into account their habits, limitations, and communication style.

⸻

Docs and Contracts

• Architecture (authoritative): ARCHITECTURE.md:1
• API Spec (authoritative): docs/API_SPEC.md:1
• AI Contribution Rules: docs/CONTRIBUTING_AI.md:1

⸻

2. Core Stack and Architecture
   •	Backend: Node.js, Fastify, TypeScript
   •	ORM: Drizzle ORM + drizzle-kit (migrations)
   •	Database: PostgreSQL (with pgvector extension for embeddings)
   •	AI integration: Infra LLM service (LangChain/OpenAI where applicable)
   •	AI Layer:
   •	apps/server/src/infra/ai/llm.service.ts — LLM provider integration (OpenAI, others)
   •	Monorepo: Used (apps/server, packages/shared)
   •	Bot: external client; not part of this repo
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
index.ts                // Server entry-point (Fastify bootstrap)
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
   •	user_memories — "memory" (embedding + text) for personalized recommendations

⸻

5. Interaction and Services
   •	The bot only sends and receives data via HTTP API. It has no logic, database, or shared types with the server.
   •	The server implements:
   •	User registration/update (POST /api/user, via userAccountService)
   •	AI chat handling (POST /api/chat) — stateless message → response
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

   **Database Changes Rule:**
   •	All database schema changes must be performed strictly through Drizzle migrations only
   •	Never apply database changes manually through SQL commands
   •	Always use `drizzle-kit generate` to create migrations and `drizzle-kit migrate` to apply them
   •	This ensures version control, consistency, and prevents accidental data loss

⸻

7. Key Scenarios
   •	Registration:
    1.	The bot receives the first message (e.g., /start)
    2.	The bot sends POST /api/user with: provider, providerUserId, username, languageCode
    3.	The server calls userAccountService.upsertUserAccount(provider, providerUserId, { … })
    4.	If account doesn't exist — it's created; otherwise — updated
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

10. Detailed Server Architecture

10.1 Message Processing Flow
   • Message Reception:
     1. Bot receives message from user
     2. Bot sends POST /api/message with:
        - provider (e.g., "telegram")
        - providerUserId
        - message text
        - message metadata (timestamp, messageId)
     3. Server validates request and extracts user context

   • Context Building:
     1. User identification via userAccountService
     2. Session management:
        - Create new session or retrieve existing
        - Load user preferences and settings
        - Fetch relevant memories and context
     3. Message preprocessing:
        - Language detection
        - Intent classification
        - Context enrichment

   • AI Processing:
     1. Orchestrator initialization:
        - Load user profile and preferences
        - Initialize LangChain memory
        - Set up conversation context
     2. Message processing:
        - Embedding generation
        - Context retrieval
        - Tool selection and execution
        - Response generation
     3. Response post-processing:
        - Format validation
        - Content filtering
        - Response optimization

   • Response Handling:
     1. Response formatting:
        - Structure response according to client needs
        - Add metadata and context
     2. Logging and analytics:
        - Store interaction in ai_sessions
        - Update user metrics
        - Track performance metrics
     3. Response delivery:
        - Send formatted response to bot
        - Handle delivery confirmation

10.2 Error Handling and Recovery
   • Error Categories:
     - User input errors (validation)
     - System errors (database, external services)
     - AI processing errors
     - Network/communication errors

   • Recovery Strategies:
     - Automatic retries for transient errors
     - Fallback responses for AI failures
     - Graceful degradation of features
     - User-friendly error messages

10.3 Performance Optimization
   • Caching Strategy:
     - User context caching
     - Frequently used embeddings
     - Session data
     - Common responses

   • Resource Management:
     - Connection pooling
     - Memory usage optimization
     - Batch processing where applicable
     - Async operations

10.4 Security Measures
   • Authentication:
     - Provider-specific authentication
     - Token validation
     - Rate limiting
     - Request signing

   • Data Protection:
     - Input sanitization
     - Output encoding
     - PII handling
     - Secure storage

10.5 Monitoring and Logging
   • Metrics Collection:
     - Response times
     - Error rates
     - Resource usage
     - User engagement

   • Logging Strategy:
     - Structured logging
     - Error tracking
     - Audit trails
     - Performance monitoring

⸻

11. API Endpoints Specification (authoritative: docs/API_SPEC.md)

11.1 Message Endpoint (/api/message)
   POST /api/message
   Request:
   {
     "provider": string,
     "providerUserId": string,
     "message": {
       "text": string,
       "timestamp": string,
       "messageId": string
     },
     "metadata": {
       "languageCode": string,
       "sessionId": string
     }
   }
   Response:
   {
     "response": {
       "text": string,
       "type": "text" | "action" | "error",
       "metadata": {
         "sessionId": string,
         "timestamp": string
       }
     },
     "status": "success" | "error",
     "error": {
       "code": string,
       "message": string
     }
   }

11.2 User Endpoint (/api/user)
   POST /api/user
   Request:
   {
     "provider": string,
     "providerUserId": string,
     "username": string,
     "languageCode": string,
     "profile": {
       "gender": string,
       "age": number,
       "goals": string[],
       "preferences": object
     }
   }
   Response:
   {
     "userId": string,
     "status": "created" | "updated",
     "profile": object
   }

⸻

12. Detailed Message Processing Flow and Business Logic

12.1 Message Lifecycle
   • Initial Reception (Bot Layer):
     1. Message arrives at bot
     2. Basic validation and preprocessing
     3. Request formation for server API
     4. Rate limiting check
     5. Request signing and authentication

   • Server Entry Point:
     1. Request validation middleware
     2. Authentication and authorization
     3. Rate limiting enforcement
     4. Request logging and tracing
     5. Context initialization

12.2 Business Logic Processing
   • User Context Building:
     1. User identification and profile loading
        - Fetch user preferences
        - Load communication style
        - Get fitness goals and history
     2. Session management
        - Create/retrieve active session
        - Load conversation history
        - Initialize session metrics
     3. Context enrichment
        - Load relevant memories
        - Fetch recent activities
        - Get current fitness state

   • Message Analysis:
     1. Intent classification
        - Fitness-related query
        - Progress update
        - Goal setting
        - General conversation
     2. Context relevance scoring
        - Historical context importance
        - Current session relevance
        - User preferences alignment
     3. Action determination
        - Response type selection
        - Tool selection
        - Memory update requirements

12.3 AI Processing Pipeline
   • LangChain Orchestration:
     1. Memory Management
        - Short-term memory (current session)
        - Long-term memory (user history)
        - Context window optimization
     2. Tool Selection and Execution
        - Fitness data analysis
        - Progress tracking
        - Recommendation generation
        - Exercise planning
     3. Response Generation
        - Context-aware response creation
        - Tone and style adaptation
        - Personalization application

   • Response Processing:
     1. Content validation
        - Safety checks
        - Relevance verification
        - Accuracy confirmation
     2. Response optimization
        - Length adjustment
        - Clarity improvement
        - Engagement enhancement
     3. Action preparation
        - Follow-up questions
        - Next steps suggestion
        - Progress tracking setup

12.4 Data Management
   • Session Data:
     1. Conversation storage
        - Message history
        - Context snapshots
        - Interaction metadata
     2. Performance metrics
        - Response times
        - User engagement
        - System resource usage

   • User Data Updates:
     1. Profile updates
        - Preference changes
        - Goal modifications
        - Communication style adjustments
     2. Progress tracking
        - Fitness metrics
        - Achievement records
        - Behavioral patterns

12.5 Response Delivery
   • Response Formation:
     1. Structure creation
        - Main response text
        - Supporting actions
        - Metadata inclusion
     2. Format adaptation
        - Client-specific formatting
        - Media preparation
        - Interactive elements

   • Delivery Process:
     1. Response validation
        - Format verification
        - Content safety check
        - Size optimization
     2. Delivery preparation
        - Priority determination
        - Retry strategy
        - Fallback options
     3. Confirmation handling
        - Delivery tracking
        - Error recovery
        - Success logging

12.6 Error Handling and Recovery
   • Error Categories:
     1. User Input Errors
        - Validation failures
        - Format issues
        - Language problems
     2. System Errors
        - Database issues
        - Service unavailability
        - Resource constraints
     3. AI Processing Errors
        - Model failures
        - Context issues
        - Tool execution problems

   • Recovery Strategies:
     1. Immediate Actions
        - Error classification
        - Impact assessment
        - Recovery initiation
     2. Fallback Mechanisms
        - Alternative responses
        - Simplified processing
        - Cached solutions
     3. User Communication
        - Error messaging
        - Recovery status
        - Next steps guidance

12.7 Performance Considerations
   • Optimization Points:
     1. Response Time
        - Parallel processing
        - Caching strategies
        - Resource optimization
     2. Resource Usage
        - Memory management
        - Connection pooling
        - Batch processing
     3. Scalability
        - Load distribution
        - Resource allocation
        - Performance monitoring

   • Monitoring Metrics:
     1. System Health
        - Response times
        - Error rates
        - Resource usage
     2. User Experience
        - Engagement metrics
        - Satisfaction indicators
        - Usage patterns
     3. Business Impact
        - Goal achievement
        - User retention
        - Feature adoption

⸻

12.8 Message Processing Pipeline Details

12.8.1 Pipeline Stages and Data Flow

Stage 1: Message Reception and Validation
   Input:
   {
     "provider": "telegram",
     "providerUserId": "123456789",
     "message": {
       "text": "I did 3 sets of squats today",
       "timestamp": "2024-03-20T10:00:00Z",
       "messageId": "msg_123"
     },
     "metadata": {
       "languageCode": "en",
       "sessionId": "session_456"
     }
   }

   Processing:
   1. Request validation
      - Check required fields
      - Validate data types
      - Verify message format
   2. Authentication
      - Verify provider credentials
      - Check rate limits
      - Validate session
   3. Initial logging
      - Log request details
      - Generate trace ID
      - Record timestamp

   Output:
   {
     "isValid": true,
     "traceId": "trace_789",
     "validationResult": {
       "status": "success",
       "errors": []
     }
   }

Stage 2: Context Building
   Input:
   {
     "traceId": "trace_789",
     "userId": "user_123",
     "message": {
       "text": "I did 3 sets of squats today",
       "timestamp": "2024-03-20T10:00:00Z"
     }
   }

   Processing:
   1. User context loading
      - Fetch user profile
      - Load preferences
      - Get communication style
   2. Session management
      - Create/retrieve session
      - Load conversation history
      - Initialize metrics
   3. Memory retrieval
      - Get relevant memories
      - Load recent activities
      - Fetch fitness state

   Output:
   {
     "userContext": {
       "profile": {
         "goals": ["strength", "endurance"],
         "preferences": {
           "language": "en",
           "tone": "casual"
         }
       },
       "session": {
         "id": "session_456",
         "startTime": "2024-03-20T09:30:00Z",
         "messageCount": 5
       },
       "memories": [
         {
           "type": "recent_activity",
           "content": "Last workout: 2024-03-19",
           "relevance": 0.85
         }
       ]
     }
   }

Stage 3: Message Analysis
   Input:
   {
     "traceId": "trace_789",
     "message": {
       "text": "I did 3 sets of squats today",
       "timestamp": "2024-03-20T10:00:00Z"
     },
     "userContext": {
       // Previous stage output
     }
   }

   Processing:
   1. Intent classification
      - Analyze message content
      - Determine primary intent
      - Identify secondary intents
   2. Entity extraction
      - Extract exercise details
      - Identify metrics
      - Parse time references
   3. Context scoring
      - Calculate relevance scores
      - Determine action priority
      - Identify required tools

   Output:
   {
     "analysis": {
       "primaryIntent": "progress_update",
       "secondaryIntents": ["exercise_log"],
       "entities": {
         "exercise": "squats",
         "sets": 3,
         "timestamp": "2024-03-20T10:00:00Z"
       },
       "requiredActions": [
         "update_exercise_log",
         "generate_progress_insight"
       ]
     }
   }

Stage 4: AI Processing
   Input:
   {
     "traceId": "trace_789",
     "message": {
       "text": "I did 3 sets of squats today",
       "timestamp": "2024-03-20T10:00:00Z"
     },
     "userContext": {
       // Stage 2 output
     },
     "analysis": {
       // Stage 3 output
     }
   }

   Processing:
   1. LangChain initialization
      - Set up memory
      - Configure tools
      - Initialize chains
   2. Context processing
      - Generate embeddings
      - Retrieve relevant context
      - Prepare prompt
   3. Response generation
      - Generate initial response
      - Apply personalization
      - Add follow-up suggestions

   Output:
   {
     "aiResponse": {
       "text": "Great job with the squats! I notice you're maintaining consistency with your leg workouts. Would you like to track the weight you used?",
       "type": "progress_update",
       "actions": [
         {
           "type": "update_exercise_log",
           "data": {
             "exercise": "squats",
             "sets": 3,
             "timestamp": "2024-03-20T10:00:00Z"
           }
         }
       ],
       "followUp": {
         "suggestions": [
           "Track weight used",
           "Add reps per set",
           "Note any difficulty level"
         ]
       }
     }
   }

Stage 5: Response Processing
   Input:
   {
     "traceId": "trace_789",
     "aiResponse": {
       // Stage 4 output
     }
   }

   Processing:
   1. Content validation
      - Check response safety
      - Verify relevance
      - Validate format
   2. Response optimization
      - Adjust length
      - Improve clarity
      - Enhance engagement
   3. Action preparation
      - Format actions
      - Prepare metadata
      - Set up tracking

   Output:
   {
     "processedResponse": {
       "text": "Great job with the squats! I notice you're maintaining consistency with your leg workouts. Would you like to track the weight you used?",
       "type": "progress_update",
       "actions": [
         {
           "type": "update_exercise_log",
           "data": {
             "exercise": "squats",
             "sets": 3,
             "timestamp": "2024-03-20T10:00:00Z"
           }
         }
       ],
       "metadata": {
         "responseTime": "1.2s",
         "confidence": 0.95,
         "requiresFollowUp": true
       }
     }
   }

Stage 6: Delivery and Logging
   Input:
   {
     "traceId": "trace_789",
     "processedResponse": {
       // Stage 5 output
     }
   }

   Processing:
   1. Response formatting
      - Adapt to client format
      - Add delivery metadata
      - Prepare tracking
   2. Action execution
      - Execute database updates
      - Update metrics
      - Store session data
   3. Logging and monitoring
      - Log response details
      - Update analytics
      - Record performance metrics

   Output:
   {
     "delivery": {
       "status": "success",
       "response": {
         "text": "Great job with the squats! I notice you're maintaining consistency with your leg workouts. Would you like to track the weight you used?",
         "type": "progress_update",
         "actions": [
           {
             "type": "update_exercise_log",
             "status": "completed"
           }
         ]
       },
       "metrics": {
         "processingTime": "1.5s",
         "memoryUsage": "45MB",
         "success": true
       }
     }
   }

12.8.2 Pipeline Error Handling

Each stage includes specific error handling:

1. Validation Errors:
   - Invalid message format
   - Missing required fields
   - Authentication failures
   Response: Return 400 with specific error details

2. Context Errors:
   - User not found
   - Session creation failed
   - Memory retrieval issues
   Response: Attempt recovery or return 404/500

3. Analysis Errors:
   - Intent classification failure
   - Entity extraction issues
   Response: Fall back to general conversation

4. AI Processing Errors:
   - Model failures
   - Context issues
   - Tool execution problems
   Response: Use fallback responses

5. Response Processing Errors:
   - Content validation failures
   - Format issues
   Response: Return simplified response

6. Delivery Errors:
   - Action execution failures
   - Logging issues
   Response: Retry or notify admin

⸻

12.8.3 Request Tracing and Monitoring

TraceId Implementation:
   • Purpose:
     - Track request flow through all system components
     - Correlate related operations
     - Debug issues across distributed system
     - Monitor performance and bottlenecks

   • Structure:
     {
       "traceId": "fit_20240320_1234567890_abcdef", // Format: app_date_timestamp_random
       "spanId": "span_123",                        // Sub-operation identifier
       "parentSpanId": "span_122",                  // Parent operation reference
       "timestamp": "2024-03-20T10:00:00Z",        // Operation start time
       "duration": 1500,                            // Operation duration in ms
       "tags": {                                    // Additional metadata
         "userId": "user_123",
         "messageType": "progress_update",
         "provider": "telegram"
       }
     }

   • Usage in Pipeline:
     1. Request Entry:
        - Generated at first contact point
        - Added to all subsequent operations
        - Passed through all middleware

     2. Context Propagation:
        - Included in all service calls
        - Added to database queries
        - Attached to external API calls

     3. Logging Integration:
        - Added to all log entries
        - Used for log correlation
        - Helps in log aggregation

     4. Performance Tracking:
        - Measure operation duration
        - Track resource usage
        - Identify bottlenecks

   • Benefits:
     1. Debugging:
        - Track request flow
        - Identify failure points
        - Correlate related events

     2. Monitoring:
        - Measure response times
        - Track error rates
        - Monitor system health

     3. Analytics:
        - User behavior analysis
        - Performance patterns
        - System usage statistics

   • Implementation Details:
     1. Generation:
        - Created at request entry
        - Unique across all requests
        - Time-based with random component

     2. Storage:
        - In-memory during request
        - Logged for persistence
        - Indexed for quick retrieval

     3. Propagation:
        - HTTP headers
        - Database queries
        - External service calls

     4. Cleanup:
        - Automatic after request completion
        - Archived for analysis
        - Retention policy based on importance

   • Example Flow:
     1. Request received:
        {
          "traceId": "fit_20240320_1234567890_abcdef",
          "spanId": "span_1",
          "operation": "message_received"
        }

     2. Database query:
        {
          "traceId": "fit_20240320_1234567890_abcdef",
          "spanId": "span_2",
          "parentSpanId": "span_1",
          "operation": "user_context_load"
        }

     3. AI processing:
        {
          "traceId": "fit_20240320_1234567890_abcdef",
          "spanId": "span_3",
          "parentSpanId": "span_1",
          "operation": "ai_response_generation"
        }

     4. Response delivery:
        {
          "traceId": "fit_20240320_1234567890_abcdef",
          "spanId": "span_4",
          "parentSpanId": "span_1",
          "operation": "response_delivery"
        }

   • Monitoring Integration:
     1. Metrics:
        - Request duration
        - Operation timing
        - Resource usage

     2. Alerts:
        - Performance thresholds
        - Error rate spikes
        - System bottlenecks

     3. Dashboards:
        - Real-time monitoring
        - Historical analysis
        - Performance trends

⸻

Summary:
Fit Coach follows a server-centric architecture where all AI intelligence is implemented via the LangChain-based orchestrator. The bot is merely a transport layer. The database has a strict format, with agreed rules for storage, units, and processing. All changes are subject to approval.

⸻

13. Database Schema Details

13.1 Users Table
   Purpose: Store core user profile information

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID
     - Used as reference in other tables

   • name: text
     - User's full name
     - Optional field

   • email: text
     - User's email address
     - Unique constraint
     - Optional field

   • gender: text
     - User's gender
     - Optional field

   • height: integer
     - User's height
     - Optional field

   • heightUnit: text
     - Unit for height measurement
     - Optional field

   • weightUnit: text
     - Unit for weight measurement
     - Optional field

   • birthYear: integer
     - User's birth year
     - Optional field

   • fitnessGoal: text
     - User's fitness goal
     - Optional field

   • tone: text
     - Communication tone preference
     - Optional field

   • reminderEnabled: boolean
     - Whether reminders are enabled
     - Default: false

   • firstName: text
     - User's first name
     - Optional field

   • lastName: text
     - User's last name
     - Optional field

   • languageCode: text
     - User's preferred language
     - Optional field

   • createdAt: timestamp
     - When the user was created
     - Default: current timestamp

   • username: text
     - User's username
     - Optional field

13.2 Workouts Table
   Purpose: Store workout plans and sessions

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id

   • name: text
     - Workout name
     - Optional field

   • notes: text
     - Additional workout notes
     - Optional field

   • createdAt: timestamp
     - When the workout was created
     - Default: current timestamp

   • updatedAt: timestamp
     - When the workout was last updated
     - Default: current timestamp

   TODO: Add workout state tracking fields:
   • status: text
     - Track workout lifecycle (planning/in_progress/completed)
     - Values: 'planning', 'in_progress', 'completed'
     - Default: 'planning'
   
   • current_exercise_id: uuid
     - Reference to currently active exercise
     - Foreign key to exercise_logs.id
     - Nullable: true
   
   • started_at: timestamp
     - Record when workout actually started
     - Nullable: true
   
   • completed_at: timestamp
     - Record when workout was completed
     - Nullable: true

13.3 Exercise Logs Table
   Purpose: Track exercise performance and progress

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id

   • exerciseId: uuid
     - Foreign key to exercises table
     - References exercises.id

   • date: timestamp
     - When the exercise was performed
     - Default: current timestamp

   • sets: integer
     - Number of sets performed
     - Optional field

   • reps: integer
     - Number of repetitions per set
     - Optional field

   • weight: real
     - Weight used in the exercise
     - Optional field

   • comment: text
     - Additional notes about the exercise
     - Optional field

   TODO: Add exercise state and performance tracking fields:
   • status: text
     - Track exercise progress
     - Values: 'pending', 'in_progress', 'completed', 'skipped'
     - Default: 'pending'
   
   • started_at: timestamp
     - Record when exercise started
     - Nullable: true
   
   • completed_at: timestamp
     - Record when exercise was completed
     - Nullable: true
   
   • sets_completed: integer
     - Track number of completed sets
     - Default: 0
   
   • current_set: integer
     - Track current set number
     - Default: 0
   
   • set_details: jsonb
     - Store detailed information about each set
     - Structure:
       {
         "sets": [
           {
             "set_number": integer,
             "weight": number,
             "reps": integer,
             "rest_duration": integer,
             "completed_at": timestamp,
             "feedback": text
           }
         ]
       }
   
   • performance_rating: integer
     - User's self-rating of performance
     - Range: 1-5
     - Nullable: true
   
   • difficulty_level: integer
     - Perceived difficulty of the exercise
     - Range: 1-5
     - Nullable: true
   
   • energy_level: integer
     - User's energy level during exercise
     - Range: 1-5
     - Nullable: true
   
   • muscle_fatigue: integer
     - Track muscle fatigue level
     - Range: 1-5
     - Nullable: true
   
   • recovery_time: integer
     - Estimated recovery time in hours
     - Nullable: true

TODO: Create new table for workout modifications history:
13.10 Workout Modifications Table
   Purpose: Track all modifications made during a workout session

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • workout_id: uuid
     - Foreign key to workouts table
     - References workouts.id

   • exercise_id: uuid
     - Foreign key to exercises table
     - References exercises.id

   • modification_type: text
     - Values: 'reorder', 'substitute', 'add', 'remove', 'skip'

   • previous_state: jsonb
     - State before modification

   • new_state: jsonb
     - State after modification

   • reason: text
     - Reason for modification
     - Optional field

   • created_at: timestamp
     - When the modification was made
     - Default: current timestamp

   • created_by: uuid
     - Foreign key to users table
     - References users.id

13.4 AI Sessions Table
   Purpose: Track AI coach interactions

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id

   • startedAt: timestamp
     - When the session started
     - Default: current timestamp

   • endedAt: timestamp
     - When the session ended
     - Optional field

   • sessionType: text
     - Type of session (e.g., "workout", "chat")
     - Optional field

   • summary: text
     - Session summary or notes
     - Optional field

   • embedding: vector
     - Session embedding vector
     - Dimensions: 1536
     - Used for semantic search and context

13.5 User Accounts Table
   Purpose: Link users with external providers (e.g., Telegram)

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id
     - Not null

   • provider: text
     - External provider name (e.g., "telegram")
     - Not null

   • providerUserId: text
     - User ID from the provider
     - Not null

   • createdAt: timestamp
     - When the account was created
     - Default: current timestamp

   • updatedAt: timestamp
     - When the account was last updated
     - Default: current timestamp

   Constraints:
   • Unique composite key on (provider, providerUserId)

13.6 Exercises Table
   Purpose: Store exercise definitions and metadata

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • name: text
     - Exercise name
     - Optional field

   • category: text
     - Exercise category (e.g., "legs", "chest")
     - Optional field

   • isGlobal: boolean
     - Whether the exercise is available to all users
     - Default: true

   • createdBy: uuid
     - Reference to user who created the exercise
     - Null for global exercises
     - Optional field

   • description: text
     - General description of the exercise
     - Optional field

   • technique: text
     - Instructions on how to perform the exercise
     - Optional field

   • embedding: vector
     - Exercise embedding vector
     - Dimensions: 1536
     - Used for semantic search and recommendations

13.7 Workout Exercises Table
   Purpose: Link exercises to workouts (many-to-many relationship)

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • workoutId: uuid
     - Foreign key to workouts table
     - References workouts.id

   • exerciseId: uuid
     - Foreign key to exercises table
     - References exercises.id

   • order: integer
     - Exercise order in the workout
     - Optional field

13.8 User Metrics Table
   Purpose: Track user's physical measurements over time

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id

   • weight: real
     - User's weight
     - Optional field

   • chest: real
     - Chest measurement
     - Optional field

   • waist: real
     - Waist measurement
     - Optional field

   • hips: real
     - Hips measurement
     - Optional field

   • biceps: real
     - Biceps measurement
     - Optional field

   • thigh: real
     - Thigh measurement
     - Optional field

   • createdAt: timestamp
     - When the metrics were recorded
     - Default: current timestamp

13.9 Coach Settings Table
   Purpose: Store AI coach behavior preferences

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id

   • tone: text
     - Preferred communication tone
     - Optional field

   • behaviorRules: text
     - Custom behavior rules for the coach
     - Optional field

   • encouragementStyle: text
     - Preferred style of encouragement
     - Optional field

   • prepHints: boolean
     - Whether to provide preparation hints
     - Default: true

   • feedbackQuestions: boolean
     - Whether to ask feedback questions
     - Default: true

13.10 User Memories Table
   Purpose: Store personalized user context and memories

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id

   • topic: text
     - Memory topic or category
     - Optional field

   • content: text
     - Memory content
     - Optional field

   • embedding: vector
     - Memory embedding vector
     - Dimensions: 1536
     - Used for semantic search and context retrieval

   • createdAt: timestamp
     - When the memory was created
     - Default: current timestamp

13.11 User Goals Table
   Purpose: Store user's fitness goals and progress

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id

   • goal_type: text
     - Type of fitness goal
     - Values: 'weight_loss', 'muscle_gain', 'endurance', 'strength', 'flexibility', 'general_fitness'

   • target_value: real
     - Target value for the goal
     - Optional field

   • current_value: real
     - Current progress value
     - Optional field

   • start_date: timestamp
     - When the goal was set
     - Default: current timestamp

   • target_date: timestamp
     - When the goal should be achieved
     - Optional field

   • status: text
     - Goal status
     - Values: 'active', 'completed', 'abandoned'
     - Default: 'active'

   • notes: text
     - Additional notes about the goal
     - Optional field

13.12 Training Programs Table
   Purpose: Store user's training programs and progress

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id

   • goal_id: uuid
     - Foreign key to user_goals table
     - References user_goals.id

   • name: text
     - Program name
     - Optional field

   • description: text
     - Program description
     - Optional field

   • duration_weeks: integer
     - Program duration in weeks
     - Optional field

   • start_date: timestamp
     - When the program started
     - Default: current timestamp

   • end_date: timestamp
     - When the program should end
     - Optional field

   • status: text
     - Program status
     - Values: 'active', 'completed', 'paused', 'abandoned'
     - Default: 'active'

   • current_week: integer
     - Current week in the program
     - Default: 1

   • current_phase: text
     - Current training phase
     - Optional field

   • notes: text
     - Additional notes about the program
     - Optional field

13.13 Program Workouts Table
   Purpose: Link workouts to training programs

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • program_id: uuid
     - Foreign key to training_programs table
     - References training_programs.id

   • workout_id: uuid
     - Foreign key to workouts table
     - References workouts.id

   • week_number: integer
     - Week number in the program
     - Optional field

   • day_number: integer
     - Day number in the week
     - Optional field

   • order: integer
     - Workout order in the program
     - Optional field

   • notes: text
     - Additional notes about the workout in program context
     - Optional field

13.14 Training Context Table
   Purpose: Store user's training context and preferences

   Fields:
   • id: uuid
     - Primary key
     - Auto-generated random UUID

   • userId: uuid
     - Foreign key to users table
     - References users.id

   • primary_goal: text
     - Main training goal
     - Values: 'strength', 'muscle_gain', 'weight_loss', 'endurance', 'general_fitness'
     - Optional field

   • target_areas: jsonb
     - Focus areas with percentages
     - Structure:
       {
         "upper_body": integer, // percentage
         "lower_body": integer,
         "core": integer,
         "cardio": integer
       }

   • timeline_months: integer
     - Target timeline in months
     - Optional field

   • strength_level: text
     - Current strength level
     - Values: 'beginner', 'intermediate', 'advanced'
     - Optional field

   • recovery_status: text
     - Current recovery status
     - Values: 'poor', 'average', 'good', 'excellent'
     - Optional field

   • recent_progress: jsonb
     - Recent achievements
     - Structure:
       {
         "exercise": string,
         "improvement": string,
         "date": timestamp
       }

   • training_schedule: jsonb
     - Weekly schedule
     - Structure:
       {
         "frequency": integer, // times per week
         "preferred_time": string,
         "max_duration": integer // in minutes
       }

   • intensity_preference: text
     - Preferred training intensity
     - Values: 'light', 'moderate', 'intense'
     - Optional field

   • equipment_available: text[]
     - List of available equipment
     - Optional field

   • physical_limitations: text[]
     - List of physical limitations
     - Optional field

   • time_limitations: jsonb
     - Time constraints
     - Structure:
       {
         "max_session_duration": integer, // in minutes
         "available_days": string[],
         "preferred_times": string[]
       }

   • last_updated: timestamp
     - When the context was last updated
     - Default: current timestamp

   • notes: text
     - Additional context notes
     - Optional field

14. AI Message Processing Implementation

14.1 Core Components

14.1.1 AI Orchestrator
   Purpose: Central component managing AI interactions
   
   Key Features:
   • User context management
     - Maintains user profile and preferences
     - Tracks conversation history
     - Manages session state
   
   • Session handling
     - Creates and manages AI sessions
     - Tracks session duration
     - Stores session summaries
   
   • LLM interactions
     - Initializes language model
     - Manages conversation chains
     - Handles model responses
   
   • Response generation
     - Processes user input
     - Generates contextual responses
     - Applies personalization

14.1.2 LLM Service
   Purpose: Handles direct LLM interactions
   
   Key Features:
   • Model initialization
     - Sets up language model
     - Configures model parameters
     - Establishes connection
   
   • Response generation
     - Processes user messages
     - Generates AI responses
     - Applies context awareness
   
   • Context management
     - Maintains conversation context
     - Handles memory management
     - Manages prompt engineering

14.2 Message Processing Flow

14.2.1 Entry Point
   Process:
   1. Validate incoming request
   2. Identify user from provider data
   3. Check for active workout session
   4. Route message to appropriate handler
   5. Send formatted response

14.2.2 Message Routing Logic
   Flow:
   1. Check workout state:
      - In progress: Handle exercise updates
      - Planning: Handle workout planning
      - No active workout: Check for initiation
   2. Route to appropriate handler
   3. Process message in context
   4. Generate response

14.2.3 Workout State Handlers
   Planning Phase:
   1. Parse user's workout preferences
   2. Generate workout options
   3. Update workout plan
   4. Generate response with options
   
   In-Progress Workout:
   1. Get current exercise
   2. Parse exercise-related message
   3. Update exercise progress
   4. Generate next steps

14.2.4 AI Integration
   Process:
   1. Build context:
      - User profile
      - Workout state
      - Training history
      - User preferences
   2. Generate response
   3. Update state
   4. Format response

14.3 State Management

14.3.1 Workout State Machine
   States:
   • Planning
   • In Progress
   • Completed
   
   Transitions:
   • Planning → In Progress (start)
   • Planning → null (cancel)
   • In Progress → Completed (complete)
   • In Progress → Planning (pause)

14.3.2 Exercise State Management
   Process:
   1. Validate update
   2. Update exercise state
   3. Update workout progress
   4. Handle completion if needed

14.4 Database Interactions

14.4.1 Workout Updates
   Operations:
   • Update workout state
   • Update current exercise
   • Record start/end times
   • Track progress

14.4.2 Exercise Progress
   Operations:
   • Update exercise status
   • Record sets completed
   • Track current set
   • Store set details

14.5 Error Handling

14.5.1 Error Types
   Categories:
   • Invalid state transitions
   • Exercise not found
   • Invalid exercise updates
   • Workout already active

14.5.2 Error Handling Flow
   Process:
   1. Log error details
   2. Update workout state if needed
   3. Generate user-friendly response
   4. Track error for analysis

15. Use Case Scenarios

15.1 Workout Initiation Flow

15.1.1 Initial Request
   • User sends: "Let's start a workout"
   • System checks for active sessions
   • If active session exists:
     - Notify user about existing workout
     - Offer to continue or start new
   • If no active session:
     - Proceed with workout preparation

15.1.2 Workout History Analysis
   • Retrieve recent workouts (last 2 weeks)
   • Analyze workout patterns:
     - Exercise types
     - Intensity levels
     - Muscle groups worked
     - Recovery periods
   
   • Key metrics tracked:
     - Days since last workout
     - Muscle group recovery status
     - Previous workout intensity
     - User's performance trends

15.1.3 Recovery Assessment
   • Muscle group recovery check:
     - Time since last training
     - Previous workout intensity
     - User's typical recovery rate
   
   • Recovery status categories:
     - Fully recovered
     - Partially recovered
     - Needs more rest
     - Ready for light training

15.1.4 Workout Suggestions
   • Generate options based on:
     - Recovery status
     - Training history
     - User preferences
     - Available equipment
   
   • Suggestion structure:
     - Workout type
     - Intensity level
     - Focus areas
     - Exercise selection
     - Rationale for suggestion

15.1.5 User Interaction
   • Present options to user:
     - Detailed workout suggestions
     - Recovery status explanation
     - Rationale for each option
   
   • User can:
     - Select suggested workout
     - Request modifications
     - Propose alternatives
     - Ask for more information

15.1.6 Response Format
   ```
   "Hi! Let's review your recent training history:
   
   Recent workouts:
   - [Date]: [Workout type] ([Main exercises])
   - [Date]: [Workout type] ([Main exercises])
   
   Based on your recovery and training history, here are today's options:
   
   1. [Workout type] ([intensity])
      - [Reasoning/rationale]
      - Focus on [muscle groups]
      - [Exercise list]
   
   2. [Workout type] ([intensity])
      - [Reasoning/rationale]
      - Focus on [muscle groups]
      - [Exercise list]
   
   3. [Workout type] ([intensity])
      - [Reasoning/rationale]
      - Focus on [muscle groups]
      - [Exercise list]
   
   Which option would you prefer? You can choose any of these or suggest your own modifications."
   ```

15.1.7 Decision Points
   • User selection handling:
     - Validate chosen option
     - Apply any requested modifications
     - Confirm final workout plan
   
   • Modification requests:
     - Exercise substitutions
     - Intensity adjustments
     - Focus area changes
   
   • Additional information requests:
     - Exercise details
     - Recovery explanations
     - Alternative options

15.1.8 Next Steps
   • After user decision:
     - Create new workout session
     - Initialize workout tracking
     - Prepare detailed exercise plan
     - Begin workout guidance
   
   • Session initialization:
     - Record workout type
     - Set intensity level
     - Log selected exercises
     - Initialize progress tracking

15.1.9 Exercise Tracking and Management
   • Initial Exercise Setup:
     - Create workout record in database
     - Initialize exercise_logs entries for each planned exercise
     - Set initial order based on workout plan
     - Track exercise status (pending, in-progress, completed, skipped)
   
   • Exercise Flow Management:
     - Allow dynamic reordering of exercises
     - Support exercise modifications:
       • Substitutions (replace with alternative)
       • Additions (new exercises)
       • Removals (skip or remove)
     - Track exercise sequence changes
   
   • Exercise Status Updates:
     - Record start time for each exercise
     - Track completion status
     - Log modifications and reasons
     - Update workout progress
   
   • User Interaction Flow:
     ```
     "Starting [Exercise Name]:
     - Target: [sets] sets of [reps] reps
     - Weight: [weight] kg
     - Rest: [duration] between sets
     
     Let me know when you're ready to start, or if you'd like to:
     - Skip this exercise
     - Modify the parameters
     - Replace with alternative
     - Reorder remaining exercises"
     ```
   
   • Exercise Completion:
     - Record actual performance:
       • Sets completed
       • Reps per set
       • Weight used
       • Rest periods
     - Capture user feedback
     - Update recovery tracking
     - Suggest next exercise
   
   • Workout Modifications:
     - Track all changes in workout_exercises table
     - Maintain exercise order history
     - Record modification reasons
     - Update workout summary
   
   • Progress Monitoring:
     - Compare with previous performance
     - Track volume and intensity
     - Monitor rest periods
     - Assess form and technique feedback

15.1.10 Workout State Management and Database Tracking

   • Workout State Tracking:
     - Maintain current state in database:
       • workout.status: 'planning' | 'in_progress' | 'completed'
       • workout.current_exercise_id: UUID | null
       • workout.started_at: timestamp
       • workout.completed_at: timestamp | null
     
     - Exercise state tracking:
       • exercise_logs.status: 'pending' | 'in_progress' | 'completed' | 'skipped'
       • exercise_logs.started_at: timestamp
       • exercise_logs.completed_at: timestamp
       • exercise_logs.sets_completed: integer
       • exercise_logs.current_set: integer
   
   • State Transitions and Database Updates:
     1. Planning Phase:
        - Create workout record (status: 'planning')
        - Initialize exercise_logs entries
        - Set initial exercise order
        - Store workout plan details
     
     2. Exercise Start:
        - Update workout status to 'in_progress'
        - Set workout.started_at
        - Update exercise_logs.status to 'in_progress'
        - Set exercise_logs.started_at
        - Initialize sets tracking
     
     3. Set Completion:
        - Increment exercise_logs.sets_completed
        - Update exercise_logs.current_set
        - Store set details:
          • Weight used
          • Reps completed
          • Rest duration
          • User feedback
     
     4. Exercise Completion:
        - Update exercise_logs.status to 'completed'
        - Set exercise_logs.completed_at
        - Calculate exercise metrics
        - Update recovery tracking
        - Prepare next exercise
     
     5. Workout Completion:
        - Update workout.status to 'completed'
        - Set workout.completed_at
        - Calculate workout summary
        - Update user metrics
        - Generate progress insights

   • AI Context Awareness:
     ```
     Current State: [Workout Status]
     Progress: [X] of [Y] exercises completed
     Current Exercise: [Exercise Name]
     Sets: [Completed] of [Total]
     
     Next Steps:
     - [Next action based on current state]
     - [Available modifications]
     - [Progress tracking]
     ```
   
   • State-Based Response Templates:
     1. Planning Phase:
        ```
        "Let's plan your workout:
        [Workout options and rationale]
        Which option would you prefer?"
        ```
     
     2. Exercise Start:
        ```
        "Starting [Exercise Name]:
        Target: [sets] sets of [reps] reps
        Weight: [weight] kg
        Rest: [duration] between sets
        
        Ready to begin?"
        ```
     
     3. Set Completion:
        ```
        "Great! Set [X] completed:
        - Weight: [weight] kg
        - Reps: [reps]
        - Rest: [duration]
        
        Ready for set [X+1]?"
        ```
     
     4. Exercise Completion:
        ```
        "Excellent! [Exercise Name] completed:
        - Total sets: [X]
        - Average weight: [Y] kg
        - Total volume: [Z] kg
        
        Next exercise: [Next Exercise Name]"
        ```
     
     5. Workout Completion:
        ```
        "Workout completed! Summary:
        - Total exercises: [X]
        - Total volume: [Y] kg
        - Key achievements: [Z]
        
        Would you like to review your performance?"
        ```

   • Database Schema Updates:
     - workout table:
       • status: text
       • current_exercise_id: uuid
       • started_at: timestamp
       • completed_at: timestamp
     
     - exercise_logs table:
       • status: text
       • started_at: timestamp
       • completed_at: timestamp
       • sets_completed: integer
       • current_set: integer
       • set_details: jsonb
       • user_feedback: text

15.1.11 Database Schema TODOs

   • TODO: Workout State Tracking
     - Add to workout table:
       • status: text
         - Purpose: Track workout lifecycle (planning/in_progress/completed)
         - Values: 'planning', 'in_progress', 'completed'
         - Default: 'planning'
       
       • current_exercise_id: uuid
         - Purpose: Reference to currently active exercise
         - Foreign key to exercise_logs.id
         - Nullable: true
       
       • started_at: timestamp
         - Purpose: Record when workout actually started
         - Nullable: true
       
       • completed_at: timestamp
         - Purpose: Record when workout was completed
         - Nullable: true
     
     - Add to exercise_logs table:
       • status: text
         - Purpose: Track exercise progress
         - Values: 'pending', 'in_progress', 'completed', 'skipped'
         - Default: 'pending'
       
       • started_at: timestamp
         - Purpose: Record when exercise started
         - Nullable: true
       
       • completed_at: timestamp
         - Purpose: Record when exercise was completed
         - Nullable: true
       
       • sets_completed: integer
         - Purpose: Track number of completed sets
         - Default: 0
       
       • current_set: integer
         - Purpose: Track current set number
         - Default: 0
       
       • set_details: jsonb
         - Purpose: Store detailed information about each set
         - Structure:
           {
             "sets": [
               {
                 "set_number": integer,
                 "weight": number,
                 "reps": integer,
                 "rest_duration": integer,
                 "completed_at": timestamp,
                 "feedback": text
               }
             ]
           }
       
       • user_feedback: text
         - Purpose: Store user's feedback about the exercise
         - Nullable: true

   • TODO: Performance Tracking
     - Add to exercise_logs table:
       • performance_rating: integer
         - Purpose: User's self-rating of performance
         - Range: 1-5
         - Nullable: true
       
       • difficulty_level: integer
         - Purpose: Perceived difficulty of the exercise
         - Range: 1-5
         - Nullable: true
       
       • energy_level: integer
         - Purpose: User's energy level during exercise
         - Range: 1-5
         - Nullable: true

   • TODO: Workout Modifications History
     - Create new table: workout_modifications
       • id: uuid (primary key)
       • workout_id: uuid (foreign key)
       • exercise_id: uuid (foreign key)
       • modification_type: text
         - Values: 'reorder', 'substitute', 'add', 'remove', 'skip'
       • previous_state: jsonb
       • new_state: jsonb
       • reason: text
       • created_at: timestamp
       • created_by: uuid (foreign key to users)

   • TODO: Recovery Tracking
     - Add to exercise_logs table:
       • muscle_fatigue: integer
         - Purpose: Track muscle fatigue level
         - Range: 1-5
         - Nullable: true
       
       • recovery_time: integer
         - Purpose: Estimated recovery time in hours
         - Nullable: true

16. Message Processing Implementation

16.1 Core Components

16.1.1 Message Router (server/src/api/message.ts)
   Purpose: Initial message handling and routing
   
   Responsibilities:
   • Request validation
   • User identification
   • Session management
   • Message type classification
   • Routing to appropriate handler

16.1.2 AI Service (server/services/ai.service.ts)
   Purpose: Main AI interaction logic
   
   Responsibilities:
   • Context management
   • State tracking
   • LLM orchestration
   • Response generation
   • Database updates

16.1.3 Workout Service (server/services/workout.service.ts)
   Purpose: Workout-specific logic
   
   Responsibilities:
   • Workout state management
   • Exercise tracking
   • Progress monitoring
   • Performance analysis
   • Recovery tracking

16.2 Message Processing Flow

16.2.1 Entry Point
   Process:
   1. Validate incoming request
   2. Identify user from provider data
   3. Check for active workout session
   4. Route message to appropriate handler
   5. Send formatted response

16.2.2 Message Routing Logic
   Flow:
   1. Check workout state:
      - In progress: Handle exercise updates
      - Planning: Handle workout planning
      - No active workout: Check for initiation
   2. Route to appropriate handler
   3. Process message in context
   4. Generate response

16.2.3 Workout State Handlers
   Planning Phase:
   1. Parse user's workout preferences
   2. Generate workout options
   3. Update workout plan
   4. Generate response with options
   
   In-Progress Workout:
   1. Get current exercise
   2. Parse exercise-related message
   3. Update exercise progress
   4. Generate next steps

16.2.4 AI Integration
   Process:
   1. Build context:
      - User profile
      - Workout state
      - Training history
      - User preferences
   2. Generate response
   3. Update state
   4. Format response

16.3 State Management

16.3.1 Workout State Machine
   States:
   • Planning
   • In Progress
   • Completed
   
   Transitions:
   • Planning → In Progress (start)
   • Planning → null (cancel)
   • In Progress → Completed (complete)
   • In Progress → Planning (pause)

16.3.2 Exercise State Management
   Process:
   1. Validate update
   2. Update exercise state
   3. Update workout progress
   4. Handle completion if needed

16.4 Database Interactions

16.4.1 Workout Updates
   Operations:
   • Update workout state
   • Update current exercise
   • Record start/end times
   • Track progress

16.4.2 Exercise Progress
   Operations:
   • Update exercise status
   • Record sets completed
   • Track current set
   • Store set details

16.5 Error Handling

16.5.1 Error Types
   Categories:
   • Invalid state transitions
   • Exercise not found
   • Invalid exercise updates
   • Workout already active

16.5.2 Error Handling Flow
   Process:
   1. Log error details
   2. Update workout state if needed
   3. Generate user-friendly response
   4. Track error for analysis
