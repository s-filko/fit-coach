import { buildServer } from '../../../src/app/server';
import { CONVERSATION_CONTEXT_SERVICE_TOKEN } from '../../../src/domain/conversation/ports';
import { USER_SERVICE_TOKEN } from '../../../src/domain/user/ports';
import { TRAINING_SERVICE_TOKEN } from '../../../src/domain/training/ports';
import { getGlobalContainer, registerInfraServices } from '../../../src/main/register-infra-services';
import { CONVERSATION_GRAPH_TOKEN } from '../../../src/infra/ai/graph/conversation.graph';

const createTestChatPayload = (overrides: Partial<{ userId: string; message: string }> = {}) => ({
  userId: overrides.userId ?? `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  message: overrides.message ?? `Test message ${Date.now()}`,
});

const createTestApiKey = () => process.env.BOT_API_KEY!;

const stubGraph = {
  invoke: jest.fn().mockResolvedValue({
    userId: 'test-user',
    phase: 'chat',
    userMessage: 'hello',
    responseMessage: 'Stub AI response',
    user: null,
    activeSessionId: null,
    requestedTransition: null,
  }),
};

describe('POST /api/chat – integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    const container = getGlobalContainer();
    await registerInfraServices(container, { ensureDb: false });
    app = buildServer();

    const { CONVERSATION_CONTEXT_SERVICE_TOKEN: ctxToken } = await import('../../../src/domain/conversation/ports');
    const { InMemoryConversationContextService } = await import('../../../src/infra/conversation/conversation-context.service');
    container.register(ctxToken, new InMemoryConversationContextService());
    container.register(CONVERSATION_GRAPH_TOKEN, stubGraph);

    app.decorate('services', {
      userService: container.get(USER_SERVICE_TOKEN) as any,
      conversationContextService: container.get(CONVERSATION_CONTEXT_SERVICE_TOKEN) as any,
      trainingService: container.get(TRAINING_SERVICE_TOKEN) as any,
      conversationGraph: container.get(CONVERSATION_GRAPH_TOKEN) as any,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    stubGraph.invoke.mockClear();
  });

  describe('successful message processing', () => {
    it('should accept POST requests and return AI response', async () => {
      const payload = createTestChatPayload();
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': validKey },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json).toHaveProperty('data');
      expect(json.data).toHaveProperty('content');
      expect(json.data).toHaveProperty('timestamp');
      expect(typeof json.data.content).toBe('string');
    });

    it('should pass userId and userMessage to graph invoke', async () => {
      const payload = { userId: 'user-123', message: 'Hello coach!' };
      const validKey = createTestApiKey();

      await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': validKey },
        payload,
      });

      expect(stubGraph.invoke).toHaveBeenCalledWith(
        { userId: 'user-123', userMessage: 'Hello coach!' },
        { configurable: { thread_id: 'user-123' } },
      );
    });

    it('should return responseMessage from graph as content', async () => {
      stubGraph.invoke.mockResolvedValueOnce({
        userId: 'u1',
        phase: 'chat',
        userMessage: 'hi',
        responseMessage: 'Custom stub response',
        user: null,
        activeSessionId: null,
        requestedTransition: null,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': createTestApiKey() },
        payload: { userId: 'u1', message: 'hi' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.content).toBe('Custom stub response');
    });
  });

  describe('error handling', () => {
    it('should return 400 when required fields are missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': createTestApiKey() },
        payload: {},
      });

      expect([400, 500]).toContain(res.statusCode);
      expect(res.json()).toHaveProperty('error');
    });

    it('should return 500 when graph throws', async () => {
      stubGraph.invoke.mockRejectedValueOnce(new Error('Graph failure'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': createTestApiKey() },
        payload: { userId: 'u1', message: 'hi' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error.message).toBe('Processing failed');
    });
  });

  describe('request validation', () => {
    it('should reject empty message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { 'x-api-key': createTestApiKey() },
        payload: { userId: 'test-user', message: '' },
      });

      expect([400, 422]).toContain(res.statusCode);
    });
  });
});
