/**
 * set-kind plan Task 2 (D6, AC-SK-5): the narrow `set_session_place` tool writes the place on
 * the active session and confirms it; without an active session it fails soft, and nothing is
 * written when the service rejects.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';

import { buildSetSessionPlaceTool } from '../set-session-place.tool';

type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const makeTrainingService = (): jest.Mocked<ITrainingService> =>
  ({
    setSessionPlace: jest.fn().mockResolvedValue({ id: 'session-1', place: 'Fitness House на Ленина' }),
  }) as unknown as jest.Mocked<ITrainingService>;

/** The executor puts activeSessionId into configurable alongside userId. */
const makeConfig = (userId = 'u1', sessionId: string | null = 'session-1'): RunnableConfig =>
  ({
    configurable: { userId, thread_id: userId, activeSessionId: sessionId },
  }) as unknown as RunnableConfig;

describe('set-session-place.tool — set_session_place (set-kind plan D6, AC-SK-5)', () => {
  it('writes the place on the active session and names it in the confirmation', async () => {
    const trainingService = makeTrainingService();
    const tool = buildSetSessionPlaceTool({ trainingService }) as unknown as InvokableTool;

    const result = (await tool.invoke({ place: 'Fitness House на Ленина' }, makeConfig())) as ToolReturn;

    expect(trainingService.setSessionPlace).toHaveBeenCalledWith('session-1', 'Fitness House на Ленина');
    expect(isToolReturnWithUpdate(result)).toBe(false);
    expect(result).toMatchObject({ ok: true, summary: expect.stringContaining('Fitness House на Ленина') });
  });

  it('fails soft without an active session, writing nothing', async () => {
    const trainingService = makeTrainingService();
    const tool = buildSetSessionPlaceTool({ trainingService }) as unknown as InvokableTool;

    const result = (await tool.invoke({ place: 'дома' }, makeConfig('u1', null))) as ToolReturn;

    expect(trainingService.setSessionPlace).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('No active training session') });
  });
});
