import { evaluateTransition, TRANSITION_MATRIX } from '../transitions';

describe('TRANSITION_MATRIX (BR-CONV-015)', () => {
  it.each(Object.entries(TRANSITION_MATRIX))('BR-CONV-015: %s → %j is the allowed set', (from, targets) => {
    expect(Array.isArray(targets)).toBe(true);
    expect(targets.length).toBeGreaterThan(0);
  });

  it("BR-CONV-015: matches today's guard matrix verbatim", () => {
    expect(TRANSITION_MATRIX).toEqual({
      registration: ['chat', 'plan_creation'],
      chat: ['plan_creation', 'session_planning'],
      plan_creation: ['chat', 'session_planning'],
      session_planning: ['training', 'chat'],
      training: ['chat'],
    });
  });
});

describe('evaluateTransition', () => {
  it('BR-CONV-015: allows every matrix edge', () => {
    for (const [from, targets] of Object.entries(TRANSITION_MATRIX)) {
      for (const to of targets) {
        expect(
          evaluateTransition({ phase: from as never, activeSessionId: 's', request: { toPhase: to as never } }),
        ).toEqual({ ok: true, toPhase: to });
      }
    }
  });

  it('BR-CONV-015: blocks edges not in the matrix', () => {
    expect(
      evaluateTransition({ phase: 'registration', activeSessionId: null, request: { toPhase: 'training' } }),
    ).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
  });

  it('BR-CONV-017: blocks training → session_planning', () => {
    expect(
      evaluateTransition({ phase: 'training', activeSessionId: 's', request: { toPhase: 'session_planning' } }),
    ).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('BR-CONV-016: blocks a transition into training without an active session', () => {
    expect(
      evaluateTransition({ phase: 'session_planning', activeSessionId: null, request: { toPhase: 'training' } }),
    ).toEqual({ ok: false, reason: 'no_active_session' });
  });

  it("BR-CONV-018: training → chat is allowed with a session (completion is the handler's job)", () => {
    expect(evaluateTransition({ phase: 'training', activeSessionId: 's', request: { toPhase: 'chat' } })).toEqual({
      ok: true,
      toPhase: 'chat',
    });
  });

  it('allows training → chat even without a session (leaving, not entering)', () => {
    expect(evaluateTransition({ phase: 'training', activeSessionId: null, request: { toPhase: 'chat' } })).toEqual({
      ok: true,
      toPhase: 'chat',
    });
  });
});
