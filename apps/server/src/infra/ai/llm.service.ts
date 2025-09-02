import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface ILLMService {
  generateResponse(message: string): Promise<string>;
}

export class LLMService implements ILLMService {
  private model: ChatOpenAI;

  constructor() {
    // Initialize OpenAI model with basic configuration
    this.model = new ChatOpenAI({
      modelName: 'gpt-3.5-turbo',
      temperature: 0.7,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateResponse(message: string): Promise<string> {
    try {
      const systemPrompt = new SystemMessage(
        'Ты дружелюбный AI тренер по фитнесу. Отвечай на сообщения пользователей кратко, мотивирующе и по-дружески. Не собирай данные профиля, просто поддерживай разговор как хороший тренер.'
      );

      const humanMessage = new HumanMessage(message);

      const response = await this.model.invoke([systemPrompt, humanMessage]);

      return response.content as string;
    } catch (error) {
      console.error('Error generating AI response:', error);
      throw new Error('Failed to generate AI response');
    }
  }
}
