import type { PointerEvent } from 'react';
import { Play } from 'lucide-react';
import { hapticImpact } from '@/shared/lib/haptic';
import btn from '@/shared/ui/glassButton.module.css';
import styles from './SessionPage.module.css';

function spawnRipple(e: PointerEvent<HTMLButtonElement>) {
  hapticImpact();
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = e.clientX - rect.left - size / 2;
  const y = e.clientY - rect.top - size / 2;
  const circle = document.createElement('span');
  circle.className = btn.ripple;
  circle.style.width = circle.style.height = `${size}px`;
  circle.style.left = `${x}px`;
  circle.style.top = `${y}px`;
  el.appendChild(circle);
  circle.addEventListener('animationend', () => circle.remove(), { once: true });
}

export function SessionPage() {
  return (
    <div className={styles.container}>
      <button
        className={btn.glassButton}
        type="button"
        onPointerDown={spawnRipple}
      >
        <Play size={20} strokeWidth={2.5} />
        <span>Начать тренировку</span>
      </button>
      <p className={styles.hint}>Нет активной тренировки</p>
    </div>
  );
}
