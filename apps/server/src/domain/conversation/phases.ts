/**
 * The five conversation phases (ADR-0013 §11). Domain-owned since
 * refactor-p3-run-context-commit; `ports/conversation-context.ports.ts`
 * re-exports it so existing imports keep compiling.
 */
export type ConversationPhase = 'registration' | 'chat' | 'plan_creation' | 'session_planning' | 'training';
