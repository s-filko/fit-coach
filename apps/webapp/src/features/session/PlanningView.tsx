import { useCallback, useEffect, useRef, useState } from 'react';
import { Dumbbell, Play, Clock } from 'lucide-react';
import { Spinner } from '@telegram-apps/telegram-ui';
import { hapticImpact } from '@/shared/lib/haptic';
import type { RecommendedExercise, SessionRecommendation } from '@/shared/types';
import { ExerciseCard } from './ExerciseCard';
import btn from '@/shared/ui/glassButton.module.css';
import styles from './PlanningView.module.css';

interface PlanningViewProps {
  plan: SessionRecommendation | null;
  recommending: boolean;
  onRecommend: (comment?: string) => Promise<void>;
  onUpdatePlan: (exercises: RecommendedExercise[]) => Promise<void>;
  onBegin: () => Promise<void>;
}

export function PlanningView({
  plan,
  recommending,
  onRecommend,
  onUpdatePlan,
  onBegin,
}: PlanningViewProps) {
  const [exercises, setExercises] = useState<RecommendedExercise[]>([]);
  const [comment, setComment] = useState('');
  const [beginning, setBeginning] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  useEffect(() => {
    if (plan?.exercises) {
      setExercises(plan.exercises);
    }
  }, [plan]);

  useEffect(() => {
    if (!plan && !recommending) {
      void onRecommend();
    }
  }, [plan, recommending, onRecommend]);

  const handleDelete = useCallback((index: number) => {
    const updated = exercises.filter((_, i) => i !== index);
    setExercises(updated);
    void onUpdatePlan(updated);
  }, [exercises, onUpdatePlan]);

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index;
  }, []);

  const handleDragEnter = useCallback((index: number) => {
    dragOverItem.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) {
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }

    const updated = [...exercises];
    const [removed] = updated.splice(dragItem.current, 1);
    updated.splice(dragOverItem.current, 0, removed);
    setExercises(updated);
    hapticImpact('light');

    dragItem.current = null;
    dragOverItem.current = null;
    void onUpdatePlan(updated);
  }, [exercises, onUpdatePlan]);

  const handleUpdateComment = useCallback(async () => {
    if (!comment.trim()) return;
    await onRecommend(comment);
    setComment('');
  }, [comment, onRecommend]);

  const handleBegin = useCallback(async () => {
    setBeginning(true);
    hapticImpact('heavy');
    try {
      await onBegin();
    } finally {
      setBeginning(false);
    }
  }, [onBegin]);

  if (recommending && !plan) {
    return (
      <div className={styles.loadingContainer}>
        <Spinner size="m" />
        <p className={styles.loadingText}>AI подбирает упражнения...</p>
      </div>
    );
  }

  if (!plan || exercises.length === 0) {
    return (
      <div className={styles.loadingContainer}>
        <Dumbbell size={48} strokeWidth={1.5} />
        <p className={styles.loadingText}>Не удалось загрузить план</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>{plan.sessionName}</h2>
        <div className={styles.meta}>
          <Clock size={14} strokeWidth={2} />
          <span>{plan.estimatedDuration} мин</span>
        </div>
      </div>

      {plan.reasoning && (
        <p className={styles.reasoning}>{plan.reasoning}</p>
      )}

      {plan.warnings && plan.warnings.length > 0 && (
        <div className={styles.warnings}>
          {plan.warnings.map((w, i) => (
            <p key={i} className={styles.warning}>{w}</p>
          ))}
        </div>
      )}

      <div className={styles.exerciseList}>
        {exercises.map((ex, i) => (
          <ExerciseCard
            key={ex.exerciseId}
            exercise={ex}
            index={i}
            onDelete={() => handleDelete(i)}
            onDragStart={handleDragStart}
            onDragEnter={handleDragEnter}
            onDragEnd={handleDragEnd}
            isDragging={dragItem.current === i}
            isDragOver={dragOverItem.current === i}
          />
        ))}
      </div>

      <div className={styles.commentSection}>
        <textarea
          className={styles.commentInput}
          placeholder="Пожелания к плану..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
        />
        <button
          type="button"
          className={styles.updateBtn}
          disabled={!comment.trim() || recommending}
          onClick={() => void handleUpdateComment()}
        >
          {recommending ? <Spinner size="s" /> : 'Обновить план'}
        </button>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={btn.glassButton}
          disabled={beginning || exercises.length === 0}
          onClick={() => void handleBegin()}
        >
          {beginning ? (
            <Spinner size="s" />
          ) : (
            <>
              <Play size={20} strokeWidth={2.5} />
              <span>Начать тренировку</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
