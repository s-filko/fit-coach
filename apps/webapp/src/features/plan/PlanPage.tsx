import type { PointerEvent } from 'react';
import { useCallback, useState } from 'react';
import { Spinner } from '@telegram-apps/telegram-ui';
import { ClipboardList, Dumbbell, Clock, Sparkles } from 'lucide-react';
import { hapticImpact } from '@/shared/lib/haptic';
import { usePlan } from '@/shared/hooks/usePlan';
import btn from '@/shared/ui/glassButton.module.css';
import styles from './PlanPage.module.css';

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

const GOALS = [
  { value: 'набор массы', label: 'Набор массы' },
  { value: 'похудение', label: 'Похудение' },
  { value: 'сила', label: 'Сила' },
  { value: 'выносливость', label: 'Выносливость' },
  { value: 'общий тонус', label: 'Общий тонус' },
];

export function PlanPage() {
  const { plan, loading, error, createPlan, creating } = usePlan();
  const [showForm, setShowForm] = useState(false);
  const [goal, setGoal] = useState('');
  const [days, setDays] = useState(3);
  const [equipment, setEquipment] = useState('');

  const handleCreate = useCallback(async () => {
    if (!goal) return;
    hapticImpact();
    await createPlan({
      goal,
      daysPerWeek: days,
      equipment: equipment.trim() || undefined,
    });
    setShowForm(false);
  }, [goal, days, equipment, createPlan]);

  if (loading) {
    return (
      <div className={styles.center}>
        <Spinner size="m" />
      </div>
    );
  }

  if (creating) {
    return (
      <div className={styles.center}>
        <Spinner size="m" />
        <p className={styles.generatingText}>AI составляет план…</p>
        <p className={styles.hint}>Это займёт 10–20 секунд</p>
      </div>
    );
  }

  if (error && !plan) {
    return (
      <div className={styles.center}>
        <p className={styles.hint}>{error}</p>
      </div>
    );
  }

  if (showForm) {
    return (
      <div className={styles.formContainer}>
        <h2 className={styles.formTitle}>Новый план тренировок</h2>

        <div className={styles.field}>
          <label className={styles.label}>Цель</label>
          <div className={styles.chips}>
            {GOALS.map((g) => (
              <button
                key={g.value}
                type="button"
                className={`${styles.chip} ${goal === g.value ? styles.chipActive : ''}`}
                onClick={() => { hapticImpact('light'); setGoal(g.value); }}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Дней в неделю</label>
          <div className={styles.daysRow}>
            {[2, 3, 4, 5, 6].map((d) => (
              <button
                key={d}
                type="button"
                className={`${styles.dayBtn} ${days === d ? styles.dayBtnActive : ''}`}
                onClick={() => { hapticImpact('light'); setDays(d); }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Оборудование (опционально)</label>
          <input
            type="text"
            className={styles.input}
            placeholder="Полный зал, гантели, турник…"
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
          />
        </div>

        <div className={styles.formActions}>
          <button
            className={btn.glassButton}
            type="button"
            disabled={!goal}
            onPointerDown={spawnRipple}
            onClick={() => void handleCreate()}
          >
            <Sparkles size={18} strokeWidth={2.5} />
            <span>Сгенерировать план</span>
          </button>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => { setShowForm(false); setGoal(''); }}
          >
            Отмена
          </button>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className={styles.center}>
        <ClipboardList size={48} strokeWidth={1.5} className={styles.icon} />
        <p className={styles.emptyTitle}>Нет активного плана</p>
        <button
          className={btn.glassButton}
          type="button"
          onPointerDown={spawnRipple}
          onClick={() => setShowForm(true)}
        >
          <Sparkles size={20} strokeWidth={2.5} />
          <span>Создать план</span>
        </button>
        <p className={styles.hint}>AI составит персональную программу</p>
      </div>
    );
  }

  const { planJson } = plan;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>{plan.name}</h2>
        <p className={styles.subtitle}>
          {planJson.goal} · {planJson.trainingStyle}
        </p>
      </div>

      {planJson.sessionTemplates.map((template) => (
        <div key={template.key} className={styles.templateCard}>
          <div className={styles.templateHeader}>
            <Dumbbell size={16} strokeWidth={2} />
            <span className={styles.templateName}>{template.name}</span>
            <span className={styles.templateMeta}>
              <Clock size={12} strokeWidth={2} />
              {template.estimatedDuration} мин
            </span>
          </div>
          <p className={styles.templateFocus}>{template.focus}</p>
          <ul className={styles.exerciseList}>
            {template.exercises.map((ex, i) => (
              <li key={i} className={styles.exerciseItem}>
                <span className={styles.exerciseName}>{ex.exerciseName}</span>
                <span className={styles.exerciseDetails}>
                  {ex.targetSets} × {ex.targetReps}
                  {ex.targetWeight ? ` · ${ex.targetWeight} кг` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {planJson.progressionRules.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Прогрессия</h3>
          <ul className={styles.rulesList}>
            {planJson.progressionRules.map((rule, i) => (
              <li key={i} className={styles.rule}>{rule}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
