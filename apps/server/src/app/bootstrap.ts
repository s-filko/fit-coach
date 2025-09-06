import dotenv from 'dotenv';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { buildServer } from '@app/server';
import { loadConfig } from '@infra/config';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
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
  c.register(TOKENS.USER_REPO, new DrizzleUserRepository());
  c.registerFactory(TOKENS.USER_SERVICE, c => new UserService(c.get(TOKENS.USER_REPO)));
  c.register(TOKENS.PROMPT_SERVICE, new PromptService());
  c.registerFactory(
    TOKENS.PROFILE_PARSER,
    c => new ProfileParserService(c.get(TOKENS.PROMPT_SERVICE), c.get(TOKENS.LLM)),
  );
  c.registerFactory(
    TOKENS.REGISTRATION_SERVICE,
    c =>
      new RegistrationService(
        c.get(TOKENS.PROFILE_PARSER),
        c.get(TOKENS.PROMPT_SERVICE),
        c.get(TOKENS.LLM),
      ),
  );
  c.registerFactory(TOKENS.LLM, c => {
    const llmService = new LLMService();
    llmService.setPromptService(c.get(TOKENS.PROMPT_SERVICE));
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
