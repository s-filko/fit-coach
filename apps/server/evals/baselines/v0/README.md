# Baseline v0

Per-check pass/fail aggregates for the P0 prompt set, one JSON per phase
(`version`, `model`, `samples`, `recordedAt`, `entries`). Written by
`RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase <phase> --baseline write`,
read by `--baseline compare`. Baselines are otherwise immutable: never written
by a PR, only by the nightly job on `dev`.

## Re-freeze record (2026-09-15)

v0 was re-frozen once, on the seeded harness:

- **Harness commit:** `2049f0f3e40e6a79b042d9c1666b872767a127db`
  (`fix(evals): seed case state.messages into the episode memory the model sees`).
  Before it, the eval stub's `getMessagesForPrompt` returned `[]`, so every case
  ran with empty episode memory regardless of its `state.messages`.
- **Route:** direct Z.AI coding endpoint, model `glm-5.3` (from app config; no
  `EVAL_MODEL` override exists).
- **Sampling:** 3 samples per case; a case check passes at ≥ ⌈n/2⌉ samples.
- **Immutability exception (recorded, not implied):** this re-freeze overwrote
  the first freeze (2026-09-14) **before** v0 was ever used by a
  `--baseline compare` — the old freeze never gated anything, so no comparison
  in history refers to it.
