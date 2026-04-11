import { Placeholder } from '@telegram-apps/telegram-ui';
import { Dumbbell } from 'lucide-react';

import { useProfile } from '@/shared/hooks/useProfile';

export function ProfilePage() {
  const { profile } = useProfile();

  const displayName = profile
    ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || profile.username || 'Профиль'
    : 'Профиль';

  return (
    <Placeholder header="Fit Coach" description={displayName}>
      <Dumbbell size={64} strokeWidth={1.5} />
    </Placeholder>
  );
}
