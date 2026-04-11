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
const REST_INSET_PX = 6;

const BULGE_PEAK_INSET = '-14px';
const BULGE_PEAK_INSET_PX = -14;
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

const DRAG_DEAD_ZONE = 5; // px — movement below this is treated as a tap

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

interface TabGeometry {
  left: number;
  width: number;
  center: number;
}

function getAllTabRects(navEl: HTMLElement, wrapEl: HTMLElement): TabGeometry[] {
  const wr = wrapEl.getBoundingClientRect();
  const result: TabGeometry[] = [];
  for (let i = 0; i < navEl.children.length; i++) {
    const tr = (navEl.children[i] as HTMLElement).getBoundingClientRect();
    const left = tr.left - wr.left;
    result.push({ left, width: tr.width, center: left + tr.width / 2 });
  }
  return result;
}

function findNearestTab(tabGeo: TabGeometry[], indicatorCenter: number): number {
  let nearest = 0;
  let minDist = Infinity;
  for (let i = 0; i < tabGeo.length; i++) {
    const d = Math.abs(tabGeo[i].center - indicatorCenter);
    if (d < minDist) {
      minDist = d;
      nearest = i;
    }
  }
  return nearest;
}

interface DragState {
  startPointerX: number;
  startLeft: number;
  homeIdx: number;
  tabGeo: TabGeometry[];
  totalMoved: number;
  currentLensIdx: number;
  minLeft: number;
  maxLeft: number;
  indWidth: number;
}

/* ── component ── */

export function TabIsland({ tabs, activePath, onNavigate }: TabIslandProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const indRef = useRef<HTMLDivElement>(null);
  const prevIdx = useRef(-1);
  const anims = useRef<Animation[]>([]);
  const lensTimers = useRef<number[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const activeIdx = getActiveIndex(tabs, activePath);

  const cancelRunning = useCallback(() => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    lensTimers.current.forEach(clearTimeout);
    lensTimers.current = [];
  }, []);

  const clearAllLens = useCallback(() => {
    if (!navRef.current) return;
    for (let i = 0; i < navRef.current.children.length; i++) {
      (navRef.current.children[i] as HTMLElement).classList.remove(styles.tabLens);
    }
  }, []);

  /* ── initial placement ── */

  useEffect(() => {
    if (!navRef.current || !wrapRef.current || !indRef.current || activeIdx < 0) return;
    const pos = getTabRect(navRef.current, wrapRef.current, activeIdx);
    if (pos) placeIndicator(indRef.current, pos.left, pos.width);
  }, []);

  /* ── resize ── */

  useEffect(() => {
    const onResize = () => {
      if (!navRef.current || !wrapRef.current || !indRef.current || activeIdx < 0) return;
      const pos = getTabRect(navRef.current, wrapRef.current, activeIdx);
      if (pos) placeIndicator(indRef.current, pos.left, pos.width);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeIdx]);

  /* ── tap animation (activeIdx change) ── */

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
    if (dragRef.current) return; // drag handles its own animation

    const from = getTabRect(nav, wrapRef.current, prev);
    const to = getTabRect(nav, wrapRef.current, activeIdx);
    if (!from || !to) return;

    cancelRunning();
    placeIndicator(el, from.left, from.width);

    const targetTab = nav.children[activeIdx] as HTMLElement;
    const dur = calcDuration(from.left, to.left);
    const bulgeDur = dur * BULGE_DURATION_RATIO;

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

  /* ── drag handling ── */

  useEffect(() => {
    const el = indRef.current;
    const nav = navRef.current;
    const wrap = wrapRef.current;
    if (!el || !nav || !wrap) return;

    function onPointerDown(e: PointerEvent) {
      if (dragRef.current) return;

      // Hit-test: check if pointer landed on the indicator area
      const indRect = el!.getBoundingClientRect();
      if (
        e.clientX < indRect.left || e.clientX > indRect.right ||
        e.clientY < indRect.top || e.clientY > indRect.bottom
      ) return;

      cancelRunning();
      clearAllLens();

      const tabGeo = getAllTabRects(nav!, wrap!);
      if (!tabGeo.length) return;

      const indLeft = parseFloat(el!.style.left) || 0;
      const indWidth = el!.offsetWidth;

      const firstTab = tabGeo[0];
      const lastTab = tabGeo[tabGeo.length - 1];

      dragRef.current = {
        startPointerX: e.clientX,
        startLeft: indLeft,
        homeIdx: activeIdx,
        tabGeo,
        totalMoved: 0,
        currentLensIdx: -1,
        minLeft: firstTab.left,
        maxLeft: lastTab.left + lastTab.width - indWidth,
        indWidth,
      };

      wrap!.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function onPointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;

      const deltaX = e.clientX - drag.startPointerX;
      drag.totalMoved = Math.max(drag.totalMoved, Math.abs(deltaX));

      const newLeft = Math.min(drag.maxLeft, Math.max(drag.minLeft, drag.startLeft + deltaX));
      el!.style.left = `${newLeft}px`;

      // Bulge based on displacement — reaches max at 1 tab distance
      const currentCenter = newLeft + drag.indWidth / 2;
      const homeCenter = drag.tabGeo[drag.homeIdx].center;
      const homeIdx = drag.homeIdx;
      const neighborDist =
        (homeIdx < drag.tabGeo.length - 1
          ? Math.abs(drag.tabGeo[homeIdx + 1].center - homeCenter)
          : homeIdx > 0
            ? Math.abs(drag.tabGeo[homeIdx - 1].center - homeCenter)
            : 100) || 1;
      const t = Math.min(1, Math.abs(currentCenter - homeCenter) / neighborDist);
      const inset = REST_INSET_PX - t * (REST_INSET_PX - BULGE_PEAK_INSET_PX);
      el!.style.top = `${inset}px`;
      el!.style.bottom = `${inset}px`;

      // Interpolate background/border/blur
      const bgAlpha = t * 0.08;
      el!.style.background = t > 0.05
        ? `rgba(0,0,0,${bgAlpha.toFixed(3)})`
        : IND_REST_BG;
      el!.style.border = t > 0.1 ? IND_PEAK_BORDER : IND_REST_BORDER;
      const blur = `blur(${(t * 2).toFixed(1)}px)`;
      el!.style.backdropFilter = blur;
      (el.style as any).webkitBackdropFilter = blur;

      // Breathe — island scales with displacement
      nav!.style.transform = `scale(${1 + t * 0.015})`;

      // Lens on nearest tab
      const nearIdx = findNearestTab(drag.tabGeo, currentCenter);
      if (nearIdx !== drag.currentLensIdx) {
        if (drag.currentLensIdx >= 0 && nav) {
          (nav.children[drag.currentLensIdx] as HTMLElement).classList.remove(styles.tabLens);
        }
        if (nearIdx !== drag.homeIdx && nav) {
          (nav.children[nearIdx] as HTMLElement).classList.add(styles.tabLens);
        }
        drag.currentLensIdx = nearIdx;
      }
    }

    function onPointerUp(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;

      wrap!.releasePointerCapture(e.pointerId);

      clearAllLens();

      // Reset bulge styles
      el!.style.top = '';
      el!.style.bottom = '';
      el!.style.background = '';
      el!.style.border = '';
      el!.style.backdropFilter = '';
      (el.style as any).webkitBackdropFilter = '';
      nav!.style.transform = '';

      if (drag.totalMoved < DRAG_DEAD_ZONE) {
        // Treat as tap — do nothing, let onClick handle it
        dragRef.current = null;
        return;
      }

      const currentLeft = parseFloat(el!.style.left) || 0;
      const currentCenter = currentLeft + drag.indWidth / 2;
      const nearIdx = findNearestTab(drag.tabGeo, currentCenter);

      dragRef.current = null;

      if (nearIdx !== activeIdx) {
        // Snap indicator to nearest position, then navigate (which triggers WAAPI animation)
        const target = drag.tabGeo[nearIdx];
        placeIndicator(el!, target.left, target.width);
        prevIdx.current = nearIdx; // prevent double animation
        onNavigate(tabs[nearIdx].path);
      } else {
        // Snap back to home with a spring animation
        const home = drag.tabGeo[drag.homeIdx];
        const snapAnim = el!.animate(
          [
            { left: `${currentLeft}px` },
            { left: `${home.left}px` },
          ],
          { duration: 200, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)', fill: 'forwards' },
        );
        snapAnim.onfinish = () => {
          snapAnim.cancel();
          placeIndicator(el!, home.left, home.width);
        };
      }
    }

    wrap.addEventListener('pointerdown', onPointerDown);
    wrap.addEventListener('pointermove', onPointerMove);
    wrap.addEventListener('pointerup', onPointerUp);
    wrap.addEventListener('pointercancel', onPointerUp);

    return () => {
      wrap.removeEventListener('pointerdown', onPointerDown);
      wrap.removeEventListener('pointermove', onPointerMove);
      wrap.removeEventListener('pointerup', onPointerUp);
      wrap.removeEventListener('pointercancel', onPointerUp);
    };
  }, [activeIdx, tabs, onNavigate, cancelRunning, clearAllLens]);

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
