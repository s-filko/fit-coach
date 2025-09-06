import dotenv from 'dotenv';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { buildServer } from '@app/server';
import { loadConfig } from '@infra/config';
import { Container } from '@infra/di/container';
import { 
  USER_REPOSITORY_TOKEN,
  USER_SERVICE_TOKEN,
  REGISTRATION_SERVICE_TOKEN,
  PROFILE_PARSER_SERVICE_TOKEN,
  PROMPT_SERVICE_TOKEN,
} from '@domain/user/ports';
import { LLM_SERVICE_TOKEN } from '@domain/ai/ports';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { ensureSchema } from '@infra/db/init';
import { UserService } from '@domain/user/services/user.service';
import { ProfileParserService } from '@domain/user/services/profile-parser.service';
import { PromptService } from '@domain/user/services/prompt.service';
import { RegistrationService } from '@domain/user/services/registration.service';
import { LLMService } from '@infra/ai/llm.service';

export async function bootstrap(): Promise<void> {
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
  const config = loadConfig();

  const app: FastifyInstance = buildServer();

  // DI registration (MVP, in-memory)
  const c = Container.getInstance();

  await ensureSchema();
  c.register(USER_REPOSITORY_TOKEN, new DrizzleUserRepository());
  c.registerFactory(USER_SERVICE_TOKEN, c => new UserService(c.get(USER_REPOSITORY_TOKEN)));
  c.register(PROMPT_SERVICE_TOKEN, new PromptService());
  c.registerFactory(
    PROFILE_PARSER_SERVICE_TOKEN,
    c => new ProfileParserService(c.get(PROMPT_SERVICE_TOKEN), c.get(LLM_SERVICE_TOKEN)),
  );
  c.registerFactory(
    REGISTRATION_SERVICE_TOKEN,
    c =>
      new RegistrationService(
        c.get(PROFILE_PARSER_SERVICE_TOKEN),
        c.get(PROMPT_SERVICE_TOKEN),
        c.get(LLM_SERVICE_TOKEN),
      ),
  );
  c.registerFactory(LLM_SERVICE_TOKEN, c => {
    const llmService = new LLMService();
    llmService.setPromptService(c.get(PROMPT_SERVICE_TOKEN));
    return llmService;
  });

  const port = config.PORT;
  const host = process.env.HOST;

  try {
    await app.ready();
    await app.listen({ port, host });
    app.log.info(`Server running on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
