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
 *   `failNextChat(error)` makes the NEXT chat call throw instead (once) — the failed-run
 *   scenarios' provider/model failure; the queued answers are left untouched.
 * - `structured` (the gateway's `getModel(profile).withConfig(...).invoke`):
 *   two KINDS share this path and are routed by their prompt — the
 *   course-check call (its system prompt opens "You are the course-check
 *   layer") and the episode summariser (everything else). Each kind has its own
 *   FIFO of scripted raw contents, so a journey run with the course check ON
 *   and OFF consumes the same summariser answers (AC-FL-7); fallbacks are the
 *   minimal valid payload of each kind (an empty episode / a neutral
 *   directive).
 * - every input on both paths is recorded; `drainChatInputs()` is the
 *   deterministic layer's `seen` observation, `drainStructuredInputs()` its
 *   twin for what the course check and the summariser were handed.
 * - `{{factId:<text>}}` placeholders in scripted tool-call args and structured
 *   answers are resolved at the moment the model answers (see
 *   `setPlaceholderResolver`) — a journey cannot know a fact's id when it is
 *   authored, only when the run reaches that step.
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

/** A neutral, schema-valid course-check directive — the fallback when a journey scripts none. */
export const NEUTRAL_DIRECTIVE_ANSWER = JSON.stringify({
  vector: 'General fitness, no fixed plan yet',
  constraints: [],
  questions: [],
  suspectFacts: [],
  exerciseVerdicts: [],
});

/** Which structured call a request is: decided by the prompt it carries (see the file header). */
export type StructuredKind = 'course_check' | 'summary';

/** One recorded structured request. */
export interface StructuredInput {
  kind: StructuredKind;
  messages: BaseMessage[];
}

// jest.mock factories may only reference variables prefixed with `mock`.
const mockState = {
  chatScript: [] as AIMessage[],
  chatFailure: null as Error | null,
  summaryScript: [] as string[],
  courseScript: [] as string[],
  chatInputs: [] as BaseMessage[][],
  structuredInputs: [] as StructuredInput[],
  resolvePlaceholders: null as null | ((text: string) => Promise<string>),
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
  /** Makes the next chat call throw `error` (once); later calls answer from the queue again. */
  failNextChat(error: Error): void;
  /** Queues scripted raw structured answers (the summariser path). */
  enqueueStructuredAnswers(rawContents: string[]): void;
  /** Queues scripted raw course-check answers (the directive path). */
  enqueueCourseDirectives(rawContents: string[]): void;
  /** Empties every queue and recording — the state a journey run starts from. */
  reset(): void;
  /** Drops every unconsumed structured answer of both kinds — run between steps so a script never leaks into the next one. */
  clearStructuredScripts(): { summary: number; courseCheck: number };
  /** Resolves `{{factId:...}}` (or any) placeholders in tool-call args and structured answers at answer time. */
  setPlaceholderResolver(resolver: ((text: string) => Promise<string>) | null): void;
  /** Structured requests recorded since the last drain — what the course check / summariser were handed. */
  drainStructuredInputs(): StructuredInput[];
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
        if (mockState.chatFailure !== null) {
          const failure = mockState.chatFailure;
          mockState.chatFailure = null;
          throw failure;
        }
        const next = mockState.chatScript.shift();
        if (next === undefined) {
          return new AIMessage({ content: 'Хорошо.', tool_calls: [] });
        }
        if (mockState.resolvePlaceholders === null || next.tool_calls === undefined || next.tool_calls.length === 0) {
          return next;
        }
        const resolved = await mockState.resolvePlaceholders(JSON.stringify(next.tool_calls));
        return new AIMessage({ content: next.content, tool_calls: JSON.parse(resolved) });
      },
      withConfig: () => ({
        invoke: async (messages: BaseMessage[]) => {
          const isCourseCheck = messages.some(
            m => typeof m.content === 'string' && m.content.includes('You are the course-check layer'),
          );
          const kind: StructuredKind = isCourseCheck ? 'course_check' : 'summary';
          mockState.structuredInputs.push({ kind, messages });
          const raw = isCourseCheck
            ? (mockState.courseScript.shift() ?? NEUTRAL_DIRECTIVE_ANSWER)
            : (mockState.summaryScript.shift() ?? MINIMAL_STRUCTURED_ANSWER);
          const content = mockState.resolvePlaceholders === null ? raw : await mockState.resolvePlaceholders(raw);
          return { content };
        },
      }),
    };
    return { getModel: () => model };
  });

  return {
    enqueueChat(script) {
      mockState.chatScript.push(...script.map(toAIMessage));
    },
    failNextChat(error) {
      mockState.chatFailure = error;
    },
    enqueueStructuredAnswers(rawContents) {
      mockState.summaryScript.push(...rawContents);
    },
    enqueueCourseDirectives(rawContents) {
      mockState.courseScript.push(...rawContents);
    },
    reset() {
      mockState.chatScript = [];
      mockState.chatFailure = null;
      mockState.summaryScript = [];
      mockState.courseScript = [];
      mockState.chatInputs = [];
      mockState.structuredInputs = [];
      mockState.resolvePlaceholders = null;
    },
    clearStructuredScripts() {
      const dropped = { summary: mockState.summaryScript.length, courseCheck: mockState.courseScript.length };
      mockState.summaryScript = [];
      mockState.courseScript = [];
      return dropped;
    },
    setPlaceholderResolver(resolver) {
      mockState.resolvePlaceholders = resolver;
    },
    drainStructuredInputs() {
      const drained = mockState.structuredInputs;
      mockState.structuredInputs = [];
      return drained;
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
