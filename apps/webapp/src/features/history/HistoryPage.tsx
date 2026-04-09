import { List, Placeholder } from '@telegram-apps/telegram-ui';
import { History } from 'lucide-react';

export function HistoryPage() {
  return (
    <List>
      <Placeholder
        header="История тренировок"
        description="Здесь будут завершённые тренировки с деталями: упражнения, подходы, веса."
      >
        <History size={64} strokeWidth={1.5} />
      </Placeholder>
    </List>
  );
}
