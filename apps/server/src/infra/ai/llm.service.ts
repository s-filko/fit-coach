import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

import { LLMService as ILLMService, type LLMRequest, type LLMResponse } from '@domain/ai/ports';
import { ChatMsg, IPromptService } from '@domain/user/ports';

import { loadConfig } from '@config/index';

export class LLMService implements ILLMService {
  private model: ChatOpenAI;
  private promptService?: IPromptService;
  private config = loadConfig();
  private isDebugMode = false;
  private requestHistory: LLMRequest[] = [];
  private responseHistory: LLMResponse[] = [];

  // Performance and memory optimization
  private readonly MAX_HISTORY_SIZE = 100;
  private metrics = {
    totalRequests: 0,
    totalErrors: 0,
    totalTokens: 0,
    totalProcessingTime: 0,
  };

  constructor() {
    const modelName = this.config.OPENAI_MODEL ?? 'gpt-4o-mini';
    const temperature = 0.7;

    this.model = new ChatOpenAI({
      model: modelName,
      temperature,
      apiKey: this.config.OPENAI_API_KEY,
    });

    this.isDebugMode = this.config.LLM_DEBUG ?? false;
  }

  setPromptService(promptService: IPromptService): void {
    this.promptService = promptService;
  }

  async generateResponse(message: ChatMsg[], isRegistration: boolean = false): Promise<string> {
    if (isRegistration) {
      return this.generateRegistrationResponse(message);
    }

    if (!this.promptService) {
      throw new Error('PromptService not initialized. Call setPromptService() before using chat responses.');
    }

    const systemPromptText = this.promptService.buildChatSystemPrompt();
    return this.invokeModel(message, systemPromptText, 'chat');
  }

  async generateRegistrationResponse(message: ChatMsg[], context?: string): Promise<string> {
    if (!this.promptService) {
      throw new Error('PromptService not initialized. Call setPromptService() before using registration responses.');
    }

    const systemPromptText = this.promptService.buildRegistrationSystemPrompt(context);
    return this.invokeModel(message, systemPromptText, 'registration', context);
  }

  // Debug methods
  getDebugInfo() {
    const avgResponseTime = this.metrics.totalRequests > 0
      ? this.metrics.totalProcessingTime / this.metrics.totalRequests
      : 0;

    const errorRate = this.metrics.totalRequests > 0
      ? (this.metrics.totalErrors / this.metrics.totalRequests) * 100
      : 0;

    return {
      model: this.model.model,
      temperature: this.model.temperature ?? 0.7,
      isDebugMode: this.isDebugMode,
      requestHistory: this.requestHistory.slice(-50),
      responseHistory: this.responseHistory.slice(-50),
      metrics: {
        totalRequests: this.metrics.totalRequests,
        totalErrors: this.metrics.totalErrors,
        totalTokens: this.metrics.totalTokens,
        averageResponseTime: Math.round(avgResponseTime),
        errorRate: Math.round(errorRate * 100) / 100,
      },
    };
  }

  enableDebugMode(): void {
    this.isDebugMode = true;
  }

  disableDebugMode(): void {
    this.isDebugMode = false;
  }

  clearHistory(): void {
    this.requestHistory = [];
    this.responseHistory = [];
    this.metrics = {
      totalRequests: 0,
      totalErrors: 0,
      totalTokens: 0,
      totalProcessingTime: 0,
    };
  }

  // Core invocation logic — shared between chat and registration
  private async invokeModel(
    message: ChatMsg[],
    systemPromptText: string,
    label: 'chat' | 'registration',
    context?: string,
  ): Promise<string> {
    const requestId = this.generateId();
    const startTime = new Date();
    const isRegistration = label === 'registration';

    try {
      const systemPrompt = new SystemMessage(systemPromptText);

      const messages = message.map(chatMsg => {
        if (chatMsg.role === 'system') {
          return new SystemMessage(chatMsg.content);
        }
        return new HumanMessage(chatMsg.content);
      });

      if (this.isDebugMode) {
        const request: LLMRequest = {
          id: requestId,
          timestamp: startTime,
          message: message.map(m => `${m.role}: ${m.content}`).join('\n'),
          isRegistration,
          context,
          systemPrompt: systemPromptText,
          model: this.model.model,
          temperature: this.model.temperature ?? 0.7,
        };
        this.addToHistory(this.requestHistory, request);
      }

      const response = await this.model.invoke([systemPrompt, ...messages]);
      const endTime = new Date();
      const processingTime = endTime.getTime() - startTime.getTime();

      const content = response.content as string;
      const tokenUsage = (response.response_metadata as Record<string, unknown>)?.tokenUsage as
        { totalTokens?: number } | undefined;

      this.metrics.totalRequests++;
      this.metrics.totalProcessingTime += processingTime;
      if (tokenUsage?.totalTokens) {
        this.metrics.totalTokens += tokenUsage.totalTokens;
      }

      if (this.isDebugMode) {
        const llmResponse: LLMResponse = {
          id: this.generateId(),
          timestamp: endTime,
          requestId,
          content,
          tokenUsage: tokenUsage ? {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: tokenUsage.totalTokens ?? 0,
          } : undefined,
          model: this.model.model,
          processingTime,
        };
        this.addToHistory(this.responseHistory, llmResponse);
      }

      return content;
    } catch (error) {
      this.metrics.totalErrors++;
      const originalMessage = error instanceof Error ? error.message : String(error);
      const errorLabel = isRegistration ? 'registration response' : 'AI response';
      throw new Error(`Failed to generate ${errorLabel}: ${originalMessage}`);
    }
  }

  private generateId(): string {
    return `llm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private addToHistory<T>(array: T[], item: T): void {
    array.push(item);
    if (array.length > this.MAX_HISTORY_SIZE) {
      array.splice(0, array.length - this.MAX_HISTORY_SIZE);
    }
  }
}
