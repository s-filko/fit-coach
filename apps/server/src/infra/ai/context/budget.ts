/**
 * resolveBudget (ADR-0013 §3.4, INV-LLM-004, P4 context-budget plan Task 3):
 * pure resolution over an already-measured context, in the fixed order the
 * invariant names — (a) trim history to `budget.history`; (b) if `total` is
 * still over `sum - outputReserve`, step domain blocks down their `depths`
 * (largest block first); (c) drop episode summaries oldest first; (d) the
 * D-D floor (keep block 1 and `current` only). Block 1 (`systemTokens`, the
 * rendered phase prompt) is never touched or reported as cut — `system`
 * over its own budget is reported by the caller (agent.node.ts logs `warn`),
 * never cut here.
 *
 * The one impurity: `trimHistory` wraps LangChain's `trimMessages`, which is
 * `Promise`-typed even for a synchronous `tokenCounter` — so `resolveBudget`
 * and `trimHistory` are `async`, but do no I/O, read no clock and read no
 * config (verified by `grep -n "new Date()\|Date.now()\|loadConfig"` in the
 * task's verification command).
 */
import { type BaseMessage, trimMessages } from '@langchain/core/messages';

import type { StoredEpisodeSummary, TokenBudget } from '@domain/conversation/episode';

import { type ContextBlockCtx, EPISODE_SUMMARIES_V1, fullDepth, renderBlock } from '@infra/ai/prompts/blocks';

import { estimateTokens } from './token-estimator';

/** The one shape `resolveBudget` needs from a `ContextBlock<D>` — render + optional depth steps. */
export interface BudgetBlockInput<D> {
  id: string;
  depths?: readonly number[];
  render(data: D, ctx: ContextBlockCtx, depth: number): string | null;
}

export type BudgetCut = 'history' | `block:${string}` | 'summary' | 'floor';

export interface ResolveBudgetInput<D> {
  /** Block 1 — the rendered phase prompt's token count. Never touched or cut. */
  systemTokens: number;
  /** state.episodeSummaries, oldest first — (c) drops from the front. */
  summaries: StoredEpisodeSummary[];
  /** Domain blocks (D-A) with the phase's loaded data folded in via `data`/`ctx` below. */
  blocks: ReadonlyArray<BudgetBlockInput<D>>;
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

function renderBlockAt<D>(block: BudgetBlockInput<D>, data: D, ctx: ContextBlockCtx, depth: number): number {
  const text = block.render(data, ctx, depth);
  return text === null ? 0 : estimateTokens(text);
}

export async function resolveBudget<D>(input: ResolveBudgetInput<D>): Promise<ResolveBudgetResult> {
  const { systemTokens, blocks, data, blockCtx, budget, estimate } = input;
  const cuts: BudgetCut[] = [];

  // (a) trim history to budget.history.
  let { history } = input;
  const preTrimTokens = estimate(history);
  if (preTrimTokens > budget.history) {
    history = await trimHistory(history, budget.history, estimate);
    if (estimate(history) < preTrimTokens) {
      cuts.push('history');
    }
  }

  // Running totals for the "sum - outputReserve" check in (b)/(c)/(d).
  const sumMinusReserve = budget.system + budget.longTerm + budget.domain + budget.history - budget.outputReserve;
  const currentTokens = estimate(input.current);
  // The same render assembleContext uses for block 2 — measuring the actual text kept in sync with what is sent.
  const summaryTokensOf = (summaries: StoredEpisodeSummary[]): number =>
    summaries.length > 0
      ? estimateTokens(renderBlock(EPISODE_SUMMARIES_V1, { summaries, now: blockCtx.now, timezone: blockCtx.timezone }))
      : 0;

  const blockDepths: Record<string, number> = {};
  // Full-depth token count per block, in spec order (mutated as depths step down).
  const blockTokens = blocks.map(b => renderBlockAt(b, data, blockCtx, fullDepth(b)));

  function totalNow(summaries: StoredEpisodeSummary[]): number {
    const domainNow = blockTokens.reduce((n, t) => n + t, 0);
    return systemTokens + summaryTokensOf(summaries) + domainNow + estimate(history) + currentTokens;
  }

  let { summaries } = input;

  // (b) step blocks down their depths, largest block (by current token count) first,
  // one step at a time, until within budget or all blocks are at their smallest depth.
  // index into each block's `depths` already applied (0 = full depth, not yet stepped)
  const stepIndexByBlock = blocks.map(() => 0);
  while (totalNow(summaries) > sumMinusReserve) {
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
  while (totalNow(summaries) > sumMinusReserve && summaries.length > 0) {
    summaries = summaries.slice(1);
    cuts.push('summary');
  }

  // (d) D-D floor: still over even after (a)-(c) exhausted (history trimmed,
  // summaries dropped, blocks at their smallest) — keep block 1 and `current`
  // only. Fires regardless of whether history/summaries already emptied
  // themselves in (a)/(c); setting an already-empty array to empty is a no-op.
  if (totalNow(summaries) > sumMinusReserve) {
    history = [];
    summaries = [];
    cuts.push('floor');
  }

  return { history, blockDepths, summaries, cuts };
}
