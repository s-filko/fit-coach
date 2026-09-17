/**
 * ToolOutcome — the contract every tool returns (ADR-0013 §6).
 *
 * Pure domain type: NO imports with runtime effect. `TransitionRequest` is
 * imported type-only from `transitions.ts` so this file stays free of
 * LangGraph at runtime.
 */
import type { TransitionRequest } from './transitions';

/** Error classification the executor (not the tool) acts on. */
export type ToolErrorKind = 'user_error' | 'llm_error' | 'system_error';

/**
 * A tool's result. `ok` outcomes carry the exact string the model relays;
 * error kinds say who can fix it: the user (`user_error`), the model
 * (`llm_error`), or nobody (`system_error` — ends the run).
 */
export type ToolOutcome =
  | { ok: true; summary: string; data?: unknown }
  | { ok: false; kind: ToolErrorKind; message: string; hint?: string };

/** The two facts tools may request the graph to change (decision D-B). */
export interface ToolStateUpdate {
  pendingTransition?: TransitionRequest;
  activeSessionId?: string;
}

/** What a tool returns: a plain outcome, or an outcome plus a state request. */
export type ToolReturn = ToolOutcome | { outcome: ToolOutcome; update: ToolStateUpdate };

export function isToolReturnWithUpdate(r: ToolReturn): r is { outcome: ToolOutcome; update: ToolStateUpdate } {
  return typeof r === 'object' && r !== null && 'outcome' in r && 'update' in r;
}

export const ok = (summary: string, data?: unknown): ToolOutcome =>
  data === undefined ? { ok: true, summary } : { ok: true, summary, data };

export const userError = (message: string, hint?: string): ToolOutcome =>
  hint === undefined ? { ok: false, kind: 'user_error', message } : { ok: false, kind: 'user_error', message, hint };

export const llmError = (message: string, hint?: string): ToolOutcome =>
  hint === undefined ? { ok: false, kind: 'llm_error', message } : { ok: false, kind: 'llm_error', message, hint };

export const systemError = (message: string): ToolOutcome => ({ ok: false, kind: 'system_error', message });
