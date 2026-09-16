/** ADR-0013 §5.2 — what every prompt render receives; `now` is injected, never read from the clock. */
export interface PromptContextBase {
  now: Date;
  timezone: string | null;
  client: 'telegram';
}
