/**
 * PhaseSpec (ADR-0013 §4.2) — the one place a phase is defined. A spec is
 * built at the composition root with deps (`buildPhaseSpecs(deps)` in
 * `phases/index.ts`): tools and loaders need repositories; the spec objects
 * are plain data once built. Adding a phase means adding a spec — the graph
 * builder is not edited (INV-LLM-005).
 */
import type { StructuredToolInterface } from '@langchain/core/tools';

import type { TokenBudget } from '@domain/conversation/episode';
import type { ConversationPhase } from '@domain/conversation/ports';
import type { User } from '@domain/user/services/user.service';

import type { MessageKey } from '@infra/ai/messages';
import type { ContextBlock } from '@infra/ai/prompts/blocks';
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
  /** PHASE_PROMPTS[name] */
  prompt: PhasePromptEntry<PromptContextFor<D>>;
  /** Phase tools + buildSharedTools(deps), built at the composition root. */
  tools: StructuredToolInterface[];
  toolPolicy: ToolPolicy;
  /**
   * ADR-0013 §3.4 table values, as data (D-D) — Task 1's measured defaults,
   * optionally overridden per phase/part via `LLM_BUDGET_<PHASE>_<PART>`
   * (`config/llm-budget-overrides.ts`, applied once in `conversation.graph.ts`'s
   * `withBudgetOverrides`). `history` alone drives the BR-LLM-003 compaction
   * trigger (`compact.node.ts`'s `budgetFor`); the full object is enforced by
   * `assembleContext`/`resolveBudget` (INV-LLM-004, context-budget plan Task 3)
   * — trim history, step domain blocks down `depths`, drop the oldest episode
   * summary, then the D-D floor. Block 1 (the rendered prompt) is never cut;
   * `system` over its own budget is reported (`BudgetReport`), not enforced.
   */
  budget: TokenBudget;
  /** Transitional (D-A) — see LoadResult. */
  loadContext: (input: LoadInput, deps: ConversationGraphDeps) => Promise<LoadResult<D>>;
  /**
   * Domain blocks (ADR-0013 §3.4 block 3, §4.2, D-A/D-B) — pure renderers over
   * `loadContext`'s data (`ContextBlock<D>.render(data, ctx, depth)`), passed
   * unrendered to `assembleContext`, which renders each at the depth
   * `resolveBudget` picks (full depth by default; a smaller step from
   * `depths`, largest block first, when INV-LLM-004 needs to cut — context-
   * budget plan Task 3) and places the result after the episode-summaries
   * block. A block whose `render` returns `null` is absent that run (e.g. no
   * previous session). Empty for registration (D-B: no domain sections moved
   * out of its prompt). Add a phase's blocks in `graph/phases/<phase>.spec.ts`.
   */
  contextBlocks: ReadonlyArray<ContextBlock<D>>;
  /** getModel(profile) — 'default' for every phase today (D-G). */
  modelProfile: string;
}
