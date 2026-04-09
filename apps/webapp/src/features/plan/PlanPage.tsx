import { List, Placeholder } from '@telegram-apps/telegram-ui';
import { ClipboardList } from 'lucide-react';

export function PlanPage() {
  return (
    <List>
      <Placeholder
        header="План тренировок"
        description="Активный план пока не создан. Попросите бота создать план тренировок."
      >
        <ClipboardList size={64} strokeWidth={1.5} />
      </Placeholder>
    </List>
  );
}
