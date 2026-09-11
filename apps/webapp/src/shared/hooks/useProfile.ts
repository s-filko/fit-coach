import { useEffect, useState } from 'react';

import { apiRequest } from '@/shared/api/client';
import type { User } from '@/shared/types';

interface UseProfileResult {
  profile: User | null;
  loading: boolean;
  error: string | null;
}

export function useProfile(): UseProfileResult {
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiRequest<User>('/profile')
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { profile, loading, error };
}
