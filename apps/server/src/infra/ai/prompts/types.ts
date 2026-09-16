import type { PromptContextBase } from '@domain/ai/prompt-context.types';
import type { User } from '@domain/user/services/user.service';

/** ADR-0013 §5.2 */
export interface Section {
  id: string;
  text: string;
  /** L0 asserts every required section of the phase contract is present (PROMPT_EVAL_FRAMEWORK §4.1). */
  required: boolean;
}

export interface DirectiveContext extends PromptContextBase {
  user: User | null;
  lastMessageTime: Date | null;
}

export interface DirectiveModule {
  id: string;
  version: string;
  /** Pure. Returns null when the directive does not apply (e.g. greeting). */
  render(ctx: DirectiveContext): Section | null;
}

export interface PromptModule<TCtx> {
  id: string;
  version: string;
  directives: readonly DirectiveModule[];
  /** Pure (BR-LLM-007): no I/O, no Date.now(). */
  render(ctx: TCtx): Section[];
}
