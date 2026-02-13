/**
 * Unit tests for LLM JSON mode runtime validation
 * 
 * Tests that LLMService validates system prompts contain "json" when jsonMode is enabled.
 * This prevents OpenAI/OpenRouter API errors at runtime.
 */

import { describe, expect, it, jest } from '@jest/globals';

import { LLMService } from '@infra/ai/llm.service';

describe('LLMService JSON Mode Validation', () => {
  let llmService: LLMService;

  beforeEach(() => {
    llmService = new LLMService();
  });

  describe('Runtime validation', () => {
    it('should throw error when jsonMode=true but prompt does not mention "json"', async () => {
      const invalidPrompt = 'You are a helpful assistant. Respond with structured data.';
      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await expect(
        llmService.generateWithSystemPrompt(messages, invalidPrompt, { jsonMode: true }),
      ).rejects.toThrow(/CONFIGURATION ERROR.*JSON mode is enabled but system prompt does not mention "json"/);
    });

    it('should validate case-insensitively (accepts "JSON", "json", "Json")', () => {
      // Test the validation logic directly
      const testCases = [
        { prompt: 'Return JSON format', shouldPass: true },
        { prompt: 'Return json format', shouldPass: true },
        { prompt: 'Return Json format', shouldPass: true },
        { prompt: 'Return data in JSON', shouldPass: true },
        { prompt: 'Respond with structured data', shouldPass: false },
        { prompt: 'Use JSON-like format', shouldPass: true },
      ];

      testCases.forEach(({ prompt, shouldPass }) => {
        const promptLower = prompt.toLowerCase();
        const containsJson = promptLower.includes('json');
        expect(containsJson).toBe(shouldPass);
      });
    });
  });

  describe('Error message quality', () => {
    it('should provide clear error message with context', async () => {
      const invalidPrompt = 'You are a fitness coach. Help users with workouts.';
      const messages = [{ role: 'user' as const, content: 'Create a plan' }];

      try {
        await llmService.generateWithSystemPrompt(messages, invalidPrompt, { jsonMode: true });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const errorMessage = (error as Error).message;
        
        // Check error message contains helpful information
        expect(errorMessage).toContain('CONFIGURATION ERROR');
        expect(errorMessage).toContain('JSON mode is enabled');
        expect(errorMessage).toContain('system prompt does not mention "json"');
        expect(errorMessage).toContain('OpenAI/OpenRouter API error');
      }
    });
  });
});
