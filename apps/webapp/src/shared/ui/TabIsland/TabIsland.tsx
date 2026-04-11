/* @refresh reset — imperative DOM animation requires full re-mount on HMR */
import { useRef, useEffect, useCallback, useState } from 'react';
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

const INDICATOR_REST_INSET = '6px';

const BULGE_PEAK_INSET = -14;        // px — how far indicator extends beyond island
const BULGE_SETTLE_INSET = -6;       // px — intermediate settle point (70% keyframe)
const BULGE_DURATION_RATIO = 0.9;    // bulge runs slightly shorter than horizontal move

const LENS_ON_AT = 0.3;              // fraction of duration
const LENS_OFF_AT = 0.7;

const MOVE_EASING = 'cubic-bezier(0.4, 0, 0.15, 1)';

/* indicator appearance at each keyframe */
const IND_REST_BG = 'rgba(255,255,255,0.08)';
const IND_REST_BORDER = '1px solid rgba(255,255,255,0.06)';
const IND_PEAK_BG = 'rgba(0,0,0,0.08)';
const IND_PEAK_BORDER = '1.5px solid rgba(255,255,255,0.1)';
const IND_SETTLE_BG = 'rgba(0,0,0,0.04)';
const IND_SETTLE_BORDER = '1px solid rgba(255,255,255,0.08)';
const IND_PEAK_BLUR = '2px';
const IND_SETTLE_BLUR = '1px';

/* ── helpers ── */

function getActiveIndex(tabs: readonly TabDef[], activePath: string): number {
  return tabs.findIndex((t) =>
    t.path === '/'
      ? activePath === '/'
      : activePath === t.path || activePath.startsWith(`${t.path}/`),
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

function resetEffects(el: HTMLElement) {
  el.style.transition = 'none';
  el.style.top = '';
  el.style.bottom = '';
  el.style.background = '';
  el.style.border = '';
  el.style.backdropFilter = '';
  (el.style as any).webkitBackdropFilter = '';
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
  const timers = useRef<number[]>([]);
  const activeIdx = getActiveIndex(tabs, activePath);
  const [breathing, setBreathing] = useState(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
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

    if (prev < 0 || activeIdx < 0) {
      const pos = getTabRect(navRef.current, wrapRef.current, activeIdx);
      if (pos) placeIndicator(el, pos.left, pos.width);
      return;
    }
    if (prev === activeIdx) return;

    const from = getTabRect(navRef.current, wrapRef.current, prev);
    const to = getTabRect(navRef.current, wrapRef.current, activeIdx);
    if (!from || !to) return;

    clearTimers();
    resetEffects(el);
    placeIndicator(el, from.left, from.width);
    void el.offsetHeight; // force reflow so placeIndicator values are committed

    setBreathing(true);

    const targetTab = navRef.current.children[activeIdx] as HTMLElement;
    const dur = calcDuration(from.left, to.left);
    const moveId = `mv-${Date.now()}`;
    const bulgeId = `bg-${Date.now()}`;

    /*
     * Two independent @keyframes run in parallel:
     *  - moveId:  horizontal slide (left, width) — fast-start easing
     *  - bulgeId: vertical bulge (top, bottom, background, border, blur) — ease-in-out
     * This keeps horizontal motion and vertical "breathing" decoupled.
     */
    const sheet = document.createElement('style');
    sheet.textContent = `
      @keyframes ${moveId} {
        0%   { left: ${from.left}px; width: ${from.width}px; }
        100% { left: ${to.left}px;   width: ${to.width}px; }
      }
      @keyframes ${bulgeId} {
        0%   { top: ${INDICATOR_REST_INSET}; bottom: ${INDICATOR_REST_INSET};
               background: ${IND_REST_BG}; border: ${IND_REST_BORDER};
               backdrop-filter: blur(0); -webkit-backdrop-filter: blur(0); }
        35%  { top: ${BULGE_PEAK_INSET}px; bottom: ${BULGE_PEAK_INSET}px;
               background: ${IND_PEAK_BG}; border: ${IND_PEAK_BORDER};
               backdrop-filter: blur(${IND_PEAK_BLUR}); -webkit-backdrop-filter: blur(${IND_PEAK_BLUR}); }
        70%  { top: ${BULGE_SETTLE_INSET}px; bottom: ${BULGE_SETTLE_INSET}px;
               background: ${IND_SETTLE_BG}; border: ${IND_SETTLE_BORDER};
               backdrop-filter: blur(${IND_SETTLE_BLUR}); -webkit-backdrop-filter: blur(${IND_SETTLE_BLUR}); }
        100% { top: ${INDICATOR_REST_INSET}; bottom: ${INDICATOR_REST_INSET};
               background: ${IND_REST_BG}; border: ${IND_REST_BORDER};
               backdrop-filter: blur(0); -webkit-backdrop-filter: blur(0); }
      }`;
    document.head.appendChild(sheet);

    el.style.animation = [
      `${moveId} ${dur}ms ${MOVE_EASING} forwards`,
      `${bulgeId} ${dur * BULGE_DURATION_RATIO}ms ease-in-out forwards`,
    ].join(', ');

    const tLensOn = window.setTimeout(() => {
      if (targetTab) targetTab.classList.add(styles.tabLens);
    }, dur * LENS_ON_AT);

    const tLensOff = window.setTimeout(() => {
      if (targetTab) targetTab.classList.remove(styles.tabLens);
    }, dur * LENS_OFF_AT);

    const tCleanup = window.setTimeout(() => {
      el.style.animation = '';
      resetEffects(el);
      placeIndicator(el, to.left, to.width);
      setBreathing(false);
      sheet.remove();
    }, dur + 20);

    timers.current = [tLensOn, tLensOff, tCleanup];
    return () => clearTimers();
  }, [activeIdx, clearTimers]);

  return (
    <div ref={wrapRef} className={styles.wrapper}>
      <nav ref={navRef} className={`${styles.island} ${breathing ? styles.islandBreathe : ''}`}>
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
