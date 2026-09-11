import type { PointerEvent } from 'react';
import { Dumbbell, Play } from 'lucide-react';
import { Spinner } from '@telegram-apps/telegram-ui';
import { hapticImpact } from '@/shared/lib/haptic';
import { useSession } from '@/shared/hooks/useSession';
import { PlanningView } from './PlanningView';
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
  const {
    session, loading, error,
    startSession, starting,
    recommend, recommending, plan,
    updatePlan, beginSession,
  } = useSession();

  if (loading) {
    return (
      <div className={styles.container}>
        <Spinner size="m" />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className={styles.container}>
        <p className={styles.hint}>{error}</p>
      </div>
    );
  }

  // No active session — show start button
  if (!session) {
    return (
      <div className={styles.container}>
        <button
          className={btn.glassButton}
          type="button"
          disabled={starting}
          onPointerDown={spawnRipple}
          onClick={() => void startSession()}
        >
          {starting ? (
            <Spinner size="s" />
          ) : (
            <>
              <Play size={20} strokeWidth={2.5} />
              <span>Начать тренировку</span>
            </>
          )}
        </button>
        <p className={styles.hint}>Нет активной тренировки</p>
      </div>
    );
  }

  // Session in planning — show PlanningView
  if (session.status === 'planning') {
    return (
      <PlanningView
        plan={plan}
        recommending={recommending}
        onRecommend={recommend}
        onUpdatePlan={updatePlan}
        onBegin={beginSession}
      />
    );
  }

  // Session in progress — placeholder for now
  return (
    <div className={styles.container}>
      <Dumbbell size={48} strokeWidth={1.5} />
      <p className={styles.status}>Тренировка идёт</p>
      <p className={styles.hint}>Сессия #{session.id.slice(0, 8)}</p>
    </div>
  );
}
