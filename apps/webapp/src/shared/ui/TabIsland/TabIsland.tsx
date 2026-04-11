import { useRef, useEffect, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import styles from './TabIsland.module.css';

export interface TabDef {
  path: string;
  label: string;
  Icon: LucideIcon;
}

interface TabIslandProps {
  tabs: readonly TabDef[];
  activePath: string;
  onNavigate: (path: string) => void;
}

/* ── animation tuning ── */

const DURATION_BASE_MS = 280;
const DURATION_PER_PX = 1.2;
const DURATION_MIN_MS = 350;
const DURATION_MAX_MS = 550;

const REST_INSET = '6px';

const BULGE_PEAK_INSET = '-14px';
const BULGE_SETTLE_INSET = '-6px';
const BULGE_DURATION_RATIO = 0.9;

const LENS_ON_AT = 0.3;
const LENS_OFF_AT = 0.7;

const MOVE_EASING = 'cubic-bezier(0.4, 0, 0.15, 1)';
const BREATHE_DURATION_MS = 450;

const IND_REST_BG = 'rgba(255,255,255,0.08)';
const IND_REST_BORDER = '1px solid rgba(255,255,255,0.06)';
const IND_PEAK_BG = 'rgba(0,0,0,0.08)';
const IND_PEAK_BORDER = '1.5px solid rgba(255,255,255,0.1)';
const IND_SETTLE_BG = 'rgba(0,0,0,0.04)';
const IND_SETTLE_BORDER = '1px solid rgba(255,255,255,0.08)';

/* ── helpers ── */

function getActiveIndex(tabs: readonly TabDef[], path: string): number {
  return tabs.findIndex((t) =>
    t.path === '/' ? path === '/' : path === t.path || path.startsWith(`${t.path}/`),
  );
}

function getTabRect(navEl: HTMLElement, wrapEl: HTMLElement, idx: number) {
  const tabEl = navEl.children[idx] as HTMLElement | undefined;
  if (!tabEl) return null;
  const wr = wrapEl.getBoundingClientRect();
  const tr = tabEl.getBoundingClientRect();
  return { left: tr.left - wr.left, width: tr.width };
}

function placeIndicator(el: HTMLElement, left: number, width: number) {
  el.style.left = `${left}px`;
  el.style.width = `${width}px`;
  el.style.display = 'block';
}

function calcDuration(fromLeft: number, toLeft: number): number {
  const dist = Math.abs(toLeft - fromLeft);
  return Math.min(DURATION_MAX_MS, Math.max(DURATION_MIN_MS, DURATION_BASE_MS + dist * DURATION_PER_PX));
}

/* ── component ── */

export function TabIsland({ tabs, activePath, onNavigate }: TabIslandProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const indRef = useRef<HTMLDivElement>(null);
  const prevIdx = useRef(-1);
  const anims = useRef<Animation[]>([]);
  const lensTimers = useRef<number[]>([]);
  const activeIdx = getActiveIndex(tabs, activePath);

  const cancelRunning = useCallback(() => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    lensTimers.current.forEach(clearTimeout);
    lensTimers.current = [];
  }, []);

  useEffect(() => {
    if (!navRef.current || !wrapRef.current || !indRef.current || activeIdx < 0) return;
    const pos = getTabRect(navRef.current, wrapRef.current, activeIdx);
    if (pos) placeIndicator(indRef.current, pos.left, pos.width);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (!navRef.current || !wrapRef.current || !indRef.current || activeIdx < 0) return;
      const pos = getTabRect(navRef.current, wrapRef.current, activeIdx);
      if (pos) placeIndicator(indRef.current, pos.left, pos.width);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeIdx]);

  useEffect(() => {
    const prev = prevIdx.current;
    prevIdx.current = activeIdx;

    if (!navRef.current || !wrapRef.current || !indRef.current) return;
    const el = indRef.current;
    const nav = navRef.current;

    if (prev < 0 || activeIdx < 0) {
      const pos = getTabRect(nav, wrapRef.current, activeIdx);
      if (pos) placeIndicator(el, pos.left, pos.width);
      return;
    }
    if (prev === activeIdx) return;

    const from = getTabRect(nav, wrapRef.current, prev);
    const to = getTabRect(nav, wrapRef.current, activeIdx);
    if (!from || !to) return;

    cancelRunning();
    placeIndicator(el, from.left, from.width);

    const targetTab = nav.children[activeIdx] as HTMLElement;
    const dur = calcDuration(from.left, to.left);
    const bulgeDur = dur * BULGE_DURATION_RATIO;

    /*
     * Two independent animations run in parallel via Web Animations API:
     *  - moveAnim:  horizontal slide (left, width)
     *  - bulgeAnim: vertical bulge (top, bottom, background, border)
     * Decoupled easings keep horizontal motion and vertical "breathing" independent.
     */
    const moveAnim = el.animate(
      [
        { left: `${from.left}px`, width: `${from.width}px` },
        { left: `${to.left}px`, width: `${to.width}px` },
      ],
      { duration: dur, easing: MOVE_EASING, fill: 'forwards' },
    );

    const bulgeAnim = el.animate(
      [
        { top: REST_INSET, bottom: REST_INSET, background: IND_REST_BG, border: IND_REST_BORDER, offset: 0 },
        { top: BULGE_PEAK_INSET, bottom: BULGE_PEAK_INSET, background: IND_PEAK_BG, border: IND_PEAK_BORDER, offset: 0.35 },
        { top: BULGE_SETTLE_INSET, bottom: BULGE_SETTLE_INSET, background: IND_SETTLE_BG, border: IND_SETTLE_BORDER, offset: 0.7 },
        { top: REST_INSET, bottom: REST_INSET, background: IND_REST_BG, border: IND_REST_BORDER, offset: 1 },
      ],
      { duration: bulgeDur, easing: 'ease-in-out', fill: 'forwards' },
    );

    const breatheAnim = nav.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.015)' },
        { transform: 'scale(1)' },
      ],
      { duration: BREATHE_DURATION_MS, easing: 'ease-in-out' },
    );

    anims.current = [moveAnim, bulgeAnim, breatheAnim];

    const tLensOn = window.setTimeout(() => {
      if (targetTab) targetTab.classList.add(styles.tabLens);
    }, dur * LENS_ON_AT);

    const tLensOff = window.setTimeout(() => {
      if (targetTab) targetTab.classList.remove(styles.tabLens);
    }, dur * LENS_OFF_AT);

    lensTimers.current = [tLensOn, tLensOff];

    moveAnim.onfinish = () => {
      moveAnim.cancel();
      bulgeAnim.cancel();
      placeIndicator(el, to.left, to.width);
      el.style.top = '';
      el.style.bottom = '';
      el.style.background = '';
      el.style.border = '';
      anims.current = [];
    };

    return () => cancelRunning();
  }, [activeIdx, cancelRunning]);

  return (
    <div ref={wrapRef} className={styles.wrapper}>
      <nav ref={navRef} className={styles.island}>
        {tabs.map((tab) => {
          const active = tabs[activeIdx] === tab;
          return (
            <div
              key={tab.path}
              className={`${styles.tab} ${active ? styles.active : ''}`}
              onClick={() => onNavigate(tab.path)}
              role="tab"
              aria-selected={active}
            >
              <tab.Icon size={24} strokeWidth={1.8} />
              <span className={styles.label}>{tab.label}</span>
            </div>
          );
        })}
      </nav>
      <div
        ref={indRef}
        className={styles.indicator}
        style={{ display: 'none' }}
      />
    </div>
  );
}
