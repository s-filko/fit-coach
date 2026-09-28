/**
 * Fact verifier live probe (fact-verification plan Task 3, D9 / AC-FV-6).
 *
 * Four hand-written cases through the REAL `verifyFactOperations` with the
 * app's real gateway and model config — the smoke that gates the merge:
 *   (1) the BUG-040 "~70%" update on the lever-machine fact → unsupported;
 *   (2) «колено болит уже пять дней» → add "Knee pain for 5 days" → supported;
 *   (3) «колено болит неделю» → add "Knee Pain for about a week" → supported;
 *   (4) the coach's non-numeric «это рычажный тренажёр» with the user's
 *       «где тут рычаг?» → unsupported.
 *
 * Prints per case: expected, verdict, reason. Exits non-zero on any mismatch.
 *
 * Run (the model calls cost quota — the ORCHESTRATOR runs this, never a task):
 *   cd apps/server && npx tsx --env-file-if-exists=.env scripts/probe-fact-verifier.ts
 *
 * NOTE: this file is outside tsconfig's `include` (like the other files in
 * scripts/), so `npm run type-check` does not cover it — type-check it
 * one-off with a temporary tsconfig extending ./tsconfig.json whose include
 * lists src and this file's path, if in doubt.
 */
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';

import type { UserFact } from '@domain/user/ports';

import { renderTranscript } from '@infra/ai/graph/nodes/compact';
import { verifyFactOperations } from '@infra/ai/graph/nodes/verify-fact-operations';
import { OpenAiLlmGateway } from '@infra/ai/llm.gateway';

const RUN_ID = 'probe-fact-verifier';
const USER_ID = 'probe-user';

/** The known fact case (1) updates — carries no "70" (the pre-BUG-040 state of fact 2075cb9f's predecessor). */
function leverMachineFact(): UserFact {
  return {
    id: '6e14cfe2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: USER_ID,
    category: 'equipment',
    fact: 'For plate-loaded lever machines, displayed plate weight excludes the machine own weight',
    factKey: 'for plate-loaded lever machines, displayed plate weight excludes the machine own weight',
    muscleGroup: null,
    confirmations: 3,
    sourceTurnId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-15T00:00:00Z'),
    durability: 'permanent',
    expiresAt: null,
    reviewAfter: null,
    phaseNote: null,
    phaseAt: null,
    onExpiry: null,
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    closedByUserAt: null,
    supersedesId: null,
    context: null,
  };
}

function episode(human: string, ai: string): { transcript: string; removed: BaseMessage[] } {
  const removed: BaseMessage[] = [
    new HumanMessage({ content: human, id: 'm0' }),
    new AIMessage({ content: ai, id: 'm0a', tool_calls: [] }),
  ];
  return { transcript: renderTranscript(removed), removed };
}

interface ProbeCase {
  name: string;
  transcript: string;
  operations: Parameters<typeof verifyFactOperations>[0]['operations'];
  knownFacts: UserFact[];
  expected: boolean;
}

const CASES: ProbeCase[] = [
  {
    // D9 (1) — the BUG-040 shape: the "~70%" is the coach's improvisation;
    // the user line is quoted verbatim but never states the figure.
    name: 'BUG-040 ~70% update on the lever-machine fact',
    ...episode('Почему ты жим ногами называешь рычажным тренажёром?', '«130 кг» = блины полностью + ~70% веса платформы, реальная нагрузка выше.'),
    operations: [
      {
        op: 'update',
        factId: leverMachineFact().id,
        category: 'equipment',
        fact: 'On the 45° leg press the platform weight (~70% of its mass) simply adds to the plates',
        durability: 'long_term',
        evidence: 'Почему ты жим ногами называешь рычажным тренажёром?',
      },
    ],
    knownFacts: [leverMachineFact()],
    expected: false,
  },
  {
    // D9 (2) — the number stated in WORDS: «пять дней» = "5 days".
    name: 'число словами: «колено болит уже пять дней» → Knee pain for 5 days',
    ...episode('Колено болит уже пять дней, приседать больно.', 'Понял, скорректирую нагрузку на ноги.'),
    operations: [
      {
        op: 'add',
        category: 'physical_constraint',
        fact: 'Knee pain for 5 days',
        muscleGroup: 'quads',
        durability: 'long_term',
        evidence: 'колено болит уже пять дней',
      },
    ],
    knownFacts: [],
    expected: true,
  },
  {
    // D9 (3) — the word-unit «неделю» = "about a week".
    name: 'слово-единица: «колено болит неделю» → Knee pain for about a week',
    ...episode('Колено болит неделю, но терпимо.', 'Понял, снизим объём на ноги.'),
    operations: [
      {
        op: 'add',
        category: 'physical_constraint',
        fact: 'Knee pain for about a week',
        muscleGroup: 'quads',
        durability: 'long_term',
        evidence: 'колено болит неделю',
      },
    ],
    knownFacts: [],
    expected: true,
  },
  {
    // D9 (4) — non-numeric coach claim: the user only asked where the lever is.
    name: 'не-числовое заявление тренера: «это рычажный тренажёр» при вопросе «где тут рычаг?»',
    ...episode('А где тут рычаг?', 'Это рычажный тренажёр, рычаг даёт выигрыш в силе.'),
    operations: [
      {
        op: 'add',
        category: 'equipment',
        fact: 'The leg press is a lever machine',
        durability: 'long_term',
        evidence: 'где тут рычаг',
      },
    ],
    knownFacts: [],
    expected: false,
  },
];

async function main(): Promise<void> {
  const gateway = new OpenAiLlmGateway();
  let failures = 0;

  for (const c of CASES) {
    const verdicts = await verifyFactOperations({
      llmGateway: gateway,
      transcript: c.transcript,
      operations: c.operations,
      knownFacts: c.knownFacts,
      runId: RUN_ID,
      userId: USER_ID,
    });
    const verdict = verdicts?.get(0);
    const supported = verdict?.supported ?? false; // null (fail closed) or no verdict → unsupported
    const ok = supported === c.expected;
    if (!ok) {
      failures += 1;
    }
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name}\n      expected supported=${c.expected}  got supported=${supported}` +
        (verdict === undefined ? '  (no verdict / fail closed)' : `  reason: ${verdict.reason}`) +
        '\n',
    );
  }

  if (failures > 0) {
    console.error(`${failures}/${CASES.length} probe cases mismatched — the merge is blocked (D9).`);
    process.exit(1);
  }
  console.log(`All ${CASES.length} probe cases matched (AC-FV-6).`);
}

void main();
