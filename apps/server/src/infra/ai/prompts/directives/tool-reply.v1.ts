import type { DirectiveModule } from '@infra/ai/prompts/types';

export const TOOL_REPLY_V1: DirectiveModule = {
  id: 'tool-reply',
  version: 'v1',
  render: () => ({
    id: 'directive.tool-reply',
    required: true,
    text: [
      'TOOL CALL RULE: Every response that contains a tool call MUST also contain visible text for the user.',
      'The text MUST appear in the same response as the tool call — never send a tool call alone.',
      '',
      'CORRECT (tool call + text together):',
      '  text: "Moving you to the session planner now."',
      '  tool_call: request_transition({ toPhase: "session_planning" })',
      '',
      'WRONG (tool call without text — this will break the app):',
      '  tool_call: request_transition({ toPhase: "session_planning" })',
      '  text: ""  ← empty, user sees nothing',
    ].join('\n'),
  }),
};
