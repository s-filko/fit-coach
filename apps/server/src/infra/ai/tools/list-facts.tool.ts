/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * list_facts (fact-lifecycle plan Task 2, AC-FL-8): what answers "what do you
 * remember about me" — every ACTIVE fact grouped by category, each with its
 * date, confirmation count and durability class; the archived ones with their
 * closure reason, only when asked. The `## User Facts` prompt block is capped
 * and ordered for steering, not for review, so it cannot serve this. Reads use
 * the run clock (ctx.now): expired facts are already gone.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { ok, userError } from '@domain/conversation/tool-outcome';
import type { IUserFactsService, UserFact } from '@domain/user/ports';

import { ctxOf } from '@infra/ai/graph/state';

import { userIdOf } from './format-exercise-summary';

export interface ListFactsToolDeps {
  userFactsService: IUserFactsService;
}

/** Absolute UTC day — same deterministic format the prompt block renders. */
function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function activeLine(fact: UserFact): string {
  return `- ${fact.fact} — ${fact.durability}, ${fact.confirmations}× confirmed, updated ${day(fact.updatedAt)}`;
}

function archivedLine(fact: UserFact): string {
  return `- ${fact.fact} — closed ${day(fact.archivedAt ?? fact.updatedAt)} (reason: ${fact.archivedReason})`;
}

/** Grouped by category in the port's category-then-recency order, one section per category. */
function grouped(facts: UserFact[], line: (fact: UserFact) => string): string[] {
  const lines: string[] = [];
  let lastCategory: string | null = null;
  for (const fact of facts) {
    if (fact.category !== lastCategory) {
      lines.push(`${fact.category}:`);
      lastCategory = fact.category;
    }
    lines.push(line(fact));
  }
  return lines;
}

export function buildListFactsTool(deps: ListFactsToolDeps) {
  const { userFactsService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config);
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }
      const { now } = ctxOf(config as never);
      const includeArchived = input.includeArchived === true;

      const { active, archived } = await userFactsService.listFacts(userId, includeArchived, now);
      if (active.length === 0 && archived.length === 0) {
        return ok('Nothing is remembered about this user yet.');
      }

      const sections: string[] = [];
      if (active.length > 0) {
        sections.push(['Active facts:', ...grouped(active, activeLine)].join('\n'));
      }
      if (archived.length > 0) {
        sections.push(
          ['Archived facts (closed — never used or asked about):', ...grouped(archived, archivedLine)].join('\n'),
        );
      }
      return ok(sections.join('\n\n'));
    },
    {
      name: 'list_facts',
      description: [
        'List the durable facts remembered about the user — use it to answer "what do you remember about me", before correcting or retracting a fact (copy ids verbatim), and before saving to avoid duplicates.',
        'Every ACTIVE fact is listed, grouped by category, with its durability class, confirmation count and last-updated date.',
        'Set includeArchived=true only when the user asks what used to be remembered: archived facts come with their closure reason.',
      ].join(' '),
      schema: z.object({
        includeArchived: z.boolean().optional().describe('Include archived (closed) facts with their closure reason.'),
      }),
    },
  );
}
