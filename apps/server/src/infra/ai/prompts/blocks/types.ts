/**
 * ContextBlock (ADR-0013 §3.4 block 3, §4.2 `contextBlocks`; plan D-A): a pure
 * renderer over the phase's already-loaded data (`PhaseSpec.loadContext`
 * stays the one loader). `render` returning `null` means the block is absent
 * for this render (e.g. no previous session) — the assembler drops it.
 *
 * `depths` (optional) declares the depth steps the budget resolver (Task 3)
 * may step down through, largest first, before dropping an episode summary
 * (INV-LLM-004 resolution order). A block without `depths` has one depth: 0.
 */
import type { User } from '@domain/user/services/user.service';

export interface ContextBlockCtx {
  now: Date;
  timezone: string | null;
  user: User | null;
}

/**
 * The minimal render-only shape shared by `ContextBlock<D>` and by
 * `resolveBudget`'s narrower block input (`context/budget.ts`) — id, optional
 * depth steps, and a pure render. `renderBlocks`/`fullDepth` (./index.ts) and
 * `resolveBudget` take this shape structurally, not `ContextBlock<D>` itself,
 * so both the full block (with `version`) and the budget resolver's own block
 * objects satisfy it without a second, duplicate declaration.
 */
export interface RenderableBlock<D> {
  id: string;
  /** Depth steps this block supports, largest first (e.g. [5, 3, 1] sessions). Omitted = single depth. */
  depths?: readonly number[];
  /** Pure (BR-LLM-007 discipline): no I/O, no Date.now(). depth = current step from `depths`, or 0. */
  render(data: D, ctx: ContextBlockCtx, depth: number): string | null;
}

export interface ContextBlock<D> extends RenderableBlock<D> {
  version: string;
}

export interface RenderedBlock {
  id: string;
  text: string;
  tokens: number;
  depth: number;
}
