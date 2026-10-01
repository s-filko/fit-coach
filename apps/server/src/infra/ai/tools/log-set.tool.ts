/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { llmError, ok, systemError } from '@domain/conversation/tool-outcome';
import { effortHint, type HintSet } from '@domain/training/load-plan';
import type { ITrainingService } from '@domain/training/ports';
import { isRetroLog, lastActivityOf, RETRO_SET_OFFSET_MS } from '@domain/training/session-timing';
import { SetDataSchema } from '@domain/training/set-data.types';
import type { SessionSet } from '@domain/training/types';

import { maybeCtxOf } from '@infra/ai/graph/state';
import { formatSetData } from '@infra/ai/prompts/blocks/training-workout-overview.v1';
import { formatExerciseSummary, sessionIdOf } from '@infra/ai/tools/format-exercise-summary';

import { createLogger } from '@shared/logger';
import { isDatabaseFailure } from '@shared/pg-error-cause';
import { roundRpeToHalf } from '@shared/rpe';

import { userIdOf } from './format-exercise-summary';

const log = createLogger('training-tools');

export interface LogSetToolDeps {
  trainingService: ITrainingService;
  /** Load plan (load-plan plan Task 5b, D10): the completion summary's Target line drops the plan weight. */
  loadPlanPlannerRebind?: boolean;
}

/** A stored set as the effort hint reads it. */
function hintSetOf(s: SessionSet): HintSet {
  const d = s.setData;
  return {
    reps: d.type === 'strength' || d.type === 'functional_reps' ? d.reps : 0,
    weight: d.type === 'strength' ? (d.weight ?? null) : null,
    rpe: s.rpe,
    feedback: s.userFeedback,
    isWarmup: s.setKind === 'warmup',
  };
}

export function buildLogSetTool(deps: LogSetToolDeps) {
  const { trainingService } = deps;

  return tool(
    async (input, config) => {
      const userId = userIdOf(config) ?? '';
      const sessionId = sessionIdOf(config);
      if (!sessionId) {
        log.error({ userId }, 'log_set called without active sessionId');
        return systemError('No active training session found. Cannot log set.');
      }

      // Build setData from flat fields — avoids LLM confusion with nested object schemas
      const setData = (() => {
        if (input.distanceKm != null) {
          return {
            type: 'cardio_distance' as const,
            distance: input.distanceKm,
            distanceUnit: 'km' as const,
            duration: input.durationSeconds ?? 0,
            ...(input.inclinePct != null && { inclinePct: input.inclinePct }),
          };
        }
        if (input.durationSeconds != null) {
          return { type: 'cardio_duration' as const, duration: input.durationSeconds };
        }
        if (input.reps != null && input.weight != null) {
          return { type: 'strength' as const, reps: input.reps, weight: input.weight, weightUnit: 'kg' as const };
        }
        if (input.reps != null) {
          return { type: 'functional_reps' as const, reps: input.reps };
        }
        return { type: 'strength' as const, reps: 0, weight: 0, weightUnit: 'kg' as const };
      })();

      const parsed = SetDataSchema.safeParse(setData);
      if (!parsed.success) {
        return llmError(`Invalid set data: ${parsed.error.message}`);
      }

      // load-plan plan Task 3: the recommendation log's run context; ignored when the log is off.
      const runCtx = maybeCtxOf(config);

      const rpe = input.rpe != null ? roundRpeToHalf(input.rpe) : undefined;

      try {
        const session = await trainingService.getSessionDetails(sessionId);
        const lastActivityDate = session ? lastActivityOf(session) : new Date();
        // BUG-043: retro only for a session that already holds sets; a late start is live.
        const isRetro = session ? isRetroLog(session, new Date()) : false;

        let retroCreatedAt: Date | undefined;
        if (isRetro) {
          retroCreatedAt = new Date(lastActivityDate.getTime() + RETRO_SET_OFFSET_MS);
        }

        const { set, setNumber, autoCompleted } = await trainingService.logSetWithContext(sessionId, {
          exerciseId: input.exerciseId,
          exerciseName: input.exerciseName,
          setData: parsed.data,
          rpe,
          feedback: input.feedback,
          createdAt: retroCreatedAt,
          skipActivityUpdate: isRetro,
          setKind: input.setKind,
          weightBasis: input.weightBasis,
          loadPlanLog: {
            runId: runCtx?.runId ?? null,
            now: runCtx?.now ?? new Date(),
            timezone: runCtx?.user?.timezone ?? null,
            advised: input.advised,
          },
        });

        // Named for the summariser (renderTranscript over this tool's own confirmation) as much
        // as for the user — a UUID in the transcript names nothing once the set is compacted away.
        // The set is already saved at this point: a failure resolving the name degrades the
        // confirmation text, it must never turn a successful write into a reported error.
        let exerciseName = input.exerciseName ?? '';
        let hint: string | null = null;
        try {
          const finalSession = await trainingService.getSessionDetails(sessionId);
          const row = finalSession?.exercises.find(se => se.id === set.sessionExerciseId);
          exerciseName = row?.exercise.name ?? exerciseName;
          // Item 10: code decides when the coach asks the effort — a decision-critical set stored without RPE.
          hint = row
            ? effortHint({
                set: hintSetOf(set),
                earlier: (row.sets ?? []).filter(s => s.id !== set.id && s.setNumber < setNumber).map(hintSetOf),
                targetReps: row.targetReps ?? null,
                targetSets: row.targetSets ?? null,
              })
            : null;
        } catch (nameErr) {
          log.warn({ err: nameErr, sessionId }, 'log_set: could not resolve exercise name for confirmation');
        }

        // B1 (close-out review): the strength confirmation is the same text as every other set
        // listing — one formatter, no second copy of the per-hand note.
        const summary = formatSetData(set.setData);

        const kindNote = set.setKind === 'warmup' ? ' (warm-up)' : '';
        const rpeNote = rpe != null ? ` | RPE ${rpe}` : '';
        const retroNote = isRetro ? ' (retro-logged)' : '';
        const namePart = exerciseName ? ` — ${exerciseName}` : '';
        const setConfirmation = `Set ${setNumber} logged${namePart}: ${summary}${kindNote}${rpeNote}${retroNote}.${
          hint ? `\n\n${hint}` : ''
        }`;

        log.info(
          {
            audit: 'log_set',
            userId,
            sessionId,
            setId: set.id,
            exerciseId: input.exerciseId,
            setNumber,
            setData: set.setData,
            rpe: set.rpe,
            isRetro,
            retroCreatedAt: retroCreatedAt ?? null,
            autoCompleted: autoCompleted ?? null,
          },
          'AUDIT: set logged',
        );

        if (autoCompleted) {
          // BUG-037: this transition was triggered by the user's own set — the instruction
          // must tell the model to confirm that set first, not to lead with the recap.
          const prevSummary = formatExerciseSummary(autoCompleted, 'set-triggered', {
            omitTargetWeight: deps.loadPlanPlannerRebind === true,
          });
          return ok(`${setConfirmation}\n\n${prevSummary}`);
        }

        return ok(setConfirmation);
      } catch (err) {
        if (isDatabaseFailure(err)) {
          log.error({ err, sessionId }, 'log_set failed: repository/DB error');
          return systemError('Could not save the set — a database error occurred. Try again.');
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error({ err, sessionId }, 'log_set failed');
        return llmError(message);
      }
    },
    {
      name: 'log_set',
      description: [
        'Log a completed set for the current exercise.',
        'Identify the exercise with exerciseId ONLY when you have its exact UUID — copied verbatim from the SESSION PLAN or from a search_exercises result ("ID:..." line).',
        'If the exercise is not in the plan and you do not have its exact UUID, pass exerciseName instead (the server resolves it in the catalog) — never invent or guess a UUID.',
        'For strength/weighted exercises: provide reps and weight (in kg).',
        'For bodyweight exercises: provide reps only.',
        'For cardio duration (bike, elliptical): provide durationSeconds only.',
        'For isometric holds (plank, side plank, wall sit): provide durationSeconds — the hold time in SECONDS — never reps; the server stores it as a timed hold.',
        'For cardio distance (treadmill, running): provide distanceKm. durationSeconds is optional — if unknown, log without it and ask the user. Optionally: inclinePct (treadmill only).',
        'setNumber is computed automatically — do NOT pass it.',
        'Call once per set. For multiple sets reported at once, call log_set multiple times.',
        "Pass setKind 'warmup' ONLY when the user's own words say so (разминка, разминочный, warm-up, для разогрева) — never infer warm-up from a light weight alone. Omit for a normal working set.",
        "For a dumbbell/kettlebell exercise the weight is per hand by default — pass weightBasis 'total' only when the user explicitly says the weight is a combined/total figure (e.g. 'в сумме', 'total').",
      ].join(' '),
      schema: z
        .object({
          exerciseId: z
            .string()
            .uuid()
            .optional()
            .describe(
              'Exercise UUID copied verbatim from the session plan or search_exercises results. Never invent one.',
            ),
          exerciseName: z
            .string()
            .optional()
            .describe(
              'Exercise name — use when the exercise is not in the session plan and its exact UUID is unknown.',
            ),
          reps: z.number().int().positive().optional().describe('Number of repetitions performed.'),
          weight: z
            .number()
            .positive()
            .optional()
            .describe('Weight used in kilograms (kg). Omit for bodyweight exercises.'),
          durationSeconds: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Duration in seconds — for cardio exercises and for isometric holds (plank: the hold time).'),
          distanceKm: z
            .number()
            .positive()
            .optional()
            .describe(
              'Distance in km — only for cardio_distance exercises (treadmill, running). Triggers cardio_distance set type when combined with durationSeconds.',
            ),
          inclinePct: z
            .number()
            .min(0)
            .max(30)
            .optional()
            .describe('Treadmill incline in percent (0–30). Only for treadmill. Do NOT use for strength exercises.'),
          rpe: z
            .number()
            .min(1)
            .max(10)
            .optional()
            .describe(
              'Rate of Perceived Exertion (1–10): reps left in reserve = 10 − RPE. Pass it when the user gives it, or maps ' +
                'from their plain answer on how many more reps they could have done (0 → 10, 1–2 → 8, 3+ → 7).',
            ),
          feedback: z.string().optional().describe('Any user comment about this set.'),
          setKind: z
            .enum(['warmup', 'working'])
            .optional()
            .describe(
              "Mark this set as a warm-up. Only set 'warmup' when the user's own words say so " +
                '(разминка, разминочный, warm-up, для разогрева) — never infer warm-up from a light ' +
                'weight alone. Omit for a normal working set.',
            ),
          weightBasis: z
            .enum(['total'])
            .optional()
            .describe(
              'For a dumbbell/kettlebell exercise the coach assumes the weight is per hand. Pass ' +
                "'total' only when the user explicitly states the weight is a combined/total figure " +
                "(e.g. 'в сумме', 'total').",
            ),
          advised: z
            .object({
              load: z.number().positive().optional().describe('Load in kg you advised for this exercise.'),
              reps: z.number().int().positive().optional().describe('Reps per set you advised.'),
              reason: z
                .string()
                .optional()
                .describe('Why the advice departs from the LOAD PLAN suggestion — only when it does.'),
            })
            .optional()
            .describe(
              'Optional. On the FIRST working set of an exercise: the load/reps you actually advised the user for it ' +
                '(and the reason when it differs from the LOAD PLAN suggestion). Omit on later sets and when you advised nothing.',
            ),
          order: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe(
              'Execution order when logging multiple sets in one response. First set = 1, second = 2, etc. Required when calling log_set more than once per response.',
            ),
        })
        .refine(d => d.exerciseId !== undefined || d.exerciseName !== undefined, {
          message: 'Either exerciseId or exerciseName must be provided',
        })
        .refine(d => d.reps !== undefined || d.durationSeconds !== undefined || d.distanceKm !== undefined, {
          message: 'Either reps, durationSeconds, or distanceKm must be provided',
        }),
    },
  );
}
