import { createBrowserRouter } from 'react-router';

import { Layout } from './Layout';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { PlanPage } from '@/features/plan/PlanPage';
import { HistoryPage } from '@/features/history/HistoryPage';
import { SessionPage } from '@/features/session/SessionPage';
import { ExercisesPage } from '@/features/exercises/ExercisesPage';

export const router = createBrowserRouter(
  [
    {
      Component: Layout,
      children: [
        { index: true, Component: ProfilePage },
        { path: 'plan', Component: PlanPage },
        { path: 'history', Component: HistoryPage },
        { path: 'history/:id', Component: HistoryPage },
        { path: 'session', Component: SessionPage },
        { path: 'exercises', Component: ExercisesPage },
      ],
    },
  ],
  { basename: '/public/webapp' },
);
