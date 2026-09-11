import { List, Placeholder } from '@telegram-apps/telegram-ui';
import { Search } from 'lucide-react';

export function ExercisesPage() {
  return (
    <List>
      <Placeholder
        header="Каталог упражнений"
        description="Здесь будет поиск по упражнениям: категории, мышечные группы, оборудование."
      >
        <Search size={64} strokeWidth={1.5} />
      </Placeholder>
    </List>
  );
}
