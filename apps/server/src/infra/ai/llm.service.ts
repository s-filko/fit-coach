import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

import { LLMService as ILLMService } from '@domain/ai/ports';
import { ChatMsg } from '@domain/user/ports';

import { loadConfig } from '@config/index';

import { createLogger, type Logger } from '@shared/logger';

export class LLMService implements ILLMService {
  private model: ChatOpenAI;
  private config = loadConfig();
  private log = createLogger('llm');

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
  }

  async generateWithSystemPrompt(
    messages: ChatMsg[],
    systemPrompt: string,
    opts?: { jsonMode?: boolean; log?: Logger },
  ): Promise<string> {
    return this.invokeModel(messages, systemPrompt, opts?.jsonMode, opts?.log);
  }

  async generateStructured<T>(
    messages: ChatMsg[],
    systemPrompt: string,
    schema: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    opts?: { log?: Logger },
  ): Promise<T> {
    const log = opts?.log ?? this.log;
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
      const result = await this.model.invoke([systemMsg, ...chatMessages], {
        response_format: { type: 'json_object' },
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(result.content as string);

      // Validate against schema
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const validated = schema.parse(parsed) as T;

      const endTime = new Date();
      const processingTime = endTime.getTime() - startTime.getTime();

      log.info(
        {
          requestId,
          model: this.model.model,
          processingTime,
          jsonMode: true,
          structured: true,
        },
        'LLM structured call completed',
      );

      return validated;
    } catch (error) {
      const processingTime = new Date().getTime() - startTime.getTime();
      log.error(
        {
          err: error,
          requestId,
          model: this.model.model,
          processingTime,
          jsonMode: true,
          structured: true,
        },
        'LLM structured call failed',
      );
      throw error;
    }
  }

  private async invokeModel(
    messages: ChatMsg[],
    systemPromptText: string,
    jsonMode?: boolean,
    log?: Logger,
  ): Promise<string> {
    const effectiveLog = log ?? this.log;
    const requestId = this.generateId();
    const startTime = new Date();
    const isDevelopment = this.config.NODE_ENV === 'development';

    try {
      // CRITICAL: Validate JSON mode configuration before API call
      // OpenAI/OpenRouter requires system prompt to mention "json" when using json_object format
      if (jsonMode) {
        const promptLower = systemPromptText.toLowerCase();
        if (!promptLower.includes('json')) {
          const error = new Error(
            'CONFIGURATION ERROR: JSON mode is enabled but system prompt does not mention "json". ' +
              'This will cause OpenAI/OpenRouter API error: "Response input messages must contain ' +
              "the word 'json' in some form to use 'text.format' of type 'json_object'.\"",
          );
          effectiveLog.error(
            {
              requestId,
              systemPromptPreview: systemPromptText.slice(0, 200),
            },
            'JSON mode enabled but system prompt missing "json" keyword',
          );
          throw error;
        }
      }

      const systemPrompt = new SystemMessage(systemPromptText);

      const chatMessages = messages.map(chatMsg => {
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
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
        temperature: this.model.temperature ?? 0.7,
        ...(jsonMode && { response_format: { type: 'json_object' } }),
      };

      // Log request (full content in dev, metadata only in prod)
      if (isDevelopment) {
        effectiveLog.debug(
          {
            requestId,
            model: this.model.model,
            jsonMode,
            messageCount: messages.length,
            systemPrompt: systemPromptText,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            httpPayload,
          },
          'LLM request prepared',
        );
      } else {
        effectiveLog.debug(
          {
            requestId,
            model: this.model.model,
            jsonMode,
            messageCount: messages.length,
            systemPromptLength: systemPromptText.length,
            messagesLengths: messages.map(m => ({ role: m.role, length: m.content.length })),
          },
          'LLM request prepared',
        );
      }

      const callOptions = jsonMode ? { response_format: { type: 'json_object' as const } } : undefined;

      // Retry up to 2 times if the model returns an empty or trivially short response
      let response = await this.model.invoke([systemPrompt, ...chatMessages], callOptions);
      let content = response.content as string;
      if (jsonMode && content.trim().length <= 2) {
        effectiveLog.warn({ requestId, content }, 'LLM returned empty JSON, retrying (attempt 2)');
        response = await this.model.invoke([systemPrompt, ...chatMessages], callOptions);
        content = response.content as string;
        if (content.trim().length <= 2) {
          effectiveLog.warn({ requestId, content }, 'LLM returned empty JSON again, retrying (attempt 3)');
          response = await this.model.invoke([systemPrompt, ...chatMessages], callOptions);
          content = response.content as string;
        }
      }

      const endTime = new Date();
      const processingTime = endTime.getTime() - startTime.getTime();
      const tokenUsage = (response.response_metadata as Record<string, unknown>)?.tokenUsage as
        | { totalTokens?: number; promptTokens?: number; completionTokens?: number }
        | undefined;

      // Log response (full content in dev, metadata only in prod)
      if (isDevelopment) {
        effectiveLog.info(
          {
            requestId,
            processingTime,
            totalTokens: tokenUsage?.totalTokens,
            promptTokens: tokenUsage?.promptTokens,
            completionTokens: tokenUsage?.completionTokens,
            contentLength: content.length,
            content,
            responseMetadata: response.response_metadata,
          },
          'LLM call completed',
        );
      } else {
        effectiveLog.info(
          {
            requestId,
            processingTime,
            totalTokens: tokenUsage?.totalTokens,
            promptTokens: tokenUsage?.promptTokens,
            completionTokens: tokenUsage?.completionTokens,
            contentLength: content.length,
          },
          'LLM call completed',
        );
      }

      return content;
    } catch (error) {
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

      const processingTime = new Date().getTime() - startTime.getTime();

      effectiveLog.error(
        {
          err: error,
          requestId,
          model: this.model.model,
          processingTime,
          providerError: providerError || undefined,
        },
        'LLM call failed',
      );

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
}
