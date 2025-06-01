// orchestrator.ts
import { getCoachReply } from './ai/coach';

/**
 * Orchestrates the handling of a user message.
 * @param userId Unique identifier for the user
 * @param text User's message
 * @returns AI-generated reply
 */
export async function orchestrate(userId: string, text: string): Promise<string> {
    // later: fetch user profile, memory, state, etc.
    return await getCoachReply(text);
}