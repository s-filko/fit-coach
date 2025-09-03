import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { IPromptService } from '@domain/user/services/prompt.service';

export interface ILLMService {
  generateResponse(message: string, isRegistration?: boolean): Promise<string>;
  generateRegistrationResponse(message: string, context?: string): Promise<string>;
}

export class LLMService implements ILLMService {
  private model: ChatOpenAI;
  private promptService?: IPromptService;

  constructor() {
    // Use OPENAI_MODEL env var for flexible model selection
    // Falls back to gpt-4o-mini (cheapest) if not specified
    const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    this.model = new ChatOpenAI({
      model: modelName,
      temperature: 0.7,
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  setPromptService(promptService: IPromptService): void {
    this.promptService = promptService;
  }

  async generateResponse(message: string, isRegistration: boolean = false): Promise<string> {
    if (isRegistration) {
      return this.generateRegistrationResponse(message);
    }

    try {
      if (!this.promptService) {
        throw new Error('PromptService not initialized. Call setPromptService() before using chat responses.');
      }

      const systemPrompt = new SystemMessage(this.promptService.buildChatSystemPrompt());
      const humanMessage = new HumanMessage(message);

      const response = await this.model.invoke([systemPrompt, humanMessage]);

      return response.content as string;
    } catch (error) {
      console.error('Error generating AI response:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  async generateRegistrationResponse(message: string, context?: string): Promise<string> {
    try {
      if (!this.promptService) {
        throw new Error('PromptService not initialized. Call setPromptService() before using registration responses.');
      }

      const systemPrompt = this.promptService.buildRegistrationSystemPrompt(context);
      const systemMessage = new SystemMessage(systemPrompt);
      const humanMessage = new HumanMessage(message);

      const response = await this.model.invoke([systemMessage, humanMessage]);

      return response.content as string;
    } catch (error) {
      console.error('Error generating registration response:', error);
      throw new Error('Failed to generate registration response');
    }
  }
}
