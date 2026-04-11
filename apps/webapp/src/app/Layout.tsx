import { useLocation, useNavigate, Outlet } from 'react-router';
import { ClipboardList, Dumbbell, History, Search } from 'lucide-react';
import { TabIsland, type TabDef } from '@/shared/ui/TabIsland';

const tabs: readonly TabDef[] = [
  { path: '/plan', label: 'План', Icon: ClipboardList },
  { path: '/session', label: 'Тренировка', Icon: Dumbbell },
  { path: '/history', label: 'История', Icon: History },
  { path: '/exercises', label: 'Каталог', Icon: Search },
];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 46px)', paddingBottom: 72 }}>
      <Outlet />
      <TabIsland tabs={tabs} activePath={location.pathname} onNavigate={navigate} />
    </div>
  );
}
