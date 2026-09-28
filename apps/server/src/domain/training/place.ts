/**
 * set-kind plan Task 2 (D6): the loader's ask-once-per-session rule, as named constants (close-out
 * review advisory R1 — was two bare literals in `training.spec.ts`). The loader asks once when the
 * user's last `RECENT_PLACES_WINDOW` real workouts carry >= `PLACE_AMBIGUOUS_THRESHOLD` distinct
 * places and today's session has none.
 */
export const RECENT_PLACES_WINDOW = 10;
export const PLACE_AMBIGUOUS_THRESHOLD = 2;
