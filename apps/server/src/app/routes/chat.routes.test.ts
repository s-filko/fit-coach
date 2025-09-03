import { buildServer } from '@app/server';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { ILLMService } from '@infra/ai/llm.service';

// Mock LLM service for tests
class MockLLMService implements ILLMService {
  async generateResponse(message: string): Promise<string> {
    return `Mock AI response to: ${message}`;
  }

  async generateRegistrationResponse(message: string, context?: string): Promise<string> {
    return `Mock registration response to: ${message}`;
  }
}

describe('chat routes', () => {
  const app = buildServer();

  let validKey: string;

  beforeAll(async () => {
    validKey = process.env.BOT_API_KEY!;
    // Override services with mocks for tests
    const container = Container.getInstance();
    container.register(TOKENS.LLM, new MockLLMService());
    container.register(TOKENS.USER_SERVICE, {
      getUser: jest.fn().mockResolvedValue({
        id: 'test-user',
        profileStatus: 'complete'
      }),
      isRegistrationComplete: jest.fn().mockReturnValue(true),
      updateProfileData: jest.fn()
    });
    container.register(TOKENS.REGISTRATION_SERVICE, {
      processUserMessage: jest.fn().mockResolvedValue({
        updatedUser: { id: 'test-user' },
        response: 'Mock response',
        isComplete: true
      })
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('chat endpoint accepts POST requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'X-Api-Key': validKey },
      payload: { userId: 'test-user', message: 'Hello AI!' }
    });

    expect(res.statusCode).toBe(200);
    const response = res.json();
    expect(response.data).toHaveProperty('content');
    expect(response.data).toHaveProperty('timestamp');
    expect(response.data.content).toBe('Mock AI response to: Hello AI!');
  });
});
