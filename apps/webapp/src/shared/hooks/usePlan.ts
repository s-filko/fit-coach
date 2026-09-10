import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '@/shared/api/client';
import type { WorkoutPlan } from '@/shared/types';

interface CreatePlanParams {
  goal: string;
  daysPerWeek: number;
  equipment?: string;
}

interface UsePlanResult {
  plan: WorkoutPlan | null;
  loading: boolean;
  error: string | null;
  createPlan: (params: CreatePlanParams) => Promise<void>;
  creating: boolean;
}

export function usePlan(): UsePlanResult {
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    apiRequest<WorkoutPlan | null>('/plan')
      .then((data) => {
        if (!cancelled) setPlan(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load plan');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const createPlan = useCallback(async (params: CreatePlanParams) => {
    setCreating(true);
    setError(null);
    try {
      const created = await apiRequest<WorkoutPlan>('/plan', {
        method: 'POST',
        body: params,
      });
      setPlan(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create plan');
    } finally {
      setCreating(false);
    }
  }, []);

  return { plan, loading, error, createPlan, creating };
}
