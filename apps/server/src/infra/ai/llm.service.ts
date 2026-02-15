import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

import { LLMService as ILLMService, type LLMRequest, type LLMResponse } from '@domain/ai/ports';
import { ChatMsg } from '@domain/user/ports';

import { loadConfig } from '@config/index';

export class LLMService implements ILLMService {
  private model: ChatOpenAI;
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
    const modelName = this.config.LLM_MODEL;
    const baseURL = this.config.LLM_API_URL?.trim();

    // Any OpenAI-compatible API: set LLM_API_URL (e.g. https://api.openrouter.ai/v1), LLM_API_KEY, LLM_MODEL
    this.model = new ChatOpenAI({
      model: modelName,
      temperature: this.config.LLM_TEMPERATURE,
      apiKey: this.config.LLM_API_KEY,
      ...(baseURL && {
        configuration: {
          baseURL: baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL,
        },
      }),
    });

    this.isDebugMode = this.config.LLM_DEBUG ?? false;
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

  async generateWithSystemPrompt(
    messages: ChatMsg[], systemPrompt: string, opts?: { jsonMode?: boolean },
  ): Promise<string> {
    return this.invokeModel(messages, systemPrompt, opts?.jsonMode);
  }

  async generateStructured<T>(
    messages: ChatMsg[],
    systemPrompt: string,
    schema: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ): Promise<T> {
    const requestId = this.generateId();
    const startTime = new Date();

    try {
      const systemMsg = new SystemMessage(systemPrompt);
      const chatMessages = messages.map(chatMsg => {
        if (chatMsg.role === 'system') {
          return new SystemMessage(chatMsg.content);
        }
        if (chatMsg.role === 'assistant') {
          return new AIMessage(chatMsg.content);
        }
        return new HumanMessage(chatMsg.content);
      });

      // Use response_format with json_object (compatible with OpenRouter)
      // Note: OpenRouter doesn't support json_schema, only json_object
      // The schema validation happens client-side after parsing
      const modelWithJsonMode = this.model.bind({
        response_format: {
          type: 'json_object',
        },
      });

      const result = await modelWithJsonMode.invoke([systemMsg, ...chatMessages]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(result.content as string);

      // Validate against schema
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const validated = schema.parse(parsed) as T;

      const endTime = new Date();
      const processingTime = endTime.getTime() - startTime.getTime();

      if (this.isDebugMode) {
        const response: LLMResponse = {
          id: this.generateId(),
          timestamp: endTime,
          requestId,
          content: JSON.stringify(validated),
          model: this.model.model,
          processingTime,
        };
        this.addToHistory(this.responseHistory, response);
        this.metrics.totalRequests++;
        this.metrics.totalProcessingTime += processingTime;
      }

      return validated;
    } catch (error) {
      this.metrics.totalErrors++;
      throw error;
    }
  }

  private async invokeModel(
    message: ChatMsg[],
    systemPromptText: string,
    jsonMode?: boolean,
  ): Promise<string> {
    const requestId = this.generateId();
    const startTime = new Date();

    try {
      // CRITICAL: Validate JSON mode configuration before API call
      // OpenAI/OpenRouter requires system prompt to mention "json" when using json_object format
      if (jsonMode) {
        const promptLower = systemPromptText.toLowerCase();
        if (!promptLower.includes('json')) {
          const error = new Error(
            'CONFIGURATION ERROR: JSON mode is enabled but system prompt does not mention "json". ' +
            'This will cause OpenAI/OpenRouter API error: "Response input messages must contain ' +
            'the word \'json\' in some form to use \'text.format\' of type \'json_object\'."',
          );
          // eslint-disable-next-line no-console
          console.error('\n=== JSON MODE VALIDATION ERROR ===');
          // eslint-disable-next-line no-console
          console.error('System prompt does not contain "json" but jsonMode=true');
          // eslint-disable-next-line no-console
          console.error('System prompt preview:', systemPromptText.slice(0, 200) + '...');
          throw error;
        }
      }

      const systemPrompt = new SystemMessage(systemPromptText);

      const messages = message.map(chatMsg => {
        if (chatMsg.role === 'system') {
          return new SystemMessage(chatMsg.content);
        }
        if (chatMsg.role === 'assistant') {
          return new AIMessage(chatMsg.content);
        }
        return new HumanMessage(chatMsg.content);
      });

      // Build the actual HTTP payload that will be sent to OpenRouter
      const httpPayload = {
        model: this.model.model,
        messages: [
          { role: 'system', content: systemPromptText },
          ...message.map(m => ({ role: m.role, content: m.content })),
        ],
        temperature: this.model.temperature ?? 0.7,
        ...(jsonMode && { response_format: { type: 'json_object' } }),
      };

      if (this.isDebugMode) {
        const request: LLMRequest = {
          id: requestId,
          timestamp: startTime,
          message: message.map(m => `${m.role}: ${m.content}`).join('\n'),
          isRegistration: false,
          systemPrompt: systemPromptText,
          model: this.model.model,
          temperature: this.model.temperature ?? 0.7,
          jsonMode,
          httpPayload, // Store full HTTP payload for debugging
        };
        this.addToHistory(this.requestHistory, request);
        
        // Log to console for immediate debugging
        // eslint-disable-next-line no-console
        console.log('\n=== LLM REQUEST ===');
        // eslint-disable-next-line no-console
        console.log('Request ID:', requestId);
        // eslint-disable-next-line no-console
        console.log('Model:', this.model.model);
        // eslint-disable-next-line no-console
        console.log('JSON Mode:', jsonMode);
        // eslint-disable-next-line no-console
        console.log('HTTP Payload:', JSON.stringify(httpPayload, null, 2));
        // eslint-disable-next-line no-console
        console.log('==================\n');
      }

      const model = jsonMode
        ? this.model.bind({ response_format: { type: 'json_object' } })
        : this.model;
      const response = await model.invoke([systemPrompt, ...messages]);
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
          httpResponse: response.response_metadata, // Store full HTTP response metadata
        };
        this.addToHistory(this.responseHistory, llmResponse);
        
        // Log to console for immediate debugging
        // eslint-disable-next-line no-console
        console.log('\n=== LLM RESPONSE ===');
        // eslint-disable-next-line no-console
        console.log('Request ID:', requestId);
        // eslint-disable-next-line no-console
        console.log('Processing Time:', processingTime, 'ms');
        // eslint-disable-next-line no-console
        console.log('Token Usage:', tokenUsage);
        // eslint-disable-next-line no-console
        console.log('Content Length:', content.length);
        // eslint-disable-next-line no-console
        console.log('Content Preview:', content.substring(0, 200));
        // eslint-disable-next-line no-console
        console.log('Full Response Metadata:', JSON.stringify(response.response_metadata, null, 2));
        // eslint-disable-next-line no-console
        console.log('====================\n');
      }

      return content;
    } catch (error) {
      this.metrics.totalErrors++;
      const originalMessage = error instanceof Error ? error.message : String(error);
      
      // Extract provider error details if available
      let providerError = '';
      if (error && typeof error === 'object' && 'error' in error) {
        const errObj = error as { error?: { message?: string; metadata?: { raw?: string } } };
        if (errObj.error?.message) {
          providerError = errObj.error.message;
        }
        if (errObj.error?.metadata?.raw) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const rawError = JSON.parse(errObj.error.metadata.raw);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (rawError.error?.message) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              providerError = String(rawError.error.message);
            }
          } catch {
            // Ignore JSON parse errors
          }
        }
      }
      
      if (this.isDebugMode) {
        const errorResponse: LLMResponse = {
          id: this.generateId(),
          timestamp: new Date(),
          requestId,
          content: '',
          error: originalMessage,
          model: this.model.model,
          processingTime: new Date().getTime() - startTime.getTime(),
          providerError,
        };
        this.addToHistory(this.responseHistory, errorResponse);
        
        // Log error details to console
        // eslint-disable-next-line no-console
        console.error('\n=== LLM ERROR ===');
        // eslint-disable-next-line no-console
        console.error('Request ID:', requestId);
        // eslint-disable-next-line no-console
        console.error('Error:', originalMessage);
        if (providerError) {
          // eslint-disable-next-line no-console
          console.error('Provider Error:', providerError);
        }
        // eslint-disable-next-line no-console
        console.error('Full Error:', error);
        if (error && typeof error === 'object') {
          // eslint-disable-next-line no-console
          console.error('Error Details:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
        }
        // eslint-disable-next-line no-console
        console.error('=================\n');
      }
      
      // Always log provider errors even when debug mode is off
      if (providerError && !this.isDebugMode) {
        // eslint-disable-next-line no-console
        console.error(`LLM Provider Error: ${providerError}`);
      }
      
      // Include provider error in thrown message for better error reporting
      const errorMessage = providerError 
        ? `Failed to generate LLM response: ${originalMessage} (Provider: ${providerError})`
        : `Failed to generate LLM response: ${originalMessage}`;
      
      throw new Error(errorMessage);
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
