/**
 * resolveBudget (ADR-0013 §3.4, INV-LLM-004, P4 context-budget plan Task 3;
 * order extended by P6 Task 4): pure resolution over an already-measured
 * context, in this fixed order:
 *
 *   (0) [P6 Task 4] truncate the `## User Facts` list — drop lowest
 *       `confirmations` first, then oldest — until the running total fits, or
 *       the list is empty. This is a DELIBERATE EXTENSION of INV-LLM-004's
 *       originally published order (a)-(d) below, added ahead of history
 *       trimming: facts are the cheapest thing to shorten (one line each) and
 *       the least contextually load-bearing per token, whereas history and
 *       the current turn carry the live conversation. Recorded in the plan's
 *       decisions table — a future reader trusting only the historical
 *       (a)-(d) order should know step (0) now runs first.
 *   (a) trim history to `budget.history`;
 *   (b) if `total` is still over `sum - outputReserve`, step domain blocks
 *       down their `depths` (largest block first);
 *   (c) drop episode summaries oldest first;
 *   (d) the D-D floor (keep block 1 and `current` only — facts, the course
 *       directive (AC-FL-5) and summaries all drop here too).
 *
 * Block 1 (`systemTokens`, the rendered phase prompt) is never touched or
 * reported as cut — `system` over its own budget is reported by the caller
 * (agent.node.ts logs `warn`), never cut here.
 *
 * The one impurity: `trimHistory` wraps LangChain's `trimMessages`, which is
 * `Promise`-typed even for a synchronous `tokenCounter` — so `resolveBudget`
 * and `trimHistory` are `async`, but do no I/O, read no clock and read no
 * config (verified by `grep -n "new Date()\|Date.now()\|loadConfig"` in the
 * task's verification command).
 */
import { type BaseMessage, trimMessages } from '@langchain/core/messages';

import type { StoredEpisodeSummary, TokenBudget } from '@domain/conversation/episode';
import type { UserFact } from '@domain/user/ports';

import type { CourseCheckDirective } from '@infra/ai/course-check/directive';
import {
  type ContextBlockCtx,
  COURSE_DIRECTIVE_V1,
  EPISODE_SUMMARIES_V2,
  fullDepth,
  type RenderableBlock,
  renderBlock,
  USER_FACTS_V2,
} from '@infra/ai/prompts/blocks';

import { estimateTokens } from './token-estimator';

export type BudgetCut = 'facts' | 'history' | `block:${string}` | 'summary' | 'floor';

export interface ResolveBudgetInput<D> {
  /** Block 1 — the rendered phase prompt's token count. Never touched or cut. */
  systemTokens: number;
  /** IUserFactsService.getForPrompt output, category-then-recency order — (0) truncates from the tail. */
  facts: UserFact[];
  /**
   * AC-FL-5 (course-check plan Task 1): the stored course-check directive —
   * measured through the SAME render call as block 2a (COURSE_DIRECTIVE_V1),
   * counted in every running total, never truncated (it is one compact block),
   * dropped only at the D-D floor. Optional: absent means no directive.
   */
  directive?: CourseCheckDirective | null;
  /** state.episodeSummaries, oldest first — (c) drops from the front. */
  summaries: StoredEpisodeSummary[];
  /** Domain blocks (D-A) with the phase's loaded data folded in via `data`/`ctx` below. */
  blocks: ReadonlyArray<RenderableBlock<D>>;
  /** The data every block in `blocks` reads — the phase's single `loadContext` result. */
  data: D;
  /** The block-render context (`now`/`timezone`/`user`) — identical to the agent node's full-depth render. */
  blockCtx: ContextBlockCtx;
  history: BaseMessage[];
  /** This run: [HumanMessage, ...inFlight] — never trimmed, never split (D-D floor keeps it whole). */
  current: BaseMessage[];
  budget: TokenBudget;
  estimate: (messages: readonly BaseMessage[]) => number;
}

export interface ResolveBudgetResult {
  /** Truncated tail of the input `facts` (lowest-confirmations-first, then oldest, dropped) — what still renders. */
  facts: UserFact[];
  history: BaseMessage[];
  /** Only blocks stepped down from full depth appear here — id → chosen depth. */
  blockDepths: Record<string, number>;
  /** Oldest-dropped-first tail of the input `summaries` — what still renders. */
  summaries: StoredEpisodeSummary[];
  cuts: BudgetCut[];
}

/**
 * `trimMessages` (`strategy: 'last'`, `startOn: 'human'`, `includeSystem:
 * false`, `allowPartial: false`): keeps the last <= maxTokens, never splits
 * a tool pair, and the kept tail starts on a HumanMessage — the in-run
 * safety net on top of episode-boundary compaction (BR-LLM-001..003).
 */
export async function trimHistory(
  history: BaseMessage[],
  maxTokens: number,
  estimate: (messages: readonly BaseMessage[]) => number,
): Promise<BaseMessage[]> {
  if (history.length === 0 || estimate(history) <= maxTokens) {
    return history;
  }
  return trimMessages(history, {
    maxTokens,
    tokenCounter: estimate as (messages: BaseMessage[]) => number,
    strategy: 'last',
    startOn: 'human',
    includeSystem: false,
    allowPartial: false,
  });
}

function renderBlockAt<D>(block: RenderableBlock<D>, data: D, ctx: ContextBlockCtx, depth: number): number {
  const text = block.render(data, ctx, depth);
  return text === null ? 0 : estimateTokens(text);
}

/**
 * Sort key for (0)'s truncation: lowest `confirmations` first, then oldest
 * (`createdAt` ascending) — least-confirmed, least-recent facts drop first.
 * A copy; never mutates the caller's array.
 */
function leastImportantFirst(facts: UserFact[]): UserFact[] {
  return [...facts].sort((a, b) => {
    if (a.confirmations !== b.confirmations) {
      return a.confirmations - b.confirmations;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export async function resolveBudget<D>(input: ResolveBudgetInput<D>): Promise<ResolveBudgetResult> {
  const { systemTokens, blocks, data, blockCtx, budget, estimate } = input;
  const cuts: BudgetCut[] = [];

  // The same render assembleContext uses for block 2a — measuring the actual text kept in sync with what is sent.
  const factsTokensOf = (facts: UserFact[]): number =>
    facts.length > 0 ? estimateTokens(renderBlock(USER_FACTS_V2, { facts })) : 0;
  // Block 2a′ (AC-FL-5): the directive's measure — same render call, same contract.
  let directiveTokens = 0;
  if (input.directive != null) {
    directiveTokens = estimateTokens(renderBlock(COURSE_DIRECTIVE_V1, { directive: input.directive }));
  }
  const summaryTokensOf = (summaries: StoredEpisodeSummary[]): number =>
    summaries.length > 0
      ? estimateTokens(renderBlock(EPISODE_SUMMARIES_V2, { summaries, now: blockCtx.now, timezone: blockCtx.timezone }))
      : 0;

  const blockDepths: Record<string, number> = {};
  // Full-depth token count per block, in spec order (mutated as depths step down).
  const blockTokens = blocks.map(b => renderBlockAt(b, data, blockCtx, fullDepth(b)));
  const currentTokens = estimate(input.current);
  // Running totals for the "sum - outputReserve" check in (0)/(b)/(c)/(d).
  const sumMinusReserve = budget.system + budget.longTerm + budget.domain + budget.history - budget.outputReserve;

  function totalNow(facts: UserFact[], history: BaseMessage[], summaries: StoredEpisodeSummary[]): number {
    const domainNow = blockTokens.reduce((n, t) => n + t, 0);
    return (
      systemTokens +
      factsTokensOf(facts) +
      directiveTokens +
      summaryTokensOf(summaries) +
      domainNow +
      estimate(history) +
      currentTokens
    );
  }

  // (0) [P6 Task 4, deliberate extension of INV-LLM-004's published order — see
  // the module JSDoc] truncate facts BEFORE history is trimmed: drop the
  // least-confirmed, least-recent fact one at a time until the running total
  // fits or the list is empty.
  let { facts } = input;
  if (factsTokensOf(facts) > 0) {
    // Ascending: least important (lowest confirmations, then oldest) first.
    // Survivors are the TAIL of this ordering (the most important facts) —
    // dropping grows from the front.
    const ordered = leastImportantFirst(facts);
    let survivorCount = ordered.length;
    while (
      survivorCount > 0 &&
      totalNow(ordered.slice(ordered.length - survivorCount), input.history, input.summaries) > sumMinusReserve
    ) {
      survivorCount -= 1;
    }
    if (survivorCount < facts.length) {
      // Restore the original category-then-recency order for whatever
      // survives — the block must never re-render in confirmations order.
      const survivingIds = new Set(ordered.slice(ordered.length - survivorCount).map(f => f.id));
      facts = facts.filter(f => survivingIds.has(f.id));
      cuts.push('facts');
    }
  }

  // (a) trim history to budget.history.
  let { history } = input;
  const preTrimTokens = estimate(history);
  if (preTrimTokens > budget.history) {
    history = await trimHistory(history, budget.history, estimate);
    if (estimate(history) < preTrimTokens) {
      cuts.push('history');
    }
  }

  let { summaries } = input;

  // (b) step blocks down their depths, largest block (by current token count) first,
  // one step at a time, until within budget or all blocks are at their smallest depth.
  // index into each block's `depths` already applied (0 = full depth, not yet stepped)
  const stepIndexByBlock = blocks.map(() => 0);
  while (totalNow(facts, history, summaries) > sumMinusReserve) {
    // Find the block with the largest CURRENT token count that still has a smaller depth to step to.
    let candidate = -1;
    for (let i = 0; i < blocks.length; i++) {
      const { depths } = blocks[i];
      if (!depths || stepIndexByBlock[i] >= depths.length - 1) {
        continue;
      }
      if (candidate === -1 || blockTokens[i] > blockTokens[candidate]) {
        candidate = i;
      }
    }
    if (candidate === -1) {
      break; // no block left to step down — move to (c).
    }
    stepIndexByBlock[candidate] += 1;
    const newDepth = blocks[candidate].depths![stepIndexByBlock[candidate]];
    blockTokens[candidate] = renderBlockAt(blocks[candidate], data, blockCtx, newDepth);
    blockDepths[blocks[candidate].id] = newDepth;
    cuts.push(`block:${blocks[candidate].id}`);
  }

  // (c) drop episode summaries oldest first.
  while (totalNow(facts, history, summaries) > sumMinusReserve && summaries.length > 0) {
    summaries = summaries.slice(1);
    cuts.push('summary');
  }

  // (d) D-D floor: still over even after (0)-(c) exhausted (facts truncated,
  // history trimmed, summaries dropped, blocks at their smallest) — keep
  // block 1 and `current` only, facts included. Fires regardless of whether
  // facts/history/summaries already emptied themselves in (0)/(a)/(c);
  // setting an already-empty array to empty is a no-op.
  if (totalNow(facts, history, summaries) > sumMinusReserve) {
    facts = [];
    history = [];
    summaries = [];
    directiveTokens = 0; // AC-FL-5: the directive drops at the floor too.
    cuts.push('floor');
  }

  return { facts, history, blockDepths, summaries, cuts };
}
