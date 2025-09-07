import { FastifyInstance } from 'fastify';

import { ParsedProfileData, User } from '@domain/user/services/user.service';

/**
 * Test endpoints plugin
 * Provides test endpoints for development and debugging
 * Should be disabled in production
 */

export async function testPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.log.info('Test plugin registered');

  // Basic test endpoint
  fastify.get('/test', async() => ({ message: 'Server is working' }));

  // Test config endpoint
  fastify.get('/test-config', async() => {
    const { loadConfig } = await import('@config/index');
    const config = loadConfig();
    return {
      botApiKey: config.BOT_API_KEY,
      nodeEnv: config.NODE_ENV,
      port: config.PORT,
    };
  });

  // Test DI endpoint
  fastify.get('/test-di', async() => {
    return { message: 'DI is working', hasIUserService: !!fastify.services.userService };
  });

  // Test user creation without DB
  fastify.get('/test-user', async() => {
    const testUser = {
      id: 'test-user-123',
      telegramId: 123456789,
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return { message: 'Test user created', user: testUser };
  });

  // Test parser endpoint
  fastify.post('/test-parser', async(request) => {
    const { message } = request.body as { message: string };

    try {
      const result = await fastify.services.registrationService.processUserMessage({ id: 'test' } as User, message);
      return { success: true, parsed: result };
    } catch (error) {
      request.log.error({ err: error }, 'Registration flow failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Test full registration flow
  fastify.post('/test-registration-flow', async(request) => {
    const { userId, message } = request.body as { userId: string; message: string };

    try {
      const user = await fastify.services.userService.getUser(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const result = await fastify.services.registrationService.processUserMessage(user, message);

      // Get updated user data
      const updatedUser = await fastify.services.userService.getUser(userId);

      return {
        success: true,
        response: result.response,
        isComplete: result.isComplete,
        userData: {
          age: updatedUser?.age,
          gender: updatedUser?.gender,
          height: updatedUser?.height,
          weight: updatedUser?.weight,
          fitnessLevel: updatedUser?.fitnessLevel,
          fitnessGoal: updatedUser?.fitnessGoal,
          profileStatus: updatedUser?.profileStatus,
        },
      };
    } catch (error) {
      request.log.error({ err: error }, 'LLM response failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Test LLM
  fastify.post('/test-llm', async(request) => {
    const { message } = request.body as { message: string };

    try {
      const result = await fastify.services.llmService.generateResponse([{ role: 'user', content: message }], false);
      return { success: true, response: result };
    } catch (error) {
      request.log.error({ err: error }, 'Mock save failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Test data save with mock parsed data
  fastify.post('/test-save-mock', async(request) => {
    const { userId } = request.body as { userId: string };

    try {
      const user = await fastify.services.userService.getUser(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Simulate the registration service logic with mock data
      const result = await fastify.services.registrationService.processUserMessage(user, 'test message');

      return {
        success: true,
        user: result.updatedUser,
        response: result.response,
        isComplete: result.isComplete,
      };
    } catch (error) {
      request.log.error({ err: error }, 'Direct profile save failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Test direct profile data save
  fastify.post('/test-profile-save', async(request) => {
    const { userId, profileData } = request.body as { userId: string; profileData: Partial<User> };

    try {
      const user = await fastify.services.userService.getUser(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Save profile data directly
      const updatedUser = await fastify.services.userService.updateProfileData(userId, profileData);

      return { success: true, user: updatedUser };
    } catch (error) {
      request.log.error({ err: error }, 'Mock parser JSON failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Test parser with mock JSON
  fastify.post('/test-parser-mock', async(request) => {
    const { mockJson } = request.body as { mockJson: string };

    try {
      // Simulate parsing JSON response from LLM
      const parsedResult = JSON.parse(mockJson) as unknown;

      // Validate the result structure (same logic as in parser)
      const result: ParsedProfileData = {
        age: (parsedResult as Record<string, unknown>).age as number | null | undefined,
        gender: (parsedResult as Record<string, unknown>).gender as 'male' | 'female' | null | undefined,
        height: (parsedResult as Record<string, unknown>).height as number | null | undefined,
        weight: (parsedResult as Record<string, unknown>).weight as number | null | undefined,
        fitnessLevel: (parsedResult as Record<string, unknown>).fitnessLevel as string | null | undefined,
        fitnessGoal: (parsedResult as Record<string, unknown>).fitnessGoal as string | null | undefined,
      };

      return { success: true, parsed: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
