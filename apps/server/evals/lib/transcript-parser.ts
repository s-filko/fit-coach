/**
 * The parser of the L3 transcript markdown that `reporter.ts` writes (formatScenarioTranscript) — next to it so the
 * format and its reader live together; the judge and the sidecar backfill import it.
 */

/** One user step of an L3 transcript, as the judge needs it. */
export interface TranscriptStep {
  stepIndex: number;
  userText: string;
  delivered: string;
  tools: string[];
  runId: string | null;
  phase: string | null;
}

export interface ParsedTranscript {
  scenarioId: string;
  steps: TranscriptStep[];
}

/** `coach: ` lines are prefixed with 7 spaces on continuation (reporter.withContinuation). */
const COACH_PAD = ' '.repeat('coach: '.length);

/**
 * Parses one `<scenario>-<ISO>.md` L3 transcript. Only `#N user:` steps come
 * out; advance steps, check lines and the trailing summary are not the judge's
 * concern. Delivered multi-line text is re-joined without the padding.
 */
export function parseTranscriptMarkdown(md: string): ParsedTranscript {
  const lines = md.split('\n');
  // Real L3 files open with run.ts's `# L3 transcript: <id> (<stamp>)` header
  // line; the `## <scenarioId>` marker sits below it — take its first match.
  const scenarioId = lines.map(line => /^## (.+)$/.exec(line)?.[1]).find(id => id !== undefined) ?? '';
  const steps: TranscriptStep[] = [];
  let current: { step: TranscriptStep; coachLines: string[] } | null = null;
  const finishCoach = (): void => {
    if (current !== null && current.coachLines.length > 0) {
      current.step.delivered = current.coachLines.join('\n');
    }
    current = null;
  };
  for (const line of lines.slice(1)) {
    const userMatch = /^#(\d+) user: ?(.*)$/.exec(line);
    if (userMatch !== null) {
      finishCoach();
      current = {
        step: {
          stepIndex: Number(userMatch[1]),
          userText: userMatch[2] ?? '',
          delivered: '',
          tools: [],
          runId: null,
          phase: null,
        },
        coachLines: [],
      };
      steps.push(current.step);
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.startsWith('coach: ')) {
      const text = line.slice('coach: '.length);
      current.coachLines.push(text === '(no delivered text)' ? '' : text);
      continue;
    }
    if (line.startsWith(COACH_PAD)) {
      current.coachLines.push(line.slice(COACH_PAD.length));
      continue;
    }
    if (line.startsWith('tools: ')) {
      const names = line.slice('tools: '.length);
      current.step.tools = names === '(none)' ? [] : names.split(', ').map(n => n.trim()).filter(n => n !== '');
      continue;
    }
    if (line.startsWith('run: ')) {
      current.step.runId = line.slice('run: '.length).trim();
      continue;
    }
    if (line.startsWith('phase: ')) {
      current.step.phase = line.slice('phase: '.length).trim();
      finishCoach();
      continue;
    }
  }
  finishCoach();
  return { scenarioId, steps };
}
