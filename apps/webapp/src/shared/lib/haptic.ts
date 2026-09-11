import { hapticFeedback } from '@tma.js/sdk-react';

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

export function hapticImpact(style: ImpactStyle = 'medium') {
  if (hapticFeedback.isSupported()) {
    hapticFeedback.impactOccurred(style);
  }
}

export function hapticNotification(type: 'success' | 'error' | 'warning' = 'success') {
  if (hapticFeedback.isSupported()) {
    hapticFeedback.notificationOccurred(type);
  }
}

export function hapticSelection() {
  if (hapticFeedback.isSupported()) {
    hapticFeedback.selectionChanged();
  }
}
