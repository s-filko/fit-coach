import { useLocation, useNavigate, Outlet } from 'react-router';
import { ClipboardList, Dumbbell, History } from 'lucide-react';
import { TabIsland, type TabIslandItem } from '@/shared/ui/TabIsland';
import { ProfilePill } from '@/features/profile/ProfilePill';

const tabs: readonly TabIslandItem[] = [
  { id: '/plan', label: 'План', Icon: ClipboardList },
  { id: '/session', label: 'Тренировка', Icon: Dumbbell },
  { id: '/history', label: 'История', Icon: History },
];

function getActiveTabId(pathname: string): string {
  const tab = tabs.find((t) => pathname === t.id || pathname.startsWith(`${t.id}/`));
  return tab?.id ?? tabs[0].id;
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 46px)', paddingBottom: 72 }}>
      <ProfilePill />
      <Outlet />
      <TabIsland items={tabs} activeId={getActiveTabId(location.pathname)} onSelect={navigate} />
    </div>
  );
}
