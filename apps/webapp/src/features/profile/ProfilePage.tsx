import { List, Section, Cell, Placeholder, Switch, Spinner } from '@telegram-apps/telegram-ui';
import { Dumbbell, Moon } from 'lucide-react';

import { useTheme } from '@/App';
import { useProfile } from '@/shared/hooks/useProfile';

const GENDER_LABELS: Record<string, string> = {
  male: 'Мужской',
  female: 'Женский',
};

function formatValue(value: string | number | null | undefined, suffix?: string): string {
  if (value == null || value === '') return 'Не указан';
  return suffix ? `${value} ${suffix}` : String(value);
}

export function ProfilePage() {
  const { profile, loading, error } = useProfile();
  const { appearance, toggle } = useTheme();

  if (loading) {
    return (
      <Placeholder>
        <Spinner size="m" />
      </Placeholder>
    );
  }

  if (error) {
    return (
      <Placeholder header="Ошибка" description={error}>
        <Dumbbell size={64} strokeWidth={1.5} />
      </Placeholder>
    );
  }

  const displayName = profile
    ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || profile.username || 'Профиль'
    : 'Профиль';

  return (
    <List>
      <Placeholder header="Fit Coach" description={displayName}>
        <Dumbbell size={64} strokeWidth={1.5} />
      </Placeholder>

      <Section header="Основные данные">
        <Cell subtitle={profile?.gender ? (GENDER_LABELS[profile.gender] ?? profile.gender) : 'Не указан'}>
          Пол
        </Cell>
        <Cell subtitle={formatValue(profile?.age)}>Возраст</Cell>
        <Cell subtitle={formatValue(profile?.height, 'см')}>Рост</Cell>
        <Cell subtitle={formatValue(profile?.weight, 'кг')}>Вес</Cell>
      </Section>

      <Section header="Тренировки">
        <Cell subtitle={formatValue(profile?.fitnessGoal)}>Цель</Cell>
        <Cell subtitle={formatValue(profile?.fitnessLevel)}>Уровень</Cell>
      </Section>

      <Section header="Настройки">
        <Cell
          before={<Moon size={20} />}
          after={<Switch checked={appearance === 'dark'} onChange={toggle} />}
        >
          Тёмная тема
        </Cell>
      </Section>
    </List>
  );
}
