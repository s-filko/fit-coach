/**
 * PhaseSpec (ADR-0013 §4.2) — the one place a phase is defined. A spec is
 * built at the composition root with deps (`buildPhaseSpecs(deps)` in
 * `phases/index.ts`): tools and loaders need repositories; the spec objects
 * are plain data once built. Adding a phase means adding a spec — the graph
 * builder is not edited (INV-LLM-005).
 */
import type { StructuredToolInterface } from '@langchain/core/tools';

import type { ConversationPhase } from '@domain/conversation/ports';
import type { User } from '@domain/user/services/user.service';

import type { MessageKey } from '@infra/ai/messages';
import type { PhaseLayout } from '@infra/ai/prompts';
import type { DirectiveContext, PhasePromptEntry } from '@infra/ai/prompts/types';

import type { ConversationGraphDeps } from './conversation.graph';
import type { ToolPolicy } from './tool-policy';

export type { ConversationGraphDeps } from './conversation.graph';
export type { DirectiveContext, PhasePromptEntry } from '@infra/ai/prompts/types';

/** What the agent node hands `loadContext` before the model call. */
export interface LoadInput {
  userId: string;
  user: User | null;
  activeSessionId: string | null;
}

/**
 * Transitional (D-A): returns the phase's render data — what today's
 * agentNode loaded before `render` — including `lastMessageTime` (chat loads
 * it, the others return null; `greeting.v1` renders only when it is set).
 * P4 replaces it with `contextBlocks` and state's `lastUserMessageAt`.
 * `ok: false` carries a catalog key; the agent node replies `t(reply, lang)`
 * with no model call (D-B).
 */
export type LoadResult<D> = { ok: true; data: D } | { ok: false; reply: MessageKey };

/** The render context a phase prompt receives: the directive base plus the loader's data. */
export type PromptContextFor<D> = DirectiveContext & D;

export interface PhaseSpec<D = unknown> {
  name: ConversationPhase;
  /** PHASE_PROMPTS[name].entry */
  prompt: PhasePromptEntry<PromptContextFor<D>>;
  /** PHASE_PROMPTS[name].layout — transitional (P4 removes the remaining flags). */
  layout: PhaseLayout;
  /** Phase tools + buildSharedTools(deps), built at the composition root. */
  tools: StructuredToolInterface[];
  toolPolicy: ToolPolicy;
  /** Transitional (D-A) — see LoadResult. */
  loadContext: (input: LoadInput, deps: ConversationGraphDeps) => Promise<LoadResult<D>>;
  /** getModel(profile) — 'default' for every phase today (D-G). */
  modelProfile: string;
}
