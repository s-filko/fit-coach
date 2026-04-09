import { useMemo } from 'react';
import { List, Section, Cell, Placeholder, Switch } from '@telegram-apps/telegram-ui';
import { Dumbbell, Moon } from 'lucide-react';

import { useTheme } from '@/App';
import { getTelegramUser } from '@/shared/lib/telegram';

export function ProfilePage() {
  const user = useMemo(getTelegramUser, []);
  const { appearance, toggle } = useTheme();

  const displayName = user
    ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
    : 'Профиль';

  return (
    <List>
      <Placeholder header="Fit Coach" description={displayName}>
        <Dumbbell size={64} strokeWidth={1.5} />
      </Placeholder>

      <Section header="Основные данные">
        <Cell subtitle="Не указан">Пол</Cell>
        <Cell subtitle="Не указан">Возраст</Cell>
        <Cell subtitle="Не указан">Рост</Cell>
        <Cell subtitle="Не указан">Вес</Cell>
      </Section>

      <Section header="Тренировки">
        <Cell subtitle="Не указана">Цель</Cell>
        <Cell subtitle="Не указан">Уровень</Cell>
      </Section>

      <Section header="Настройки">
        <Cell
          before={<Moon size={20} />}
          after={
            <Switch
              checked={appearance === 'dark'}
              onChange={toggle}
            />
          }
        >
          Тёмная тема
        </Cell>
      </Section>
    </List>
  );
}
