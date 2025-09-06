import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatMsg, IPromptService } from '@domain/user/ports';
import { loadConfig } from '@infra/config';
import { LLMService as ILLMService } from '@domain/ai/ports';

// Debug types
export interface LLMRequest {
  id: string;
  timestamp: Date;
  message: string;
  isRegistration: boolean;
  context?: string;
  systemPrompt?: string;
  model: string;
  temperature: number;
}

export interface LLMResponse {
  id: string;
  timestamp: Date;
  requestId: string;
  content: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  processingTime: number;
}

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
    // Use OPENAI_MODEL env var for flexible model selection
    // Falls back to gpt-4o-mini (cheapest) if not specified
    const modelName = this.config.OPENAI_MODEL ?? 'gpt-4o-mini';
    const temperature = 0.7;

    this.model = new ChatOpenAI({
      model: modelName,
      temperature,
      apiKey: this.config.OPENAI_API_KEY,
    });

    // Enable debug mode if environment variable is set
    this.isDebugMode = this.config.LLM_DEBUG ?? false;

    // Initialize logging
  }

  setPromptService(promptService: IPromptService): void {
    this.promptService = promptService;
  }

  async generateResponse(message: ChatMsg[], isRegistration: boolean = false): Promise<string> {
    if (isRegistration) {
      return this.generateRegistrationResponse(message);
    }

    const requestId = this.generateId();
    const startTime = new Date();

    try {
      if (!this.promptService) {
        throw new Error('PromptService not initialized. Call setPromptService() before using chat responses.');
      }

      const systemPromptText = this.promptService.buildChatSystemPrompt();
      const systemPrompt = new SystemMessage(systemPromptText);

      // Convert ChatMsg[] to LangChain messages
      const messages = message.map(chatMsg => {
        if (chatMsg.role === 'system') {
          return new SystemMessage(chatMsg.content);
        } else if (chatMsg.role === 'user') {
          return new HumanMessage(chatMsg.content);
        } else {
          return new HumanMessage(chatMsg.content); // assistant messages as human for simplicity
        }
      });

      // Log request if debug mode
      if (this.isDebugMode) {
        const request: LLMRequest = {
          id: requestId,
          timestamp: startTime,
          message: message.map(m => `${m.role}: ${m.content}`).join('\n'),
          isRegistration: false,
          systemPrompt: systemPromptText,
          model: this.model.model,
          temperature: this.model.temperature ?? 0.7,
        };
        this.addToHistory(this.requestHistory, request);
        this.logDebug('LLM Request', request);
      }

      const response = await this.model.invoke([systemPrompt, ...messages]);
      const endTime = new Date();
      const processingTime = endTime.getTime() - startTime.getTime();

      const content = response.content as string;
      const tokenUsage = (response.response_metadata as Record<string, unknown>)?.tokenUsage as 
        { totalTokens?: number } | undefined;

      // Update metrics
      this.metrics.totalRequests++;
      this.metrics.totalProcessingTime += processingTime;
      if (tokenUsage?.totalTokens) {
        this.metrics.totalTokens += tokenUsage.totalTokens;
      }

      // Log response if debug mode
      if (this.isDebugMode) {
        const llmResponse: LLMResponse = {
          id: this.generateId(),
          timestamp: endTime,
          requestId,
          content,
          tokenUsage: tokenUsage ? {
            promptTokens: 0, // We don't have this info from the API
            completionTokens: 0, // We don't have this info from the API
            totalTokens: tokenUsage.totalTokens ?? 0,
          } : undefined,
          model: this.model.model,
          processingTime,
        };
        this.addToHistory(this.responseHistory, llmResponse);
        this.logDebug('LLM Response', llmResponse);
      }

      return content;
    } catch (error) {
      this.metrics.totalErrors++;

      // Log error if debug mode
      if (this.isDebugMode) {
        this.logDebug('LLM Error', {
          requestId,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
      }

      throw new Error('Failed to generate AI response');
    }
  }

  async generateRegistrationResponse(message: ChatMsg[], context?: string): Promise<string> {
    const requestId = this.generateId();
    const startTime = new Date();

    try {
      if (!this.promptService) {
        throw new Error('PromptService not initialized. Call setPromptService() before using registration responses.');
      }

      const systemPromptText = this.promptService.buildRegistrationSystemPrompt(context);
      const systemMessage = new SystemMessage(systemPromptText);

      // Convert ChatMsg[] to LangChain messages
      const messages = message.map(chatMsg => {
        if (chatMsg.role === 'system') {
          return new SystemMessage(chatMsg.content);
        } else if (chatMsg.role === 'user') {
          return new HumanMessage(chatMsg.content);
        } else {
          return new HumanMessage(chatMsg.content); // assistant messages as human for simplicity
        }
      });

      // Log request if debug mode
      if (this.isDebugMode) {
        const request: LLMRequest = {
          id: requestId,
          timestamp: startTime,
          message: message.map(m => `${m.role}: ${m.content}`).join('\n'),
          isRegistration: true,
          context,
          systemPrompt: systemPromptText,
          model: this.model.model,
          temperature: this.model.temperature ?? 0.7,
        };
        this.addToHistory(this.requestHistory, request);
        this.logDebug('LLM Registration Request', request);
      }

      const response = await this.model.invoke([systemMessage, ...messages]);
      const endTime = new Date();
      const processingTime = endTime.getTime() - startTime.getTime();

      const content = response.content as string;
      const tokenUsage = (response.response_metadata as Record<string, unknown>)?.tokenUsage as 
        { totalTokens?: number } | undefined;

      // Update metrics
      this.metrics.totalRequests++;
      this.metrics.totalProcessingTime += processingTime;
      if (tokenUsage?.totalTokens) {
        this.metrics.totalTokens += tokenUsage.totalTokens;
      }

      // Log response if debug mode
      if (this.isDebugMode) {
        const llmResponse: LLMResponse = {
          id: this.generateId(),
          timestamp: endTime,
          requestId,
          content,
          tokenUsage: tokenUsage ? {
            promptTokens: 0, // We don't have this info from the API
            completionTokens: 0, // We don't have this info from the API
            totalTokens: tokenUsage.totalTokens ?? 0,
          } : undefined,
          model: this.model.model,
          processingTime,
        };
        this.addToHistory(this.responseHistory, llmResponse);
        this.logDebug('LLM Registration Response', llmResponse);
      }

      return content;
    } catch (error) {
      this.metrics.totalErrors++;

      // Log error if debug mode
      if (this.isDebugMode) {
        this.logDebug('LLM Registration Error', {
          requestId,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
      }

      throw new Error('Failed to generate registration response');
    }
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
      requestHistory: this.requestHistory.slice(-50), // Last 50 requests
      responseHistory: this.responseHistory.slice(-50), // Last 50 responses
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

  // Helper methods
  private generateId(): string {
    return `llm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private addToHistory<T>(array: T[], item: T): void {
    array.push(item);
    if (array.length > this.MAX_HISTORY_SIZE) {
      array.splice(0, array.length - this.MAX_HISTORY_SIZE);
    }
  }

  private logDebug(label: string, data: unknown): void {
    if (label.includes('Request')) {
      this.logRequest(data);
    } else if (label.includes('Response')) {
      this.logResponse(data);
    } else if (label.includes('Error')) {
      this.logError(data);
    }
  }

  private logRequest(request: unknown): void { void request; }

  private logResponse(response: unknown): void { void response; }

  private logError(error: unknown): void { void error; }
}
