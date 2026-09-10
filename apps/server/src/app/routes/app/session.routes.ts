import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

const errorResponse = z.object({ error: z.object({ message: z.string() }) });

const sessionSetDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('strength'),
    reps: z.number(),
    weight: z.number().optional(),
    weightUnit: z.enum(['kg', 'lbs']).optional(),
    restSeconds: z.number().optional(),
  }),
  z.object({
    type: z.literal('cardio_distance'),
    distance: z.number(),
    distanceUnit: z.enum(['km', 'miles', 'meters']),
    duration: z.number(),
    inclinePct: z.number().optional(),
    pace: z.number().optional(),
    restSeconds: z.number().optional(),
  }),
  z.object({
    type: z.literal('cardio_duration'),
    duration: z.number(),
    intensity: z.enum(['low', 'moderate', 'high']).optional(),
    restSeconds: z.number().optional(),
  }),
  z.object({
    type: z.literal('functional_reps'),
    reps: z.number(),
    restSeconds: z.number().optional(),
  }),
  z.object({
    type: z.literal('isometric'),
    duration: z.number(),
    restSeconds: z.number().optional(),
  }),
  z.object({
    type: z.literal('interval'),
    workDuration: z.number(),
    restDuration: z.number(),
    rounds: z.number().optional(),
  }),
]);

async function requireUserId(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const userId = req.telegramUserId;
  if (!userId) {
    await reply.code(HTTP_UNAUTHORIZED).send({ error: { message: 'Not authenticated' } });
    return null;
  }
  return userId;
}

async function requireSessionOwnership(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  sessionId: string,
) {
  const userId = await requireUserId(req, reply);
  if (!userId) return null;

  const session = await app.services.trainingService.getSessionDetails(sessionId);
  if (!session) {
    await reply.code(HTTP_NOT_FOUND).send({ error: { message: 'Session not found' } });
    return null;
  }
  if (session.userId !== userId) {
    await reply.code(HTTP_FORBIDDEN).send({ error: { message: 'Access denied' } });
    return null;
  }
  return { userId, session };
}

export async function registerAppSessionRoutes(app: FastifyInstance): Promise<void> {
  // GET /session/active — get active session (in_progress or planning) or null
  app.get(
    '/session/active',
    {
      schema: {
        summary: 'Get active workout session or null',
        security: [{ InitDataAuth: [] }],
        response: { 401: errorResponse },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req, reply);
      if (!userId) return;

      const active = await app.services.trainingService.getActiveSession(userId);
      return reply.send({ data: active ?? null });
    },
  );

  // POST /session/start — create a new session in 'planning' status
  app.post(
    '/session/start',
    {
      schema: {
        summary: 'Start a new workout session (planning phase)',
        security: [{ InitDataAuth: [] }],
        response: { 401: errorResponse, 409: errorResponse },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req, reply);
      if (!userId) return;

      try {
        const session = await app.services.trainingService.startSession(userId, {
          status: 'planning',
        });
        return reply.send({ data: session });
      } catch (err) {
        if (err instanceof Error && err.message.includes('already have an active session')) {
          return reply.code(HTTP_CONFLICT).send({ error: { message: err.message } });
        }
        throw err;
      }
    },
  );

  // POST /session/:id/begin — transition from 'planning' to 'in_progress'
  app.post(
    '/session/:id/begin',
    {
      schema: {
        summary: 'Begin workout (planning → in_progress)',
        security: [{ InitDataAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await requireSessionOwnership(app, req, reply, id);
      if (!result) return;

      const updated = await app.services.trainingService.beginSession(id);
      return reply.send({ data: updated });
    },
  );

  // POST /session/:id/complete — finish the workout
  app.post(
    '/session/:id/complete',
    {
      schema: {
        summary: 'Complete a workout session',
        security: [{ InitDataAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await requireSessionOwnership(app, req, reply, id);
      if (!result) return;

      const completed = await app.services.trainingService.completeSession(id);
      return reply.send({ data: completed });
    },
  );

  // POST /session/:id/skip — skip the workout
  app.post(
    '/session/:id/skip',
    {
      schema: {
        summary: 'Skip a workout session',
        security: [{ InitDataAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await requireSessionOwnership(app, req, reply, id);
      if (!result) return;

      const skipped = await app.services.trainingService.skipSession(id);
      return reply.send({ data: skipped });
    },
  );

  // GET /session/:id — get session details with exercises and sets
  app.get(
    '/session/:id',
    {
      schema: {
        summary: 'Get session details',
        security: [{ InitDataAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await requireSessionOwnership(app, req, reply, id);
      if (!result) return;

      return reply.send({ data: result.session });
    },
  );

  // POST /session/:id/exercise — add or switch exercise in session
  app.post(
    '/session/:id/exercise',
    {
      schema: {
        summary: 'Add or switch exercise in session',
        security: [{ InitDataAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          exerciseId: z.string().uuid().optional(),
          exerciseName: z.string().optional(),
        }),
        response: { 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await requireSessionOwnership(app, req, reply, id);
      if (!result) return;

      const body = req.body as { exerciseId?: string; exerciseName?: string };
      const exerciseResult = await app.services.trainingService.ensureCurrentExercise(id, {
        exerciseId: body.exerciseId,
        exerciseName: body.exerciseName,
      });
      return reply.send({ data: exerciseResult });
    },
  );

  // POST /session/:id/set — log a set for the current exercise
  app.post(
    '/session/:id/set',
    {
      schema: {
        summary: 'Log a set in the current exercise',
        security: [{ InitDataAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          exerciseId: z.string().uuid().optional(),
          exerciseName: z.string().optional(),
          setData: sessionSetDataSchema,
          rpe: z.number().min(1).max(10).optional(),
          feedback: z.string().optional(),
        }),
        response: { 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await requireSessionOwnership(app, req, reply, id);
      if (!result) return;

      const body = req.body as {
        exerciseId?: string;
        exerciseName?: string;
        setData: z.infer<typeof sessionSetDataSchema>;
        rpe?: number;
        feedback?: string;
      };
      const setResult = await app.services.trainingService.logSetWithContext(id, {
        exerciseId: body.exerciseId,
        exerciseName: body.exerciseName,
        setData: body.setData,
        rpe: body.rpe,
        feedback: body.feedback,
      });
      return reply.send({ data: setResult });
    },
  );

  // POST /session/:id/recommend — AI generates/updates session plan
  app.post(
    '/session/:id/recommend',
    {
      schema: {
        summary: 'Generate AI workout recommendation for session',
        security: [{ InitDataAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z
          .object({
            comment: z.string().optional(),
          })
          .nullish(),
        response: { 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await requireSessionOwnership(app, req, reply, id);
      if (!result) return;

      const body = (req.body as { comment?: string } | undefined) ?? {};
      const recommendation = await app.services.trainingService.recommendForSession(id, result.userId, body.comment);
      return reply.send({ data: recommendation });
    },
  );

  // PATCH /session/:id/plan — update session plan after user edits
  app.patch(
    '/session/:id/plan',
    {
      schema: {
        summary: 'Update session plan exercises (reorder, delete)',
        security: [{ InitDataAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          exercises: z.array(
            z.object({
              exerciseId: z.string(),
              exerciseName: z.string().optional(),
              targetSets: z.number(),
              targetReps: z.string(),
              targetWeight: z.number().optional(),
              restSeconds: z.number(),
              notes: z.string().optional(),
            }),
          ),
        }),
        response: { 401: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await requireSessionOwnership(app, req, reply, id);
      if (!result) return;

      const body = req.body as {
        exercises: Array<{
          exerciseId: string;
          exerciseName?: string;
          targetSets: number;
          targetReps: string;
          targetWeight?: number;
          restSeconds: number;
          notes?: string;
        }>;
      };
      const updated = await app.services.trainingService.updateSessionPlan(id, body.exercises);
      return reply.send({ data: updated });
    },
  );

  // GET /session/history — training history for the user
  app.get(
    '/session/history',
    {
      schema: {
        summary: 'Get training history',
        security: [{ InitDataAuth: [] }],
        querystring: z.object({
          limit: z.coerce.number().min(1).max(50).default(10),
        }),
        response: { 401: errorResponse },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req, reply);
      if (!userId) return;

      const query = req.query as { limit: number };
      const history = await app.services.trainingService.getTrainingHistory(userId, query.limit);
      return reply.send({ data: history });
    },
  );
}
