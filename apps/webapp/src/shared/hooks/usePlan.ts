import { useEffect, useState } from 'react';

import { apiRequest } from '@/shared/api/client';
import type { WorkoutPlan } from '@/shared/types';

interface UsePlanResult {
  plan: WorkoutPlan | null;
  loading: boolean;
  error: string | null;
}

export function usePlan(): UsePlanResult {
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return { plan, loading, error };
}
