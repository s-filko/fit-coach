import { Spinner } from '@telegram-apps/telegram-ui';
import { ClipboardList, Dumbbell, Clock } from 'lucide-react';
import { usePlan } from '@/shared/hooks/usePlan';
import styles from './PlanPage.module.css';

export function PlanPage() {
  const { plan, loading, error } = usePlan();

  if (loading) {
    return (
      <div className={styles.center}>
        <Spinner size="m" />
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

  if (!plan) {
    return (
      <div className={styles.center}>
        <ClipboardList size={48} strokeWidth={1.5} className={styles.icon} />
        <p className={styles.hint}>Плана пока нет. Попроси тренера в чате составить его.</p>
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
