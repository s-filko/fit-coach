import { List, Placeholder } from '@telegram-apps/telegram-ui';
import { Dumbbell } from 'lucide-react';

export function SessionPage() {
  return (
    <List>
      <Placeholder
        header="Тренировка"
        description="Нет активной тренировки. Начните сессию через бота."
      >
        <Dumbbell size={64} strokeWidth={1.5} />
      </Placeholder>
    </List>
  );
}
