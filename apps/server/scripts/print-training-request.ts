/**
 * Offline print of the exact training request (coach-simplification I1, AC-CS1-5): the real `TRAINING_COACH`,
 * `# Today` / `# History` blocks, `workoutHistory` and `assembleContext` over an in-memory fixture — no DB, no model.
 * Prints the messages, then a size table (characters and estimated tokens per part, the totals, and the tool
 * schemas separately).
 *
 * Run: npm run print-training-request [-- --case07] [--no-messages]
 *   (default fixture: an invented realistic workout; `--case07` is the shape of the i0 case-07 moment)
 */
import {
  CASE07_FIXTURE,
  PLAIN_FIXTURE,
  assembleTrainingRequest,
} from '../src/infra/ai/graph/__tests__/training-request-fixture';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fx = args.includes('--case07') ? CASE07_FIXTURE() : PLAIN_FIXTURE();
  const req = await assembleTrainingRequest(fx);

  if (!args.includes('--no-messages')) {
    for (const m of req.messages) {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
      console.log(`===== ${m._getType()} =====\n${text}\n`);
    }
  }
  const width = Math.max(...req.sections.map(s => s.name.length));
  console.log(`Fixture: ${fx.name}`);
  console.log(`${'section'.padEnd(width)}  ${'chars'.padStart(7)}  ${'est. tokens'.padStart(11)}`);
  for (const s of req.sections) {
    console.log(`${s.name.padEnd(width)}  ${String(s.chars).padStart(7)}  ${String(s.tokens).padStart(11)}`);
  }
  console.log(
    `${'TOTAL (text, no tools)'.padEnd(width)}  ${String(req.totalChars).padStart(7)}  ${String(req.totalTokens).padStart(11)}`,
  );
  console.log(`tool schemas (separate): ${req.toolSchemaChars} chars`);
}

void main();
