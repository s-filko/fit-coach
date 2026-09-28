import { formatRunTranscript, formatTranscripts } from '../transcript-formatter';
import type { LlmCallRecord, RunSummary, RunTranscript, TurnRecord } from '../transcript-reader';

const T0 = new Date('2026-09-21T09:00:00.000Z');
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);

const baseRun: RunSummary = {
  runId: 'run-1',
  userId: 'user-1',
  createdAt: at(1000),
  phaseIn: 'training',
  phaseOut: null,
  model: 'z-ai/glm-5.3',
  outcome: 'ok',
  errorClass: null,
  errorMessage: null,
  tokensIn: 100,
  tokensOut: 20,
  latencyMs: 900,
};

const humanTurn = (content: string, seq: number | null, offsetMs = 0): TurnRecord => ({
  kind: 'human',
  role: 'user',
  content,
  payload: null,
  seq,
  createdAt: at(offsetMs),
});

const aiTurn = (content: string, seq: number | null, offsetMs = 0): TurnRecord => ({
  kind: 'ai',
  role: content ? 'assistant' : 'system',
  content,
  payload: null,
  seq,
  createdAt: at(offsetMs),
});

describe('formatRunTranscript (print-transcript)', () => {
  it('renders a normal run: human message, ai answer, in order, no warnings', () => {
    const rt: RunTranscript = {
      runId: 'run-1',
      run: baseRun,
      turns: [humanTurn('привет', 1, 0), aiTurn('Здравствуй!', 2, 100)],
      llmCalls: [],
    };

    const out = formatRunTranscript(rt, new Map(), { includePayloads: false });

    expect(out).toContain('=== RUN run-1 ===');
    expect(out).toContain('outcome: ok');
    expect(out).toContain('HUMAN: привет');
    expect(out).toContain('AI: Здравствуй!');
    expect(out.indexOf('HUMAN: привет')).toBeLessThan(out.indexOf('AI: Здравствуй!'));
    expect(out).not.toContain('NO ANSWER');
    expect(out).not.toContain('predate INV-LLM-010');
  });

  it('renders tool calls and results between the ai turn that requested them and the ai turn that answers', () => {
    const rt: RunTranscript = {
      runId: 'run-1',
      run: baseRun,
      turns: [
        humanTurn('следующий подход', 1, 0),
        { ...aiTurn('', 2, 50), payload: { tool_calls: [{ id: 'c1', name: 'log_set', args: { reps: 8 } }] } },
        {
          kind: 'tool_call',
          role: 'system',
          content: 'log_set',
          payload: { tool_call_id: 'c1', args: { reps: 8 } },
          seq: 3,
          createdAt: at(60),
        },
        {
          kind: 'tool_result',
          role: 'system',
          content: 'Записано.',
          payload: { tool_call_id: 'c1', status: 'ok' },
          seq: 4,
          createdAt: at(70),
        },
        aiTurn('Готово, что дальше?', 5, 100),
      ],
      llmCalls: [],
    };

    const out = formatRunTranscript(rt, new Map(), { includePayloads: false });

    expect(out).toContain('AI: (no text — calling a tool, see below)');
    expect(out).toContain('TOOL_CALL log_set({"reps":8})');
    expect(out).toContain('TOOL_RESULT [ok] Записано.');
    expect(out).toContain('AI: Готово, что дальше?');
    const order = ['no text', 'TOOL_CALL', 'TOOL_RESULT', 'Готово'].map(s => out.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('marks a failed run visibly, with its error class and message', () => {
    const rt: RunTranscript = {
      runId: 'run-2',
      run: {
        ...baseRun,
        runId: 'run-2',
        outcome: 'llm_unavailable',
        errorClass: 'LlmUnavailableError',
        errorMessage: 'upstream 503',
      },
      turns: [humanTurn('следующий подход', 1, 0)],
      llmCalls: [],
    };

    const out = formatRunTranscript(rt, new Map(), { includePayloads: false });

    expect(out).toContain('RUN FAILED: llm_unavailable — LlmUnavailableError: upstream 503');
  });

  it('BUG-022: a human message with no visible ai answer is flagged, not silently absent', () => {
    const rt: RunTranscript = {
      runId: 'run-2',
      run: { ...baseRun, runId: 'run-2', outcome: 'core_error', errorClass: 'CoreError', errorMessage: 'boom' },
      turns: [humanTurn('накинул 10кг', 1, 0)],
      llmCalls: [],
    };

    const out = formatRunTranscript(rt, new Map(), { includePayloads: false });

    expect(out).toContain('NO ANSWER RECORDED');
    expect(out).toContain('BUG-022');
  });

  it('a tool-only ai turn (no text) does not count as an answer on its own', () => {
    const rt: RunTranscript = {
      runId: 'run-1',
      run: baseRun,
      turns: [humanTurn('следующий подход', 1, 0), aiTurn('', 2, 50)],
      llmCalls: [],
    };

    expect(formatRunTranscript(rt, new Map(), { includePayloads: false })).toContain('NO ANSWER RECORDED');
  });

  it('INV-LLM-010: warns when a row predates seq, without dropping or silently reordering it', () => {
    const rt: RunTranscript = {
      runId: 'run-1',
      run: baseRun,
      turns: [humanTurn('legacy row', null, 0), aiTurn('legacy reply', null, 10)],
      llmCalls: [],
    };

    const out = formatRunTranscript(rt, new Map(), { includePayloads: false });

    expect(out).toContain('predate INV-LLM-010');
    expect(out).toContain('legacy row');
    expect(out).toContain('legacy reply');
    expect(out).toContain('seq —');
  });

  describe('with --payloads', () => {
    const call = (overrides: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
      callIndex: 1,
      model: 'z-ai/glm-5.3',
      request: {
        model: 'z-ai/glm-5.3',
        temperature: 0.7,
        messages: [
          { role: 'system', contentHash: 'hash-1' },
          { role: 'user', content: 'следующий подход' },
        ],
      },
      response: { text: 'Отлично!', finishReason: 'stop', usage: { promptTokens: 50, completionTokens: 5 } },
      promptHashes: ['hash-1'],
      latencyMs: 500,
      errorClass: null,
      errorMessage: null,
      createdAt: at(0),
      ...overrides,
    });

    it('resolves a system prompt hash to its stored content', () => {
      const rt: RunTranscript = { runId: 'run-1', run: baseRun, turns: [], llmCalls: [call()] };
      const out = formatRunTranscript(rt, new Map([['hash-1', 'RULES: only discuss fitness.']]), {
        includePayloads: true,
      });

      expect(out).toContain('[system] RULES: only discuss fitness.');
      expect(out).toContain('response: "Отлично!" finishReason=stop tokensIn=50 tokensOut=5');
    });

    it('cache-accounting: shows cacheRead/reasoning when the response usage carries them', () => {
      const rt: RunTranscript = {
        runId: 'run-1',
        run: baseRun,
        turns: [],
        llmCalls: [
          call({
            response: {
              text: 'Отлично!',
              finishReason: 'stop',
              usage: { promptTokens: 5765, completionTokens: 30, cacheReadTokens: 5760, reasoningTokens: 30 },
            },
          }),
        ],
      };
      const out = formatRunTranscript(rt, new Map([['hash-1', 'RULES: only discuss fitness.']]), {
        includePayloads: true,
      });

      expect(out).toContain(
        'response: "Отлично!" finishReason=stop tokensIn=5765 tokensOut=30 cacheRead=5760 reasoning=30',
      );
    });

    it('cache-accounting: a response without cache/reasoning details omits them, unchanged from before', () => {
      const rt: RunTranscript = { runId: 'run-1', run: baseRun, turns: [], llmCalls: [call()] };
      const out = formatRunTranscript(rt, new Map([['hash-1', 'RULES: only discuss fitness.']]), {
        includePayloads: true,
      });

      expect(out).not.toContain('cacheRead=');
      expect(out).not.toContain('reasoning=');
    });

    it('BR-LLM-011: prints that a pruned blob aged out, with its hash, never an empty string or a crash', () => {
      const rt: RunTranscript = { runId: 'run-1', run: baseRun, turns: [], llmCalls: [call()] };
      const out = formatRunTranscript(rt, new Map([['hash-1', null]]), { includePayloads: true });

      expect(out).toContain('[system] [payload aged out — retention pruned this prompt, hash hash-1]');
    });

    it('prints that a whole call’s request aged out when the row itself was pruned', () => {
      const rt: RunTranscript = { runId: 'run-1', run: baseRun, turns: [], llmCalls: [call({ request: null })] };
      const out = formatRunTranscript(rt, new Map(), { includePayloads: true });

      expect(out).toContain('request: [aged out — retention pruned this payload]');
    });

    it('a failed call shows its error, not a crash on a null response', () => {
      const rt: RunTranscript = {
        runId: 'run-1',
        run: baseRun,
        turns: [],
        llmCalls: [call({ response: null, errorClass: 'Error', errorMessage: 'timeout', promptHashes: [] })],
      };
      const out = formatRunTranscript(rt, new Map(), { includePayloads: true });

      expect(out).toContain('API CALL model=z-ai/glm-5.3 latency=500ms FAILED: Error: timeout');
      expect(out).not.toContain('response:');
    });

    it('prints a repeated system prompt hash in full once, then a short reference — not the whole text every time', () => {
      const rt: RunTranscript = {
        runId: 'run-1',
        run: baseRun,
        turns: [],
        llmCalls: [call({ callIndex: 1, createdAt: at(0) }), call({ callIndex: 2, createdAt: at(10) })],
      };
      const out = formatRunTranscript(rt, new Map([['hash-1', 'RULES: only discuss fitness.']]), {
        includePayloads: true,
      });

      expect(out.match(/RULES: only discuss fitness\./g)).toHaveLength(1);
      expect(out).toContain('[system] [same prompt as shown earlier, hash hash-1]');
    });

    it('prints request params beyond temperature/reasoningEffort/tools — maxTokens and toolChoice, as actually stored', () => {
      const rt: RunTranscript = {
        runId: 'run-1',
        run: baseRun,
        turns: [],
        llmCalls: [
          call({
            request: {
              model: 'z-ai/glm-5.3',
              messages: [{ role: 'user', content: 'следующий подход' }],
              maxTokens: 512,
              toolChoice: 'auto',
              topP: 0.9,
              stop: ['\n\n'],
              responseFormat: { type: 'json_object' },
            },
          }),
        ],
      };
      const out = formatRunTranscript(rt, new Map(), { includePayloads: true });

      expect(out).toContain('maxTokens=512');
      expect(out).toContain('toolChoice="auto"');
      expect(out).toContain('topP=0.9');
      expect(out).toContain('stop=["\\n\\n"]');
      expect(out).toContain('responseFormat={"type":"json_object"}');
    });

    it('without --payloads, calls show only metadata — no request/response text at all', () => {
      const rt: RunTranscript = { runId: 'run-1', run: baseRun, turns: [], llmCalls: [call()] };
      const out = formatRunTranscript(rt, new Map([['hash-1', 'RULES: only discuss fitness.']]), {
        includePayloads: false,
      });

      expect(out).not.toContain('RULES:');
      expect(out).not.toContain('response:');
      expect(out).toContain('API CALL model=z-ai/glm-5.3 latency=500ms');
    });
  });

  it('a run with no conversation_runs row at all still prints, saying so, not crashing', () => {
    const rt: RunTranscript = { runId: 'run-3', run: null, turns: [], llmCalls: [] };
    const out = formatRunTranscript(rt, new Map(), { includePayloads: false });

    expect(out).toContain('=== RUN run-3 ===');
    expect(out).toContain('no conversation_runs row');
  });
});

describe('formatTranscripts (multi-run)', () => {
  it('reports no runs found instead of an empty string', () => {
    expect(formatTranscripts([], new Map(), { includePayloads: false })).toBe('(no runs found)');
  });

  it('shares the seen-prompt cache across runs, so a session listing does not repeat the static prompt per run', () => {
    const call = (runId: string, offsetMs: number): LlmCallRecord => ({
      callIndex: 1,
      model: 'z-ai/glm-5.3',
      request: { model: 'z-ai/glm-5.3', messages: [{ role: 'system', contentHash: 'hash-shared' }] },
      response: null,
      promptHashes: ['hash-shared'],
      latencyMs: 100,
      errorClass: null,
      errorMessage: null,
      createdAt: at(offsetMs),
    });
    const runs: RunTranscript[] = [
      { runId: 'run-a', run: { ...baseRun, runId: 'run-a' }, turns: [], llmCalls: [call('run-a', 0)] },
      { runId: 'run-b', run: { ...baseRun, runId: 'run-b' }, turns: [], llmCalls: [call('run-b', 1000)] },
    ];

    const out = formatTranscripts(runs, new Map([['hash-shared', 'RULES: shared static block.']]), {
      includePayloads: true,
    });

    expect(out.match(/RULES: shared static block\./g)).toHaveLength(1);
    expect(out).toContain('=== RUN run-a ===');
    expect(out).toContain('=== RUN run-b ===');
  });
});
