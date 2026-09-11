import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '@/shared/api/client';
import type { RecommendedExercise, SessionRecommendation, WorkoutSession } from '@/shared/types';

interface UseSessionResult {
  session: WorkoutSession | null;
  loading: boolean;
  error: string | null;
  /** Create a new session in 'planning' status */
  startSession: () => Promise<void>;
  starting: boolean;
  /** Ask AI for a workout recommendation (optionally with user comment) */
  recommend: (comment?: string) => Promise<void>;
  recommending: boolean;
  plan: SessionRecommendation | null;
  /** Save reordered/edited exercises list to the session */
  updatePlan: (exercises: RecommendedExercise[]) => Promise<void>;
  /** Transition from planning to in_progress */
  beginSession: () => Promise<void>;
}

export function useSession(): UseSessionResult {
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [plan, setPlan] = useState<SessionRecommendation | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiRequest<WorkoutSession | null>('/session/active')
      .then((data) => {
        if (!cancelled) {
          setSession(data);
          if (data?.sessionPlanJson) {
            setPlan(data.sessionPlanJson);
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load session');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const startSession = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const created = await apiRequest<WorkoutSession>('/session/start', {
        method: 'POST',
      });
      setSession(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setStarting(false);
    }
  }, []);

  const recommend = useCallback(async (comment?: string) => {
    if (!session) return;
    setRecommending(true);
    setError(null);
    try {
      const rec = await apiRequest<SessionRecommendation>(
        `/session/${session.id}/recommend`,
        {
          method: 'POST',
          body: comment ? { comment } : {},
        },
      );
      setPlan(rec);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to get recommendation');
    } finally {
      setRecommending(false);
    }
  }, [session]);

  const updatePlan = useCallback(async (exercises: RecommendedExercise[]) => {
    if (!session) return;
    setError(null);
    try {
      await apiRequest<WorkoutSession>(`/session/${session.id}/plan`, {
        method: 'PATCH',
        body: { exercises },
      });
      setPlan((prev) => prev ? { ...prev, exercises } : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update plan');
    }
  }, [session]);

  const beginSession = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const updated = await apiRequest<WorkoutSession>(
        `/session/${session.id}/begin`,
        { method: 'POST' },
      );
      setSession(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to begin session');
    }
  }, [session]);

  return {
    session, loading, error,
    startSession, starting,
    recommend, recommending, plan,
    updatePlan, beginSession,
  };
}
