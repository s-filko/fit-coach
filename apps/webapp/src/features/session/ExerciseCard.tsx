import { useRef, useState } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import { hapticImpact } from '@/shared/lib/haptic';
import type { RecommendedExercise } from '@/shared/types';
import styles from './ExerciseCard.module.css';

interface ExerciseCardProps {
  exercise: RecommendedExercise;
  index: number;
  onDelete: () => void;
  onDragStart: (index: number) => void;
  onDragEnter: (index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isDragOver: boolean;
}

const SWIPE_THRESHOLD = 80;

export function ExerciseCard({
  exercise,
  index,
  onDelete,
  onDragStart,
  onDragEnter,
  onDragEnd,
  isDragging,
  isDragOver,
}: ExerciseCardProps) {
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(`.${styles.dragHandle}`)) return;
    startX.current = e.clientX;
    setSwiping(true);
    cardRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!swiping) return;
    const dx = e.clientX - startX.current;
    if (dx > 0) return;
    setSwipeX(dx);
  };

  const handlePointerUp = () => {
    if (!swiping) return;
    setSwiping(false);
    if (swipeX < -SWIPE_THRESHOLD) {
      hapticImpact('medium');
      onDelete();
    }
    setSwipeX(0);
  };

  const weight = exercise.targetWeight
    ? `${exercise.targetWeight} кг`
    : '';

  const classNames = [
    styles.card,
    isDragging && styles.dragging,
    isDragOver && styles.dragOver,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={cardRef}
      className={classNames}
      style={{ transform: swipeX ? `translateX(${swipeX}px)` : undefined }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className={styles.dragHandle}
        onPointerDown={(e) => {
          e.stopPropagation();
          hapticImpact('light');
          onDragStart(index);
        }}
        onPointerEnter={() => onDragEnter(index)}
        onPointerUp={onDragEnd}
      >
        <GripVertical size={16} strokeWidth={1.5} />
      </div>

      <div className={styles.content}>
        <p className={styles.name}>{exercise.exerciseName ?? exercise.exerciseId}</p>
        <p className={styles.details}>
          {exercise.targetSets} x {exercise.targetReps}
          {weight && <span className={styles.weight}> · {weight}</span>}
        </p>
        {exercise.notes && <p className={styles.notes}>{exercise.notes}</p>}
      </div>

      <button
        type="button"
        className={styles.deleteBtn}
        onClick={(e) => {
          e.stopPropagation();
          hapticImpact('medium');
          onDelete();
        }}
      >
        <Trash2 size={16} strokeWidth={1.5} />
      </button>

      {swipeX < -SWIPE_THRESHOLD && (
        <div className={styles.deleteReveal}>
          <Trash2 size={20} />
        </div>
      )}
    </div>
  );
}
