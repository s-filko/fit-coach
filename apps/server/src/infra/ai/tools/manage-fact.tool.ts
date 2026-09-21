/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * manage_fact (fact-lifecycle plan Task 2, AC-FL-2/AC-FL-3/AC-FL-8): the ONE
 * tool through which the coach controls the user's memory in conversation —
 * save/correct, retract (archive: "no longer true"), delete (archive: "do not
 * store it"). Nothing is ever removed (owner decision 2026-09-21, reversing
 * AC-FL-8's erase): both roads end in an archive and the user hears "deleted" /
 * "closed"; they differ only in the recorded reason, and a deleted fact is not
 * even listed under includeArchived. So the coach never asks the user which
 * one they mean.
 *
 * The tool owns NO numbers: durability bounds and the permanent gate are
 * applied by the port via `resolveLifecycle` (fact-lifecycle.ts). Every
 * time-sensitive call takes the run clock (ctx.now) — never a fresh clock.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, userError } from '@domain/conversation/tool-outcome';
import { FACT_CATEGORIES, type IUserFactsService, type RememberFactOutcome } from '@domain/user/ports';
import { PermanentFactRefusal } from '@domain/user/services/fact-lifecycle';
import { matchFactsByQuery } from '@domain/user/services/fact-query';

import { ctxOf } from '@infra/ai/graph/state';

import { userIdOf } from './format-exercise-summary';

export interface ManageFactToolDeps {
  userFactsService: IUserFactsService;
}

const MANAGE_FACT_DESCRIPTION = [
  'Manage the durable facts you remember about the user.',
  'operation "save": store a fact the user just stated, or CORRECT an existing one (same meaning, new details — pass the corrected text).',
  'Pick durability by what the user described: "permanent" only for irreversible conditions (say so only when the user stated it explicitly — otherwise the call is rejected); "long_term" for injuries/recoveries measured in weeks or months (pass reviewInDays and a short phaseNote); "short" for states that resolve in days (pass ttlDays and on_expiry: "forget" for things that certainly pass like soreness or bad sleep, "ask_once" for a tweak or pain under load that may leave a trace).',
  'operation "retract": the user says a fact is no longer true or applies ("that is fine now", "stop using that") — the fact is never used or asked about again.',
  'operation "delete": the user does not want a fact stored ("erase that", "forget it", privacy) — it is never used, asked about or shown again, and you tell the user it was deleted.',
  'If it is unclear whether the user means retract or delete, just pick the closer one — from where they stand both end the same way, so do not ask.',
  'For retract/delete, identify the fact EITHER by factId (copied verbatim from a list_facts line, which starts with "- id <uuid>:") OR by factQuery — the distinctive words of what the user called it (e.g. "lower back"); if several facts match the query you will get their ids back — re-call with the right one. Never tell the user a fact was retracted or deleted unless the tool call succeeded.',
].join(' ');

/** What each outcome reports back to the model (AC-FL-2/AC-FL-3). */
function saveSummary(result: RememberFactOutcome): string {
  switch (result.outcome) {
    case 'created':
      // A new row linked to a closed one is a re-opening of that subject (AC-FL-3).
      return result.fact.supersedesId !== null
        ? `Fact saved: "${result.fact.fact}" (${result.fact.durability}) — a new statement re-opening a fact the user had closed.`
        : `Fact saved: "${result.fact.fact}" (${result.fact.durability}).`;
    case 'updated':
      return `Fact updated: "${result.fact.fact}" (${result.fact.durability}, ${result.fact.confirmations}× confirmed).`;
    case 'skipped_stale_evidence':
      return `Not saved: "${result.fact.fact}" was closed by the user and this statement is not newer than the closure.`;
  }
}

/**
 * BUG-020: resolves the retract/delete target. `factId` (verbatim from
 * list_facts) passes straight through; a `factQuery` matches the user's ACTIVE
 * facts — exactly one acts, several come back as a candidate list for the model
 * to re-call with the right id, none is a no-match. Returns the id, or the
 * llmError outcome the tool returns verbatim.
 */
async function resolveFactId(
  userFactsService: IUserFactsService,
  userId: string,
  input: { factId?: string; factQuery?: string },
  now: Date,
): Promise<string | { ok: false; kind: 'llm_error'; message: string }> {
  if (input.factId !== undefined) {
    return input.factId;
  }
  if (input.factQuery === undefined) {
    return {
      ok: false,
      kind: 'llm_error',
      message:
        'Missing factId: pass the fact id verbatim from list_facts, or factQuery with the distinctive words of the fact.',
    };
  }
  const { active } = await userFactsService.listFacts(userId, false, now);
  const matches = matchFactsByQuery(active, input.factQuery);
  if (matches.length === 0) {
    return {
      ok: false,
      kind: 'llm_error',
      message: `No active fact matches "${input.factQuery}". Call list_facts and use the exact id.`,
    };
  }
  if (matches.length > 1) {
    const candidates = matches.map(fact => `- id ${fact.id}: ${fact.fact}`).join('\n');
    return {
      ok: false,
      kind: 'llm_error',
      message: `Several active facts match "${input.factQuery}" — call again with the right factId:\n${candidates}`,
    };
  }
  return matches[0].id;
}

export function buildManageFactTool(deps: ManageFactToolDeps) {
  const { userFactsService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config);
      if (!userId) {
        return userError('Error: could not identify user. Please try again.');
      }
      const { now } = ctxOf(config as never);

      if (input.operation === 'save') {
        if (!input.category || !input.fact || !input.durability) {
          return llmError('operation "save" requires category, fact and durability.');
        }
        try {
          const result = await userFactsService.rememberFact(
            userId,
            {
              category: input.category,
              fact: input.fact,
              factId: input.factId,
              muscleGroup: input.muscleGroup ?? null,
              durability: input.durability,
              ttlDays: input.ttlDays,
              reviewInDays: input.reviewInDays,
              phaseNote: input.phaseNote ?? null,
              onExpiry: input.onExpiry,
              context: input.context ?? null,
              explicitPermanent: input.explicitPermanent,
              supersedesFactId: input.supersedesFactId,
            },
            now,
          );
          return ok(saveSummary(result));
        } catch (err) {
          if (err instanceof PermanentFactRefusal) {
            // The model can fix this: confirm irreversibility with the user, or
            // pick a dated class.
            return llmError(
              'Not saved: "permanent" needs an explicit statement from the user (e.g. an amputation or an irreversible diagnosis) or repeated confirmations of the same fact.',
              'Ask the user whether the condition is truly irreversible; if it is recovery-shaped, use durability "long_term" with reviewInDays instead.',
            );
          }
          throw err;
        }
      }

      // BUG-020: resolve the target. factId (verbatim from list_facts) is the
      // preferred path; without one, a factQuery — what the user called the
      // fact — resolves against the ACTIVE facts: one match acts, several are
      // reported back with their ids, none is reported as no match. Never a guess.
      const factId = await resolveFactId(userFactsService, userId, input, now);
      if (typeof factId !== 'string') {
        return factId;
      }

      if (input.operation === 'retract') {
        const retracted = await userFactsService.retractFact(userId, { factId }, now);
        if (retracted === null) {
          return llmError(`No fact with id "${factId}" for this user. Call list_facts and use the exact id.`);
        }
        return ok(`Fact archived (kept in history, never used or asked about again): "${retracted.fact}".`);
      }

      // operation === 'delete' — nothing is ever removed (owner decision 2026-09-21): the
      // fact is archived as user_deleted and the user is told it is deleted, which from
      // where they stand it is: never used, asked about or listed again.
      const forgotten = await userFactsService.forgetFact(userId, { factId }, now);
      if (forgotten === null) {
        return llmError(`No fact with id "${factId}" for this user. Call list_facts and use the exact id.`);
      }
      return ok(`Fact deleted (it will not be used, asked about or shown again): "${forgotten.fact}".`);
    },
    {
      name: 'manage_fact',
      description: MANAGE_FACT_DESCRIPTION,
      schema: z.object({
        operation: z.enum(['save', 'retract', 'delete']).describe('What to do with the fact.'),
        factId: z
          .string()
          .uuid()
          .optional()
          .describe(
            'For retract/delete, and for save when CORRECTING an existing fact: the fact id, verbatim from list_facts.',
          ),
        factQuery: z
          .string()
          .min(3)
          .optional()
          .describe(
            'For retract/delete without a factId: what the user called the fact, in its own distinctive words (e.g. "lower back").',
          ),
        category: z.enum(FACT_CATEGORIES).optional().describe('For save: the fact category.'),
        fact: z.string().min(3).optional().describe('For save: the fact in one clear sentence.'),
        muscleGroup: z.string().optional().describe('For save: the muscle group, when the fact is anatomical.'),
        durability: z
          .enum(['permanent', 'long_term', 'short'])
          .optional()
          .describe('For save: how long the fact holds (see the tool description for how to choose).'),
        ttlDays: z.number().int().positive().optional().describe('For save + short: days until it expires (1–14).'),
        reviewInDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('For save + long_term: days until you should re-ask about it (14–182).'),
        phaseNote: z.string().optional().describe('For save + long_term: the recovery phase in the user’s words.'),
        onExpiry: z.enum(['forget', 'ask_once']).optional().describe('For save + short: what happens on expiry.'),
        context: z.string().optional().describe('For save: a short "how we learned this".'),
        explicitPermanent: z
          .boolean()
          .optional()
          .describe('For save + permanent: true when the user explicitly stated irreversibility.'),
        supersedesFactId: z
          .string()
          .uuid()
          .optional()
          .describe('For save: id of the CLOSED fact this statement replaces (from list_facts).'),
      }),
    },
  );
}
