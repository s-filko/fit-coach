/**
 * set_language (BUG-036 + owner language rule, R3): the ONLY thing that may
 * change `users.language_code` after Telegram seeds it once at creation. It
 * writes the profile via the existing user service/repository and never
 * changes anything else — language must never change behaviour, only the
 * language of fixed texts.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import type { IUserService } from '@domain/user/ports';

import { buildSetLanguageTool } from '../set-language.tool';

type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

function makeUserService(): jest.Mocked<IUserService> {
  return {
    upsertUser: jest.fn(),
    getUser: jest.fn(),
    updateProfileData: jest.fn().mockResolvedValue({ id: 'u1', languageCode: 'ru' }),
    isRegistrationComplete: jest.fn(),
    needsRegistration: jest.fn(),
  } as unknown as jest.Mocked<IUserService>;
}

const makeConfig = (userId = 'u1'): RunnableConfig => ({ configurable: { userId } }) as unknown as RunnableConfig;

const buildTool = (svc: jest.Mocked<IUserService>): InvokableTool =>
  buildSetLanguageTool({ userService: svc }) as unknown as InvokableTool;

describe('set_language', () => {
  it('writes the profile language via userService.updateProfileData and confirms', async () => {
    const svc = makeUserService();
    const tool = buildTool(svc);

    const ret = await tool.invoke({ language: 'ru' }, makeConfig('u1'));

    expect(svc.updateProfileData).toHaveBeenCalledWith('u1', { languageCode: 'ru' });
    expect(ret).toMatchObject({ ok: true });
  });

  it('accepts en as well as ru', async () => {
    const svc = makeUserService();
    const tool = buildTool(svc);

    await tool.invoke({ language: 'en' }, makeConfig('u2'));

    expect(svc.updateProfileData).toHaveBeenCalledWith('u2', { languageCode: 'en' });
  });

  it('without a userId returns a user_error and calls nothing', async () => {
    const svc = makeUserService();
    const tool = buildTool(svc);

    const ret = await tool.invoke({ language: 'ru' }, { configurable: {} } as RunnableConfig);

    expect(ret).toMatchObject({ ok: false, kind: 'user_error' });
    expect(svc.updateProfileData).not.toHaveBeenCalled();
  });

  it('the tool description states the explicit-request rule — never inferred from what the user wrote', () => {
    const svc = makeUserService();
    const tool = buildSetLanguageTool({ userService: svc }) as unknown as { description: string };

    expect(tool.description).toMatch(/explicitly/i);
    expect(tool.description.toLowerCase()).toContain('never call it just because');
  });
});
