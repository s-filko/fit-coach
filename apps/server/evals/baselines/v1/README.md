# Baseline v1

Post-P2 code (prompt modules + context assembler, PR #16 lineage) plus the six
transition datasets added by refactor-p3-tool-executor Task 1 — frozen BEFORE
any executor code landed. Same file format as v0 (`version`, `model`,
`samples`, `recordedAt`, `entries`); written by
`RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all --samples 3 --baseline write --baseline-version v1`,
read by `--baseline compare --baseline-version v1`.

## Freeze record (2026-09-17)

- **Branch:** `plan/refactor-p3-tool-executor` at the Task 1 commit
  (`test(evals): freeze per-phase tool surface; add session_planning/training transition datasets (AC-1334)`) —
  pre-executor code; the freeze process had loaded its modules before Tasks 3–7
  were written.
- **Route:** direct Z.AI coding endpoint, model `glm-5.3` (from app config).
- **Sampling:** 3 samples per case; a case check passes at ≥ ⌈n/2⌉ samples.
- **Health:** no case threw; 57 cases across 5 phases. Known soft spots that
  are baseline truth, not harness faults: `SPT-0001` `tools.must:start_training_session`
  2/3, `TRT-0003` `tools.must:log_set` 0/3 (the model answers "Записал 8 повторов
  на 80" without calling `log_set` — same wording family as BUG-014).
