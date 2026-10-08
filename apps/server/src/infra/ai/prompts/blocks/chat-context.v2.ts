/**
 * `chat.context` v2 (BUG-053, stale-session-autoclose plan T3 / AC-SSA-3): v1's render plus one
 * fact — a session closed by the timeout auto-close says so: `closed automatically after
 * inactivity` sits between the time and the duration on its recent-sessions line. A session
 * closed any other way shows no marker. Without a timeout-closed session the render is v1 byte
 * for byte. The only chat context block the chat phase renders.
 */
import {
  buildChatContextText,
  buildRecentSessionsSection,
  CHAT_CONTEXT_V1,
  type ChatContextData,
} from './chat-context.v1';
import type { ContextBlock } from './types';

/** Depth 5 matches v1's fixed `recentSessions.slice(0, 5)` shape used by loadContext. */
export const CHAT_CONTEXT_V2: ContextBlock<ChatContextData> = {
  id: CHAT_CONTEXT_V1.id,
  version: 'v2',
  depths: [5, 3, 1],
  render(data, ctx, depth) {
    return buildChatContextText(data, ctx, depth, (sessions, blockCtx, blockDepth) =>
      buildRecentSessionsSection(sessions, blockCtx, blockDepth, { markAutoClosed: true }),
    );
  },
};
