/**
 * Chat message shape used by the conversation context service. Temporary home:
 * ADR-0013 replaces this with LangChain message types in P1/P4. Moved here from
 * domain/user/ports/prompt.ports.ts (P0).
 */
export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
