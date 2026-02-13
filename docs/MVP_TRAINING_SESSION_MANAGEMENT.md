# Training Session Management MVP

## Overview

Implement the foundation for training session management, enabling users to:
- Store workout plans with flexible structure (JSONB)
- Track workout sessions with detailed exercise and set data
- Get AI recommendations for "What should I do today?" based on training history
- Log exercises retrospectively or in real-time
- Maintain recovery context across sessions

## Database Architecture

### 1. Core Tables

#### `workout_plans`
Stores user's training plans with flexible JSONB structure.

```sql
CREATE TABLE workout_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  plan_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workout_plans_user_status ON workout_plans(user_id, status);
```

**plan_json structure:**
```typescript
{
  goal: "Muscle gain, 4-day upper/lower split",
  trainingStyle: "Progressive overload, compound focus",
  targetMuscleGroups: ["chest", "back", "legs", "shoulders", "arms"],
  
  recoveryGuidelines: {
    majorMuscleGroups: { minRestDays: 2, maxRestDays: 4 },
    smallMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
    highIntensity: { minRestDays: 3 },
    customRules: [
      "If RPE > 8 on compound lifts, add +1 rest day"
    ]
  },
  
  sessionTemplates: [
    {
      key: "upper_a",
      name: "Upper A - Chest/Back",
      focus: "Chest and back compound movements",
      estimatedDuration: 60,
      exercises: [
        {
          exerciseId: 1,
          targetSets: 3,
          targetReps: "8-10",
          targetWeight: 70,
          restSeconds: 90,
          notes: "Focus on form"
        }
      ]
    }
  ],
  
  progressionRules: [
    "Increase weight when hitting top of rep range for 2 consecutive sessions",
    "Deload by 10% if failing to hit bottom of rep range for 2 sessions"
  ]
}
```

#### `exercises`
Exercise catalog with standardized definitions.

```sql
CREATE TABLE exercises (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL, -- 'compound' | 'isolation' | 'cardio'
  equipment TEXT NOT NULL, -- 'barbell' | 'dumbbell' | 'bodyweight' | 'machine' | 'cable'
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exercises_category ON exercises(category);
```

#### `exercise_muscle_groups`
Maps exercises to muscle groups with involvement level.

```sql
CREATE TYPE muscle_group_enum AS ENUM (
  'chest',
  'back_lats',
  'back_traps',
  'shoulders_front',
  'shoulders_side',
  'shoulders_rear',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'lower_back',
  'core'
);

CREATE TABLE exercise_muscle_groups (
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_group muscle_group_enum NOT NULL,
  involvement TEXT NOT NULL CHECK (involvement IN ('primary', 'secondary')),
  PRIMARY KEY (exercise_id, muscle_group)
);

CREATE INDEX idx_exercise_muscle_groups_muscle ON exercise_muscle_groups(muscle_group);
```

#### `workout_sessions`
Tracks actual workout sessions.

```sql
CREATE TABLE workout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES workout_plans(id) ON DELETE SET NULL,
  session_key TEXT, -- e.g., 'upper_a', 'lower_b' (from plan template)
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_minutes INT,
  user_context_json JSONB, -- {mood, sleep, energy, notes}
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workout_sessions_user_completed ON workout_sessions(user_id, completed_at DESC);
CREATE INDEX idx_workout_sessions_user_status ON workout_sessions(user_id, status);
```

**user_context_json structure:**
```typescript
{
  mood: 'good' | 'tired' | 'energetic' | null,
  sleep: 'poor' | 'normal' | 'excellent' | null,
  energy: 1-10 | null,
  notes: "Хорошо выспался, готов тяжело тренироваться"
}
```

#### `session_exercises`
Exercises performed within a session.

```sql
CREATE TABLE session_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id INT NOT NULL REFERENCES exercises(id),
  order_index INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  target_sets INT,
  target_reps TEXT, -- e.g., '8-10', '12-15'
  target_weight DECIMAL(6,2),
  actual_reps_range TEXT, -- e.g., '8,8,7' or '10-8'
  user_feedback TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_session_exercises_session ON session_exercises(session_id, order_index);
```

#### `session_sets`
Individual sets within an exercise.

```sql
CREATE TABLE session_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_exercise_id UUID NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
  set_number INT NOT NULL,
  actual_reps INT NOT NULL,
  actual_weight DECIMAL(6,2),
  rest_seconds INT,
  rpe INT CHECK (rpe >= 1 AND rpe <= 10), -- Rate of Perceived Exertion
  user_feedback TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_session_sets_exercise ON session_sets(session_exercise_id, set_number);
```

### 2. Schema Updates

Update `apps/server/src/infra/db/schema.ts`:
- Add new enums: `muscleGroupEnum`, `workoutPlanStatusEnum`, `sessionStatusEnum`, `exerciseStatusEnum`
- Add new tables: `workoutPlans`, `exercises`, `exerciseMuscleGroups`, `workoutSessions`, `sessionExercises`, `sessionSets`
- Add Drizzle relations for type-safe joins

## Domain Layer

### 1. Training Domain Ports

Update `apps/server/src/domain/training/ports.ts`:

```typescript
// Workout Plan Management
export interface IWorkoutPlanRepository {
  create(userId: string, plan: CreateWorkoutPlanDto): Promise<WorkoutPlan>;
  findById(planId: string): Promise<WorkoutPlan | null>;
  findActiveByUserId(userId: string): Promise<WorkoutPlan | null>;
  update(planId: string, updates: Partial<WorkoutPlan>): Promise<WorkoutPlan>;
  archive(planId: string): Promise<void>;
}

// Exercise Catalog
export interface IExerciseRepository {
  findById(id: number): Promise<Exercise | null>;
  findByIds(ids: number[]): Promise<Exercise[]>;
  findByMuscleGroup(muscleGroup: MuscleGroup): Promise<Exercise[]>;
  search(query: string): Promise<Exercise[]>;
}

// Session Management
export interface IWorkoutSessionRepository {
  create(userId: string, session: CreateSessionDto): Promise<WorkoutSession>;
  findById(sessionId: string): Promise<WorkoutSession | null>;
  findRecentByUserId(userId: string, limit: number): Promise<WorkoutSession[]>;
  update(sessionId: string, updates: Partial<WorkoutSession>): Promise<WorkoutSession>;
  complete(sessionId: string, completedAt: Date, duration: number): Promise<WorkoutSession>;
}

export interface ISessionExerciseRepository {
  create(sessionId: string, exercise: CreateSessionExerciseDto): Promise<SessionExercise>;
  findBySessionId(sessionId: string): Promise<SessionExercise[]>;
  update(exerciseId: string, updates: Partial<SessionExercise>): Promise<SessionExercise>;
}

export interface ISessionSetRepository {
  create(exerciseId: string, set: CreateSessionSetDto): Promise<SessionSet>;
  findByExerciseId(exerciseId: string): Promise<SessionSet[]>;
  update(setId: string, updates: Partial<SessionSet>): Promise<SessionSet>;
}

// Session Recommendation
export interface ISessionRecommendationService {
  recommendNextSession(userId: string): Promise<SessionRecommendation>;
}
```

### 2. Training Service

Create `apps/server/src/domain/training/training.service.ts`:

```typescript
export class TrainingService {
  constructor(
    private workoutPlanRepo: IWorkoutPlanRepository,
    private sessionRepo: IWorkoutSessionRepository,
    private exerciseRepo: IExerciseRepository,
    private aiService: IAIService
  ) {}

  async getNextSessionRecommendation(userId: string): Promise<SessionRecommendation> {
    // 1. Get active plan
    const plan = await this.workoutPlanRepo.findActiveByUserId(userId);
    if (!plan) throw new Error('No active plan');

    // 2. Get last 5 sessions with full details
    const recentSessions = await this.sessionRepo.findRecentByUserId(userId, 5);

    // 3. Build AI prompt with:
    //    - User profile
    //    - Plan structure (goal, templates, recovery rules)
    //    - Training history (sessions, exercises, sets, RPE, feedback)
    //    - Timeline analysis (muscle groups, days since last training)
    const prompt = await this.buildRecommendationPrompt(userId, plan, recentSessions);

    // 4. Get AI recommendation
    const recommendation = await this.aiService.generateSessionRecommendation(prompt);

    return recommendation;
  }

  private async buildRecommendationPrompt(
    userId: string,
    plan: WorkoutPlan,
    sessions: WorkoutSession[]
  ): Promise<string> {
    // Implementation: construct prompt as shown in earlier example
    // Include: profile, plan, history, timeline, recovery guidelines
  }
}
```

## AI Integration

### 1. Session Recommendation Prompt

Create `apps/server/src/domain/ai/prompts/session-recommendation.prompt.ts`:

Structure:
1. **CLIENT PROFILE** - from `users` table
2. **CURRENT PLAN (REFERENCE)** - from `workout_plans.plan_json`
3. **TRAINING HISTORY** - last 5 sessions from `workout_sessions` + `session_exercises` + `session_sets`
4. **TIMELINE ANALYSIS** - computed from history: muscle groups trained, days ago, volume/intensity
5. **TODAY'S CONTEXT** - current date, days since last workout
6. **YOUR TASK** - analysis steps + response format

Key instruction:
```
Plan is a REFERENCE, not a strict schedule. User may have deviated.
Analyze actual training history to determine current state.
Use recovery guidelines from plan to assess readiness.
```

### 2. AI Service Extension

Update `apps/server/src/domain/ai/ai.service.ts`:

```typescript
async generateSessionRecommendation(prompt: string): Promise<SessionRecommendation> {
  const response = await this.llm.invoke(prompt, {
    response_format: { type: 'json_object' },
    temperature: 0.7
  });

  return {
    recommendedSessionKey: response.sessionKey,
    reasoning: response.reasoning,
    exercises: response.exercises,
    modifications: response.modifications,
    warnings: response.warnings
  };
}
```

## API Layer

### 1. Training Routes

Create `apps/server/src/app/routes/training.routes.ts`:

```typescript
// GET /api/training/recommendation - Get next session recommendation
// POST /api/training/sessions - Create/start a session
// GET /api/training/sessions/:id - Get session details
// PATCH /api/training/sessions/:id - Update session (add exercises, complete)
// POST /api/training/sessions/:id/exercises - Add exercise to session
// POST /api/training/sessions/:id/exercises/:exerciseId/sets - Log a set
// GET /api/training/history - Get training history (last N sessions)
// GET /api/training/plans - Get user's plans
// POST /api/training/plans - Create a plan (manual for MVP)
```

### 2. Request/Response DTOs

Create `apps/server/src/app/dto/training.dto.ts`:

```typescript
export const GetRecommendationResponseSchema = z.object({
  recommendation: z.object({
    sessionKey: z.string(),
    sessionName: z.string(),
    reasoning: z.string(),
    exercises: z.array(z.object({
      exerciseId: z.number(),
      exerciseName: z.string(),
      targetSets: z.number(),
      targetReps: z.string(),
      targetWeight: z.number().optional(),
      restSeconds: z.number(),
      notes: z.string().optional()
    })),
    estimatedDuration: z.number(),
    warnings: z.array(z.string()).optional()
  })
});

export const CreateSessionRequestSchema = z.object({
  planId: z.string().uuid(),
  sessionKey: z.string().optional(),
  userContext: z.object({
    mood: z.enum(['good', 'tired', 'energetic']).optional(),
    sleep: z.enum(['poor', 'normal', 'excellent']).optional(),
    energy: z.number().min(1).max(10).optional(),
    notes: z.string().optional()
  }).optional()
});

export const LogSetRequestSchema = z.object({
  setNumber: z.number().int().positive(),
  actualReps: z.number().int().positive(),
  actualWeight: z.number().positive().optional(),
  restSeconds: z.number().int().positive().optional(),
  rpe: z.number().int().min(1).max(10).optional(),
  userFeedback: z.string().optional()
});
```

## Implementation Steps

### Phase 1: Database Setup
1. Create migration for new tables (`workout_plans`, `exercises`, `exercise_muscle_groups`, `workout_sessions`, `session_exercises`, `session_sets`)
2. Update Drizzle schema with new tables and relations
3. Seed `exercises` table with common exercises (bench press, squats, deadlifts, etc.)
4. Seed `exercise_muscle_groups` with muscle mappings

### Phase 2: Domain Layer
1. Define TypeScript types for all entities
2. Implement repository interfaces in `domain/training/ports.ts`
3. Create repository implementations in `infra/db/repositories/`
4. Implement `TrainingService` with session recommendation logic
5. Create prompt builder for session recommendations

### Phase 3: AI Integration
1. Create session recommendation prompt template
2. Extend `AIService` with `generateSessionRecommendation` method
3. Implement recovery analysis logic (timeline computation)
4. Add structured output parsing for AI recommendations

### Phase 4: API Layer
1. Create training routes (`/api/training/*`)
2. Implement DTOs with Zod validation
3. Add route handlers for:
   - Get recommendation
   - Create/start session
   - Log exercises and sets
   - Complete session
   - Get training history
4. Add error handling and logging

### Phase 5: Testing
1. Unit tests for `TrainingService`
2. Integration tests for repositories
3. E2E tests for API endpoints
4. Test prompt generation with mock data
5. Test AI recommendation parsing

### Phase 6: Documentation
1. Update `docs/domain/training.spec.md` with new concepts
2. Create `docs/features/FEAT-0010-training-session-management.md`
3. Update `docs/API_SPEC.md` with new endpoints
4. Add examples to `docs/CONTRIBUTING_AI.md`

## Key Design Decisions

### 1. Plan Storage: JSONB
- **Pro**: Flexible structure, easy to evolve
- **Pro**: No complex joins for plan retrieval
- **Con**: Cannot query individual exercises in plan
- **Decision**: JSONB for MVP, can normalize later if needed

### 2. History Depth: 5 Sessions
- ~2500 tokens per recommendation
- Configurable via plan settings
- Sufficient for pattern detection

### 3. Recovery Analysis: AI-Driven
- No pre-computed recovery status
- AI analyzes timeline + recovery guidelines
- More flexible than hardcoded rules

### 4. Plan as "Goal + Guide"
- Plan is not a strict schedule
- AI adapts based on actual history
- User cannot "deviate" from plan (plan is philosophy)

### 5. Muscle Groups: 16 Categories
- Granular enough for recovery tracking
- Not too detailed (avoids complexity)
- Separate table for data integrity

### 6. Session Context: Extracted from Chat → Stored in DB
- User provides context in conversation
- AI extracts structured data
- Stored in `workout_sessions.user_context_json`
- Available for future analysis

## MVP Scope

**In Scope:**
- Store workout plans (manual creation for MVP)
- Track sessions with exercises and sets
- AI recommendation for "What should I do today?"
- Retrospective logging (log past workouts)
- Training history (last N sessions)
- Recovery analysis via AI

**Out of Scope (Future):**
- Automatic plan generation (FEAT-0008)
- Real-time session guidance (conversational tracking)
- Progress charts and analytics
- Workout plan templates library
- Social features (sharing plans, workouts)
- Video exercise demonstrations
- Form check via camera
- Wearable device integration

## Success Criteria

MVP is successful when:
1. User can manually create a workout plan
2. User can ask "What should I do today?" and get AI recommendation
3. User can log a workout session with exercises and sets
4. User can view training history (last 5-10 sessions)
5. AI recommendations consider recovery and training history
6. All data persists correctly in database
7. API endpoints work reliably with proper validation
8. Integration tests pass for core flows
