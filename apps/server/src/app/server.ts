import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, ZodTypeProvider, jsonSchemaTransform } from 'fastify-type-provider-zod';
import { registerErrorHandler } from '@app/middlewares/error';
import { apiKeyPreHandler } from '@app/middlewares/api-key';
import { registerUserRoutes } from '@app/routes/user.routes';
import { registerChatRoutes } from '@app/routes/chat.routes';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { UserService } from '@domain/user/services/user.service';
import { IProfileParserService } from '@domain/user/services/profile-parser.service';
import { IRegistrationService } from '@domain/user/services/registration.service';
import { ILLMService, LLMService } from '@infra/ai/llm.service';

export function buildServer() {
  const app = Fastify({
    logger: {
      level: 'info',
      transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    requestTimeout: 30000,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, { origin: true });
  app.register(sensible);
  app.register(swagger, {
    mode: 'dynamic',
    openapi: {
      openapi: '3.0.3',
      info: { title: 'Fit Coach API', version: '1.0.0' },
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Api-Key',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  // health
  app.get('/health', async () => ({ status: 'ok' }));

  // test route
  app.get('/test', async () => ({ message: 'Server is working' }));

  // test config route
  app.get('/test-config', async () => {
    const { loadConfig } = await import('@infra/config');
    const config = loadConfig();
    return {
      botApiKey: config.BOT_API_KEY,
      nodeEnv: config.NODE_ENV,
      port: config.PORT
    };
  });

  // test DI route
  app.get('/test-di', async () => {
    const container = Container.getInstance();
    const userService = container.get<UserService>(TOKENS.USER_SERVICE);
    return { message: 'DI is working', hasUserService: !!userService };
  });

  // test user creation without DB
  app.get('/test-user', async () => {
    const container = Container.getInstance();
    const userService = container.get<UserService>(TOKENS.USER_SERVICE);
    try {
      const user = await userService.upsertUser({
        provider: 'telegram',
        providerUserId: 'test_user_123',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en'
      });
      return { success: true, user: { id: user.id, username: user.username } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test parser
  app.post('/test-parser', async (req) => {
    const container = Container.getInstance();
    const parserService = container.get<IProfileParserService>(TOKENS.PROFILE_PARSER);
    const { message } = req.body as { message: string };

    try {
      const result = await parserService.parseProfileData(message);
      return { success: true, parsed: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test full registration flow
  app.post('/test-registration-flow', async (req) => {
    const container = Container.getInstance();
    const registrationService = container.get<IRegistrationService>(TOKENS.REGISTRATION_SERVICE);
    const userService = container.get<UserService>(TOKENS.USER_SERVICE);
    const { userId, message } = req.body as { userId: string; message: string };

    try {
      const user = await userService.getUser(userId);
      if (!user) return { success: false, error: 'User not found' };

      const result = await registrationService.processUserMessage(user, message);

      // Get updated user data
      const updatedUser = await userService.getUser(userId);

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
          profileStatus: updatedUser?.profileStatus
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test LLM
  app.post('/test-llm', async (req) => {
    const container = Container.getInstance();
    const llmService = container.get<ILLMService>(TOKENS.LLM);
    const { message } = req.body as { message: string };

    try {
      const result = await llmService.generateResponse(message, false);
      return { success: true, response: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test data save with mock parsed data
  app.post('/test-save-mock', async (req) => {
    const container = Container.getInstance();
    const userService = container.get<UserService>(TOKENS.USER_SERVICE);
    const registrationService = container.get<IRegistrationService>(TOKENS.REGISTRATION_SERVICE);
    const { userId, mockParsedData } = req.body as any;

    try {
      const user = await userService.getUser(userId);
      if (!user) return { success: false, error: 'User not found' };

      // Simulate the registration service logic with mock data
      const result = await registrationService.processUserMessage(user, 'test message');

      return {
        success: true,
        user: result.updatedUser,
        response: result.response,
        isComplete: result.isComplete
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test direct profile data save
  app.post('/test-profile-save', async (req) => {
    const container = Container.getInstance();
    const userService = container.get<UserService>(TOKENS.USER_SERVICE);
    const { userId, profileData } = req.body as any;

    try {
      const user = await userService.getUser(userId);
      if (!user) return { success: false, error: 'User not found' };

      // Save profile data directly
      const updatedUser = await userService.updateProfileData(userId, profileData);

      return { success: true, user: updatedUser };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test parser with mock JSON
  app.post('/test-parser-mock', async (req) => {
    const { mockJson } = req.body as any;

    try {
      // Simulate parsing JSON response from LLM
      const parsedResult = JSON.parse(mockJson);

      // Validate the result structure (same logic as in parser)
      const result = {
        age: parsedResult.age,
        gender: parsedResult.gender,
        height: parsedResult.height,
        weight: parsedResult.weight,
        fitnessLevel: parsedResult.fitnessLevel,
        fitnessGoal: parsedResult.fitnessGoal
      };

      return { success: true, parsed: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // security guard on protected routes
  app.addHook('preHandler', apiKeyPreHandler);

  registerErrorHandler(app);

  // routes
  app.register(async (instance) => {
    await registerUserRoutes(instance);
    await registerChatRoutes(instance);
  });

  return app;
}


