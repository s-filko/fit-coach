import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { serializerCompiler, validatorCompiler, ZodTypeProvider, jsonSchemaTransform } from 'fastify-type-provider-zod';
import { registerErrorHandler } from '@app/middlewares/error';
import { apiKeyPreHandler } from '@app/middlewares/api-key';
import { registerUserRoutes } from '@app/routes/user.routes';
import { registerChatRoutes } from '@app/routes/chat.routes';
import { Container } from '@infra/di/container';
import { 
  USER_SERVICE_TOKEN,
  PROFILE_PARSER_SERVICE_TOKEN,
  REGISTRATION_SERVICE_TOKEN,
  UserService,
  IProfileParserService,
  IRegistrationService,
} from '@domain/user/ports';
import { LLM_SERVICE_TOKEN, LLMService } from '@domain/ai/ports';
import { User, ParsedProfileData } from '@domain/user/services/user.service';

export function buildServer(): FastifyInstance {
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

  // Static files
  const __dirname = path.resolve();
  app.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/public/',
  });

  // LLM Debug Monitor route
  app.get('/debug', async(request, reply) => {
    return reply.redirect('/public/llm-debug.html');
  });

  // health
  app.get('/health', async() => ({ status: 'ok' }));

  // test route
  app.get('/test', async() => ({ message: 'Server is working' }));

  // test config route
  app.get('/test-config', async() => {
    const { loadConfig } = await import('@infra/config');
    const config = loadConfig();
    return {
      botApiKey: config.BOT_API_KEY,
      nodeEnv: config.NODE_ENV,
      port: config.PORT,
    };
  });

  // test DI route
  app.get('/test-di', async() => {
    const container = Container.getInstance();
    const userService = container.get<UserService>(USER_SERVICE_TOKEN);
    return { message: 'DI is working', hasUserService: !!userService };
  });

  // test user creation without DB
  app.get('/test-user', async() => {
    const container = Container.getInstance();
    const userService = container.get<UserService>(USER_SERVICE_TOKEN);
    try {
      const user = await userService.upsertUser({
        provider: 'telegram',
        providerUserId: 'test_user_123',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en',
      });
      return { success: true, user: { id: user.id, username: user.username } };
    } catch (error) {
      app.log.error({ err: error }, 'User upsert failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test parser
  app.post('/test-parser', async req => {
    const container = Container.getInstance();
    const parserService = container.get<IProfileParserService>(PROFILE_PARSER_SERVICE_TOKEN);
    const { message } = req.body as { message: string };

    try {
      const result = await parserService.parseProfileData({ id: 'test' } as User, message);
      return { success: true, parsed: result };
    } catch (error) {
      req.log.error({ err: error }, 'Registration flow failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test full registration flow
  app.post('/test-registration-flow', async req => {
    const container = Container.getInstance();
    const registrationService = container.get<IRegistrationService>(REGISTRATION_SERVICE_TOKEN);
    const userService = container.get<UserService>(USER_SERVICE_TOKEN);
    const { userId, message } = req.body as { userId: string; message: string };

    try {
      const user = await userService.getUser(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

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
          profileStatus: updatedUser?.profileStatus,
        },
      };
    } catch (error) {
      req.log.error({ err: error }, 'LLM response failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test LLM
  app.post('/test-llm', async req => {
    const container = Container.getInstance();
    const llmService = container.get<LLMService>(LLM_SERVICE_TOKEN);
    const { message } = req.body as { message: string };

    try {
      const result = await llmService.generateResponse([{ role: 'user', content: message }], false);
      return { success: true, response: result };
    } catch (error) {
      req.log.error({ err: error }, 'Mock save failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test data save with mock parsed data
  app.post('/test-save-mock', async req => {
    const container = Container.getInstance();
    const userService = container.get<UserService>(USER_SERVICE_TOKEN);
    const registrationService = container.get<IRegistrationService>(REGISTRATION_SERVICE_TOKEN);
    const { userId } = req.body as { userId: string };

    try {
      const user = await userService.getUser(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Simulate the registration service logic with mock data
      const result = await registrationService.processUserMessage(user, 'test message');

      return {
        success: true,
        user: result.updatedUser,
        response: result.response,
        isComplete: result.isComplete,
      };
    } catch (error) {
      req.log.error({ err: error }, 'Direct profile save failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test direct profile data save
  app.post('/test-profile-save', async req => {
    const container = Container.getInstance();
    const userService = container.get<UserService>(USER_SERVICE_TOKEN);
    const { userId, profileData } = req.body as { userId: string; profileData: Partial<User> };

    try {
      const user = await userService.getUser(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Save profile data directly
      const updatedUser = await userService.updateProfileData(userId, profileData);

      return { success: true, user: updatedUser };
    } catch (error) {
      req.log.error({ err: error }, 'Mock parser JSON failed');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // test parser with mock JSON
  app.post('/test-parser-mock', async req => {
    const { mockJson } = req.body as { mockJson: string };

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

  // security guard on protected routes (exclude OPTIONS and public routes)
  app.addHook('preHandler', async(request, reply) => {
    // Skip API key check for OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      return;
    }

    // Skip API key check for public routes
    if (request.url === '/health' || request.url.startsWith('/docs') || request.url.startsWith('/test')) {
      return;
    }

    // Apply API key check for protected routes
    await apiKeyPreHandler(request, reply);
  });

  registerErrorHandler(app);

  // routes
  app.register(async instance => {
    await registerUserRoutes(instance);
    await registerChatRoutes(instance);
  });

  return app;
}
