import { useState, useRef, useEffect, useCallback } from 'react';
import { User, Ruler, Weight, Target, TrendingUp, Calendar } from 'lucide-react';

import { useProfile } from '@/shared/hooks/useProfile';
import glass from '@/shared/ui/glass.module.css';
import styles from './ProfilePage.module.css';

function formatValue(value: string | number | null | undefined, suffix?: string): string {
  if (value == null || value === '') return 'Не указан';
  return suffix ? `${value} ${suffix}` : String(value);
}

export function ProfilePill() {
  const { profile, loading } = useProfile();
  const [expanded, setExpanded] = useState(false);
  const labelRef = useRef<HTMLDivElement>(null);
  const [pillWidth, setPillWidth] = useState<number | null>(null);

  useEffect(() => {
    if (labelRef.current) {
      setPillWidth(labelRef.current.offsetWidth + 24);
    }
  }, [profile]);

  const closeOnScroll = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (expanded) {
      window.addEventListener('scroll', closeOnScroll, { passive: true });
      return () => window.removeEventListener('scroll', closeOnScroll);
    }
  }, [expanded, closeOnScroll]);

  if (loading || !profile) return null;

  const displayName =
    `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || profile.username || 'Профиль';

  const bgClasses = [
    styles.pillBg,
    glass.surface,
    expanded && styles.expanded,
    expanded && glass.surfaceExpanded,
  ].filter(Boolean).join(' ');

  return (
    <>
      <div ref={labelRef} className={styles.pillLabel} onClick={() => setExpanded((v) => !v)}>
        <User size={14} strokeWidth={2} />
        {displayName}
      </div>
      <div
        className={bgClasses}
        style={{ maxWidth: expanded ? 'calc(100vw - 16px)' : pillWidth ?? 80 }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className={styles.pillSpacer} />
        <div className={styles.pillDetails}>
          <div className={styles.detailSection}>
            <div className={styles.statsRow}>
              <div className={styles.statItem}>
                <Ruler size={16} strokeWidth={1.5} />
                <span className={styles.statValue}>{profile.height ?? '—'}</span>
                <span className={styles.statUnit}>Рост, см</span>
              </div>
              <div className={styles.statItem}>
                <Weight size={16} strokeWidth={1.5} />
                <span className={styles.statValue}>{profile.weight ?? '—'}</span>
                <span className={styles.statUnit}>Вес, кг</span>
              </div>
              <div className={styles.statItem}>
                <Calendar size={16} strokeWidth={1.5} />
                <span className={styles.statValue}>{profile.age ?? '—'}</span>
                <span className={styles.statUnit}>Возраст</span>
              </div>
            </div>
          </div>
          <div className={styles.detailSection}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}><TrendingUp size={12} strokeWidth={1.5} />Уровень</span>
              <span className={styles.infoValue}>{formatValue(profile.fitnessLevel)}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}><Target size={12} strokeWidth={1.5} />Цель</span>
              <span className={styles.infoValue}>{formatValue(profile.fitnessGoal)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
