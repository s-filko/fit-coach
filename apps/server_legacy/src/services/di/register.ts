import { Container } from './injectable';
import { UserDbService } from '@db/services/user-db.service';
import { TrainingContextDbService } from '@db/services/training-context-db.service';
import { SessionDbService } from '@db/services/session-db.service';
import { LLMService } from '@services/ai/llm.service';
import { AIContextService } from '@services/ai/context.service';
import { UserService } from '@services/user.service';
import { dbConnectionPromise } from '@db/db';

export async function registerServices() {
  console.log('Starting service registration...');
  
  try {
    // Wait for database connection
    console.log('Waiting for database connection...');
    await dbConnectionPromise;
    console.log('Database connection established');

    const container = Container.getInstance();
    console.log('Container instance obtained');

    // Register database services first
    console.log('Registering database services...');
    container.register('UserDbService', new UserDbService());
    console.log('UserDbService registered');

    container.register('TrainingContextDbService', new TrainingContextDbService());
    console.log('TrainingContextDbService registered');

    container.register('SessionDbService', new SessionDbService());
    console.log('SessionDbService registered');

    // Register AI services
    console.log('Registering AI services...');
    container.register('LLMService', new LLMService());
    console.log('LLMService registered');

    // Register factories for services with dependencies
    container.registerFactory('AIContextService', (container) => {
      return new AIContextService(
        container.get('LLMService'),
        container.get('TrainingContextDbService')
      );
    });
    console.log('AIContextService factory registered');

    container.registerFactory('UserService', (container) => {
      return new UserService(container.get('UserDbService'));
    });
    console.log('UserService factory registered');

    console.log('All services registered successfully');
  } catch (error) {
    console.error('Error during service registration:', error);
    throw error;
  }
} 