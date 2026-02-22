# TODOs

## Conversation History — Bug Fix (critical)
Problem: `startNewPhase` deletes all conversation history on phase transition → entire training session chat is lost.
Solution: keep everything in a single `conversation_turns` table, never delete, scope the LLM prompt window to the current phase cycle (turns after the last system note).

- `startNewPhase`: remove `DELETE` of old phase rows — history is never deleted
- `getContext`: slice turns from the last `system` note (current phase cycle) for the sliding window prompt
- `reset`: remove `DELETE`, make it a no-op (history is preserved)
- Update `conversation-context` tests to reflect new no-delete behaviour

## Training Phase — Set Correction (critical)
Problem: user logged a set under the wrong exercise (Bulgarian Split Squat instead of Hip Thrust). LLM had no ability to delete or correct it — it just acknowledged and added another entry. The wrong record had to be removed manually from DB.

- Add `delete_set` and `edit_set` training intents so LLM can correct mistakes mid-session
- Add corresponding `TrainingService` methods: `deleteSet(setId)`, `editSet(setId, newData)`
- When user says "that was wrong", "delete that", "that was a different exercise" — LLM must use `delete_set` intent instead of ignoring it

## Training Phase — Real-time Set Analytics in Prompt
Problem: LLM blindly accepted a set logged at 27.5 kg when previous 3 sets were 10 kg — a clear anomaly it should have caught.

- Add per-set analytics section to the training system prompt: previous sets for current exercise, weight jumps, rep drop-offs
- LLM must flag suspicious entries before confirming: large weight jump (>50%), sudden rep drop (>40%), sets logged under wrong exercise
- If anomaly detected, LLM should ask the user to confirm before saving ("Did you mean Hip Thrust? That's a big jump from 10 kg")

## Training Phase — Coach Tone
Problem: LLM praises technique, form, and execution ("great form!", "perfect technique!") which it cannot evaluate without visual feedback — sounds unprofessional and annoying.

- Add explicit rule to training system prompt: never praise technique, form, or execution quality — these cannot be assessed without visual observation
- Praise is allowed only for measurable facts: completing a set, hitting a rep PR, finishing the session
- Keep responses concise and factual during training — less hype, more signal
- Praise must be conservative and earned — only for real achievements (PR, session completion, meaningful progress). No filler compliments. Rare praise = valuable praise
