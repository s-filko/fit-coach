/**
 * Typed training errors. Pure domain: no imports.
 */

/**
 * INV-TRAINING-002: the user already has an `in_progress` session, so another one cannot be started
 * or begun. One class and one message for every path that refuses it — the service's ordinary check
 * and the repository's translation of the database's partial unique index (the race loser) — so the
 * two orderings are indistinguishable from outside.
 */
export class ActiveSessionExistsError extends Error {
  constructor() {
    super('You already have an active session. Please complete or skip it first.');
    this.name = 'ActiveSessionExistsError';
  }
}
