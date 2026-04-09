import { Component, type ReactNode } from 'react';
import { Placeholder } from '@telegram-apps/telegram-ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
          <Placeholder
            header="Что-то пошло не так"
            description={import.meta.env.DEV ? this.state.error.message : 'Попробуйте перезагрузить приложение'}
          />
        </div>
      );
    }

    return this.props.children;
  }
}
