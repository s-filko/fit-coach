# Testing Rules Checklist (Fastify / FitCoach)

**Purpose:** Strict, unambiguous rules. Easy to read, easy to follow, easy to verify. No ambiguity. This file is the single source of truth for humans and AI.  

---

## 0) Quick AI Self-Check Before Any Test
- [ ] Test type defined: Unit / Integration / E2E.
- [ ] File path matches test type.
- [ ] File name matches required pattern.
- [ ] No hardcoded secrets, ports, paths, or credentials.
- [ ] No duplicate test cases or logic.
- [ ] Test is isolated, data is unique, state is cleaned.
- [ ] Assertions cover status/headers (for API) and body.
- [ ] Time/randomness stabilized if it affects results.
- [ ] Logs are silent in tests.
- [ ] Coverage and time budgets respected.
- [ ] Follows examples in section 16 (Reference Examples).  

---

## 1) Test Types and Location
**Unit (next to code):**
- Path: `src/**/__tests__/*.unit.test.ts`  
- MUST NOT access DB, network, FS, queues.  
- MUST mock all external dependencies.  

**Integration (separate):**
- Path: `tests/integration/**/*.integration.test.ts`  
- ALLOWED: real test DB, repositories, routes.  
- MUST rollback state after each test (transaction rollback or explicit cleanup).  

**E2E (separate):**
- Path: `tests/e2e/**/*.e2e.test.ts`  
- ALLOWED: whole application. Prefer `fastify.inject`, no real port binding.  

---

## 2) Naming and Structure
- File names: `*.unit.test.ts`, `*.integration.test.ts`, `*.e2e.test.ts`.  
- Test descriptions must be behavioral and explicit:  
  ```ts
  it('should return 400 when userId is missing', async () => { /* ... */ });
  ```
- Use AAA pattern: Arrange → Act → Assert. One Act per test.  

```ts
// Example: AAA pattern
type Repo = { updateProfileData: jest.Mock };
describe('UserService', () => {
  it('should update profile data', async () => {
    // Arrange
    const repo: Repo = { updateProfileData: jest.fn() };
    const service = new UserService(repo as unknown as UserRepository);
    // Act
    await service.updateProfileData('123', { name: 'Alice' });
    // Assert
    expect(repo.updateProfileData).toHaveBeenCalledWith('123', { name: 'Alice' });
  });
});
```

---

## 3) Environment and Configs
- Only allowed env files: `.env.test.unit`, `.env.test.integration`, `.env.test.e2e`.  
- NEVER use dev/prod env in tests.  
- Unit: server MUST NOT be started.  
- Integration: start via `buildServer()` and `fastify.inject`.  
- E2E: run full app, preferably via `inject`.  

---

## 4) Database and Data
- Integration/E2E:  
  - One container/connection per suite.  
  - Transaction per test with rollback OR full table cleanup in `afterEach`.  
  - Data only via factories. Values MUST be unique (`Date.now()` + `Math.random()` if needed).  
  - Tests MUST NOT depend on each other. No “created in A → used in B”.  

Example transaction rollback (pseudo-code):  
```ts
// All comments in code are in English
let tx: any;
// tx is a transactional context; all operations must use tx
beforeEach(async () => { tx = await db.begin(); });
afterEach(async () => { await tx.rollback(); });
```

```ts
// Example: Integration test with transaction rollback
describe('UserRepository – integration', () => {
  let tx: any;
  // tx is a transactional context; all operations must use tx
  beforeEach(async () => { tx = await db.begin(); });
  afterEach(async () => { await tx.rollback(); });

  it('should create user inside transaction', async () => {
    const user = await tx.userRepository.create({ provider: 'tg', providerUserId: 'u1' });
    expect(user.id).toBeDefined();
  });
});
```

```ts
// Example: Test data factory
const createTestUser = (overrides: Partial<User> = {}): User => ({
  id: `user_${Date.now()}_${Math.random()}`,
  provider: 'telegram',
  providerUserId: `test_${Date.now()}`,
  profileStatus: 'incomplete' as const,
  ...overrides,
});
```

---

## 5) Mocks and Stubs
- Unit: mock all external boundaries (DB, HTTP, FS, queues).  
  - Type-safe: `jest.Mocked<T>`.  
  - `as any` is FORBIDDEN.  

```ts
// Example: Unit test with type-safe mock
const mockRepo = {
  create: jest.fn(),
  findByProvider: jest.fn(),
} as unknown as jest.Mocked<UserRepository>;
```

it('should call repository with correct args', async () => {
  const service = new UserService(mockRepo);
  await service.upsertUser({ provider: 'tg', providerUserId: 'u1' });
  expect(mockRepo.findByProvider).toHaveBeenCalledWith('tg', 'u1');
});
```

- Integration/E2E: infra mocks are FORBIDDEN.  
  - Only allowed: stubs of external **out-of-process** services when sandbox is impossible (e.g. `nock` with fixed fixtures).  

---

## 6) API Contracts and Schemas
- Use `fastify-type-provider-zod`. Validate BOTH requests and responses.  
- Error format is unified: `{ error: { message: string } }`.  
- For public API: minimal OpenAPI snapshot is allowed (must be consciously updated).  

---

## 7) Assertions and Errors
- For HTTP: MUST assert status code, `content-type`, JSON shape, required fields.  
- MUST NOT test private methods. Only public behavior.  
- For errors: MUST assert both code and body format.  

```ts
// Example: API error handling test
it('should return unified error format', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/chat', payload: {} });
  expect(res.statusCode).toBe(400);
  const json = res.json();
  expect(json).toEqual({ error: { message: expect.any(String) } });
});
```

---

## 8) Time, UUID, Randomness
- Stabilize time/random if it affects assertions:
  ```ts
  jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00Z'));
  jest.spyOn(Math, 'random').mockReturnValue(0.42);
  ```
- Use deterministic UUID generators or stub functions.  

---

## 9) Snapshots
- ALLOWED only for large stable structures (OpenAPI JSON, big objects).  
- FORBIDDEN for small primitives or dynamic values.  
- Any snapshot update MUST include explanation in PR.  

---

## 10) Coverage and Budgets
- Unit: ≥ 80%, each test < 100 ms.  
- Integration: ≥ 70%, each test < 2 s.  
- E2E: cover key flows, each test < 30 s.  
- Coverage thresholds enforced in CI. Violations block merge.  

---

## 11) Run Scripts
```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest src --testMatch=\"**/__tests__/**/*.unit.test.ts\"",
    "test:integration": "RUN_DB_TESTS=1 jest tests/integration",
    "test:e2e": "RUN_E2E=1 jest tests/e2e",
    "test:coverage": "jest --coverage"
  }
}
```

---

## 12) Lint and Test Quality
- ESLint + `eslint-plugin-jest`.  
- `.only` / `.skip` FORBIDDEN in CI.  
- `console.log` FORBIDDEN in tests.  
- Avoid `as any`.  

---

## 13) CI/CD
- Unit — ALWAYS run.  
- Integration/E2E — separate jobs, enabled via flags.  
- Any flaky test → quarantine + ticket with deadline.  

---

## 14) PR Policy
- Any new public API → integration test.  
- Critical business logic → unit test.  
- Refactor with no behavior change → tests MUST NOT change. If changed, reason MUST be explained.  

---

## 15) Anti-Patterns (FORBIDDEN)
- Mixing unit and integration in one file.  
- Placing integration/E2E next to source code.  
- Duplicate test cases at same level.  
- Hardcoding secrets, URLs, ports, creds.  
- Testing private methods.  
- Leaving DB state after test.  

---

## 16.1) Unit Test Example with Mocks
```ts
// All comments in code are in English
import { UserService } from '../user.service';

const mockRepository = {
  updateProfileData: jest.fn(),
  getById: jest.fn(),
} as jest.Mocked<any>;

describe('UserService.isRegistrationComplete - unit', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService(mockRepository);
  });

  it('should return true for complete status', () => {
    const result = service.isRegistrationComplete({
      id: '123',
      profileStatus: 'complete'
    });
    expect(result).toBe(true);
  });
});
```

---

## 16.2) Test Data Factory Pattern
```ts
// All comments in code are in English
const createTestUser = (overrides: Partial<User> = {}): User => ({
  id: `user_${Date.now()}_${Math.random()}`,
  profileStatus: 'incomplete' as const,
  age: 25,
  gender: 'female' as const,
  ...overrides
});

// Usage
describe('UserService', () => {
  it('should handle complete profile', () => {
    const user = createTestUser({ profileStatus: 'complete' });
    expect(service.isRegistrationComplete(user)).toBe(true);
  });
});
```

---

## 16.3) Error Handling Patterns (Unit/Integration)
```ts
// All comments in code are in English

// Unit test: Mock error handling
describe('UserService.updateProfileData - unit error handling', () => {
  it('should throw when repository fails', async () => {
    mockRepository.updateProfileData.mockRejectedValue(
      new Error('Database connection failed')
    );

    await expect(
      service.updateProfileData('user-123', { age: 25 })
    ).rejects.toThrow('Database connection failed');
  });
});

// Integration test: Real error handling
describe('UserService.updateProfileData - integration error handling', () => {
  it('should handle database connection errors', async () => {
    // Simulate real DB failure (network issue, timeout, etc.)
    // Test with actual repository and test database
    await expect(
      service.updateProfileData('user-123', { age: 25 })
    ).rejects.toThrow();
  });
});
```

---

## 16.4) API Integration Test Example (Fastify)
```ts
// All comments in code are in English
import { buildServer } from '@/app/server';

describe('POST /api/chat – integration', () => {
  let app: ReturnType<typeof buildServer>;
  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('should return 400 when body is invalid', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/json');
    const json = res.json();
    expect(json).toEqual(expect.objectContaining({ error: expect.any(Object) }));
  });
});
```

---

## 16.5) E2E Test Example (User Journey)
```ts
// All comments in code are in English
describe('User Registration Journey - E2E', () => {
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    // Optionally: Seed initial data if needed
  });

  afterAll(async () => {
    await app.close();
    // Clean up any created data
  });

  it('should allow user to complete full registration flow', async () => {
    // Step 1: User provides basic info
    const basicInfo = {
      provider: 'telegram',
      providerUserId: `e2e_${Date.now()}`
    };

    let res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: basicInfo
    });
    expect(res.statusCode).toBe(200);
    const user = res.json();

    // Step 2: User updates profile
    res = await app.inject({
      method: 'PUT',
      url: `/api/users/${user.id}/profile`,
      payload: {
        age: 25,
        gender: 'female',
        height: 165,
        weight: 60,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight'
      }
    });
    expect(res.statusCode).toBe(200);

    // Step 3: Verify profile is complete
    res = await app.inject({
      method: 'GET',
      url: `/api/users/${user.id}/profile`
    });
    expect(res.statusCode).toBe(200);
    const profile = res.json();
    expect(profile.profileStatus).toBe('complete');

    // Step 4: User can now use chat feature
    res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        userId: user.id,
        message: 'Hello, I want to start my fitness journey!'
      }
    });
    expect(res.statusCode).toBe(200);
  });

  it('should handle incomplete profile gracefully', async () => {
    // Similar test but with incomplete profile
    const basicInfo = {
      provider: 'telegram',
      providerUserId: `e2e_incomplete_${Date.now()}`
    };

    let res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: basicInfo
    });
    expect(res.statusCode).toBe(200);
    const user = res.json();

    // Try to chat without complete profile
    res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        userId: user.id,
        message: 'Hello!'
      }
    });
    expect(res.statusCode).toBe(200);
    const response = res.json();
    // Should guide user to complete profile
    expect(response.message).toContain('profile');
  });
});
```

---

## 17) Common AI Mistakes to Avoid
```ts
// ❌ WRONG: Testing private methods
expect(service['privateMethod']).toHaveBeenCalled();

// ✅ CORRECT: Testing public behavior
expect(service.getUser(userId)).toEqual(expectedUser);

// ❌ WRONG: Hardcoded values in integration tests
const user = { id: '123', name: 'John' };

// ✅ CORRECT: Unique values for each test
const user = { id: `user_${Date.now()}`, name: 'John' };

// ❌ WRONG: Not cleaning up state
describe('Integration Test', () => {
  it('creates user', async () => {
    await createUser(); // State persists!
  });
});

// ✅ CORRECT: Transaction rollback
let tx: any;
beforeEach(async () => { tx = await db.begin(); });
afterEach(async () => { await tx.rollback(); });
```

---

**Maintenance:** This document MUST be updated with every process change. Any exception MUST be explicitly documented here.  
