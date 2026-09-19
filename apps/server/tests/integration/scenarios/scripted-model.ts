/**
 * The scripted model beneath the real gateway (plan Task 2 / AC-TJ-2):
 * a shared jest mock of `@infra/ai/model.factory` used by every deterministic
 * scenario test. The REAL `OpenAiLlmGateway`, the real graph, repositories,
 * services and the PostgresSaver checkpointer stay in place — only the
 * ChatModel beneath the gateway is scripted, exactly like
 * `user-facts.scenario.unit.test.ts` does it.
 *
 * - `chat` (the agent node's `getModel(profile).bindTools(tools).invoke`):
 *   answers come FIFO from the step scripts; when the queue is empty the
 *   fallback is a plain text reply, so an under-scripted journey still runs.
 * - `structured` (the gateway's `getModel(profile).withConfig(...).invoke`):
 *   answers come FIFO from scripted raw contents; the fallback is the minimal
 *   payload that satisfies `EpisodeSummarySchema` (compaction of an empty
 *   episode).
 * - every input on both paths is recorded; `drainChatInputs()` is the
 *   deterministic layer's `seen` observation.
 */
import { randomUUID } from 'node:crypto';

import { AIMessage, type BaseMessage } from '@langchain/core/messages';


/** The `script[]` entry of a user step (scenario.schema's ScriptedMessage, structural). */
export interface ScriptedChatMessage {
  text?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
}

/**
 * The minimal raw content that passes `EpisodeSummarySchema` — an empty
 * episode compaction (no topics, no facts). The gateway's own fence/prose
 * recovery handles the rest.
 */
export const MINIMAL_STRUCTURED_ANSWER = JSON.stringify({
  topics: [],
  decisions: [],
  userState: [],
  trainingFeedback: [],
  openItems: [],
  facts: [],
});

// jest.mock factories may only reference variables prefixed with `mock`.
const mockState = {
  chatScript: [] as AIMessage[],
  structuredScript: [] as string[],
  chatInputs: [] as BaseMessage[][],
  structuredInputs: [] as BaseMessage[][],
};

function toAIMessage(message: ScriptedChatMessage): AIMessage {
  return new AIMessage({
    content: message.text ?? '',
    tool_calls: message.toolCall
      ? [{ id: randomUUID(), name: message.toolCall.name, args: message.toolCall.args, type: 'tool_call' as const }]
      : [],
  });
}

export interface ScriptedModelHandle {
  /** Queues one step's scripted chat answers (FIFO across the whole journey). */
  enqueueChat(script: ScriptedChatMessage[]): void;
  /** Queues scripted raw structured answers (the summariser path). */
  enqueueStructuredAnswers(rawContents: string[]): void;
  /** Model inputs recorded since the last drain — the `seen` observation. */
  drainChatInputs(): BaseMessage[][];
  /** True when no scripted chat answer is left (the fallback answered). */
  get chatScriptExhausted(): boolean;
}

/**
 * Installs the mock. Call BEFORE the graph is wired (before
 * `runScenario`/`registerInfraServices`) — the mock must be in the module
 * registry before `@infra/ai/model.factory` is first required.
 */
export function installScriptedModel(): ScriptedModelHandle {
  jest.mock('@infra/ai/model.factory', () => {
    const model = {
      bindTools: () => model,
      invoke: async (messages: BaseMessage[]) => {
        mockState.chatInputs.push(messages);
        return mockState.chatScript.shift() ?? new AIMessage({ content: 'Хорошо.', tool_calls: [] });
      },
      withConfig: () => ({
        invoke: async (messages: BaseMessage[]) => {
          mockState.structuredInputs.push(messages);
          return { content: mockState.structuredScript.shift() ?? MINIMAL_STRUCTURED_ANSWER };
        },
      }),
    };
    return { getModel: () => model };
  });

  return {
    enqueueChat(script) {
      mockState.chatScript.push(...script.map(toAIMessage));
    },
    enqueueStructuredAnswers(rawContents) {
      mockState.structuredScript.push(...rawContents);
    },
    drainChatInputs() {
      const drained = mockState.chatInputs;
      mockState.chatInputs = [];
      return drained;
    },
    get chatScriptExhausted() {
      return mockState.chatScript.length === 0;
    },
  };
}
