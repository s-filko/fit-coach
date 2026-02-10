import { LLMService } from '@domain/ai/ports';
import { ChatMsg, IChatService, IPromptService } from '@domain/user/ports';

import { User } from './user.service';

export class ChatService implements IChatService {
  constructor(
    private readonly promptService: IPromptService,
    private readonly llmService: LLMService,
  ) {}

  async processMessage(user: User, message: string, historyMessages: ChatMsg[] = []): Promise<string> {
    const systemPrompt = this.promptService.buildChatSystemPrompt(user);
    const messages: ChatMsg[] = [
      ...historyMessages,
      { role: 'user', content: message },
    ];
    return this.llmService.generateWithSystemPrompt(messages, systemPrompt);
  }
}
