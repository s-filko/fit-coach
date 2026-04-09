import { useLocation, useNavigate, Outlet } from 'react-router';
import { Tabbar, FixedLayout } from '@telegram-apps/telegram-ui';
import { User, ClipboardList, Dumbbell, History, Search } from 'lucide-react';

const tabs = [
  { path: '/', label: 'Профиль', Icon: User },
  { path: '/plan', label: 'План', Icon: ClipboardList },
  { path: '/session', label: 'Тренировка', Icon: Dumbbell },
  { path: '/history', label: 'История', Icon: History },
  { path: '/exercises', label: 'Каталог', Icon: Search },
] as const;

function isTabActive(tabPath: string, pathname: string): boolean {
  if (tabPath === '/') return pathname === '/';
  return pathname === tabPath || pathname.startsWith(`${tabPath}/`);
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div style={{ paddingBottom: 80 }}>
      <Outlet />

      <FixedLayout style={{ zIndex: 10, padding: 0 }}>
        <Tabbar>
          {tabs.map((tab) => (
            <Tabbar.Item
              key={tab.path}
              text={tab.label}
              selected={isTabActive(tab.path, location.pathname)}
              onClick={() => navigate(tab.path)}
            >
              <tab.Icon size={24} />
            </Tabbar.Item>
          ))}
        </Tabbar>
      </FixedLayout>
    </div>
  );
}
