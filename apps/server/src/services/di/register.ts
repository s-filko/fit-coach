import { Container } from './injectable';
import { UserDbService } from '@db/services/user-db.service';
import { TrainingContextDbService } from '@db/services/training-context-db.service';
import { SessionDbService } from '@db/services/session-db.service';
import { LLMService } from '@services/ai/llm.service';
import { AIContextService } from '@services/ai/context.service';
import { UserService } from '@services/user.service';

export function registerServices() {
  const container = Container.getInstance();

  // Register database services
  container.register('UserDbService', new UserDbService());
  container.register('TrainingContextDbService', new TrainingContextDbService());
  container.register('SessionDbService', new SessionDbService());

  // Register AI services
  container.register('LLMService', new LLMService());
  container.register('AIContextService', container.resolve(AIContextService));

  // Register business services
  container.register('UserService', container.resolve(UserService));
} 