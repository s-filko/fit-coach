import { useRef } from 'react';
import { Play } from 'lucide-react';
import { hapticImpact } from '@/shared/lib/haptic';
import btn from '@/shared/ui/glassButton.module.css';
import styles from './SessionPage.module.css';

export function SessionPage() {
  const btnRef = useRef<HTMLButtonElement>(null);

  const handlePointerDown = () => {
    hapticImpact();
  };

  const handleClick = () => {
    const el = btnRef.current;
    if (!el) return;
    el.classList.remove(btn.flash);
    void el.offsetHeight;
    el.classList.add(btn.flash);
    el.addEventListener('animationend', () => el.classList.remove(btn.flash), { once: true });
  };

  return (
    <div className={styles.container}>
      <button
        ref={btnRef}
        className={btn.glassButton}
        type="button"
        onPointerDown={handlePointerDown}
        onClick={handleClick}
      >
        <Play size={20} strokeWidth={2.5} />
        <span>Начать тренировку</span>
      </button>
      <p className={styles.hint}>Нет активной тренировки</p>
    </div>
  );
}
