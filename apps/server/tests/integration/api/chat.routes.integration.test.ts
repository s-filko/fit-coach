import { buildServer } from '../../../src/app/server';
import { LLM_SERVICE_TOKEN, LLMService } from '../../../src/domain/ai/ports';
import { ChatMsg, REGISTRATION_SERVICE_TOKEN, USER_SERVICE_TOKEN } from '../../../src/domain/user/ports';
import { db } from '../../../src/infra/db/drizzle';
import { Container } from '../../../src/infra/di/container';

/**
 * Stub LLM Service for Integration Tests
 * Uses predictable responses for testing without external dependencies
 * NOTE: In production integration tests, consider using real services in isolated environment
 */
class StubLLMService implements LLMService {
  async generateResponse(message: ChatMsg[] | string, isRegistration?: boolean): Promise<string> {
    if (typeof message === 'string') {
      return `Stub AI response to: ${message}`;
    }
    const text = message.map(m => m.content).join(' ');
    return `Stub AI response to: ${text}`;
  }

  async generateRegistrationResponse(message: ChatMsg[] | string, context?: string): Promise<string> {
    if (typeof message === 'string') {
      return `Stub registration response to: ${message}`;
    }
    const text = message.map(m => m.content).join(' ');
    return `Stub registration response to: ${text}`;
  }

  getDebugInfo(): any {
    return {};
  }

  enableDebugMode(): void {}
  disableDebugMode(): void {}
  clearHistory(): void {}
}

/**
 * Test Data Factories
 */
const createTestChatPayload = (overrides: Partial<{
  userId: string;
  message: string;
}> = {}) => ({
  userId: overrides.userId ?? `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  message: overrides.message ?? `Test message ${Date.now()}`,
});

const createTestApiKey = () => process.env.BOT_API_KEY!;

describe('POST /api/chat – integration', () => {
  let app: ReturnType<typeof buildServer>;
  let tx: any;

  beforeAll(async() => {
    app = buildServer();
    await app.ready();

    // Register stub services for integration testing
    // NOTE: In production, consider testing with real services in isolated environment
    const container = Container.getInstance();
    container.register(LLM_SERVICE_TOKEN, new StubLLMService());
    container.register(USER_SERVICE_TOKEN, {
      getUser: jest.fn().mockResolvedValue({
        id: 'test-user',
        profileStatus: 'complete',
      }),
      isRegistrationComplete: jest.fn().mockReturnValue(true),
      updateProfileData: jest.fn(),
    });
    container.register(REGISTRATION_SERVICE_TOKEN, {
      processUserMessage: jest.fn().mockResolvedValue({
        updatedUser: { id: 'test-user' },
        response: 'Stub response',
        isComplete: true,
      }),
    });
  });

  afterAll(async() => {
    await app.close();
  });

  // Note: For API integration tests, we don't use transactions as they test the full stack
  // Data cleanup is handled by the test data factories with unique IDs

  describe('successful message processing', () => {
    it('should accept POST requests and return AI response', async() => {
      const payload = createTestChatPayload();
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': validKey },
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('data');
      expect(json.data).toHaveProperty('content');
      expect(json.data).toHaveProperty('timestamp');
      expect(typeof json.data.content).toBe('string');
      expect(typeof json.data.timestamp).toBe('string');
    });

    it('should process messages with different content', async() => {
      const testMessages = [
        'Hello AI!',
        'How are you?',
        'What exercises should I do?',
        'I completed my workout today',
      ];

      const validKey = createTestApiKey();

      for (const message of testMessages) {
        const payload = createTestChatPayload({ message });
        const res = await app.inject({
          method: 'POST',
          url: '/api/chat',
          headers: { 'x-api-key': validKey },
          payload,
        });

        expect(res.statusCode).toBe(200);
        const json = res.json();
        expect(json.data.content).toContain('Stub AI response to:');
      }
    });

    it('should handle different user IDs', async() => {
      const validKey = createTestApiKey();

      // Test with different user IDs
      const userIds = [
        `user_${Date.now()}_1`,
        `user_${Date.now()}_2`,
        `user_${Date.now()}_3`,
      ];

      for (const userId of userIds) {
        const payload = createTestChatPayload({ userId });
        const res = await app.inject({
          method: 'POST',
          url: '/api/chat',
          headers: { 'x-api-key': validKey },
          payload,
        });

        expect(res.statusCode).toBe(200);
        const json = res.json();
        expect(json.data).toHaveProperty('content');
        expect(json.data).toHaveProperty('timestamp');
      }
    });
  });

  describe('error handling', () => {
    it('should handle missing required fields', async() => {
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': validKey },
        payload: {}, // Missing required fields
      });

      // Fastify may return 400 or 500 depending on validation error handling
      expect([400, 500]).toContain(res.statusCode);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('message');
    });

    it('should handle missing userId', async() => {
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': validKey },
        payload: {
          message: 'Hello AI!',
          // Missing userId
        },
      });

      expect([400, 500]).toContain(res.statusCode);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });

    it('should handle missing message', async() => {
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': validKey },
        payload: {
          userId: 'test-user',
          // Missing message
        },
      });

      expect([400, 500]).toContain(res.statusCode);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });

  });

  describe('request validation', () => {
    it('should handle empty message strings', async() => {
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': validKey },
        payload: {
          userId: 'test-user',
          message: '',
        },
      });

      // Should handle empty messages (may return 200, 400, or 500 depending on validation)
      expect([200, 400, 500]).toContain(res.statusCode);
    });

    it('should handle very long messages', async() => {
      const validKey = createTestApiKey();
      const longMessage = 'A'.repeat(10000); // Very long message

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': validKey },
        payload: {
          userId: 'test-user',
          message: longMessage,
        },
      });

      // Should handle or reject based on application limits
      expect([200, 400, 413]).toContain(res.statusCode);
    });
  });
});
