// Reusable loading screen (C++ menu/startmatch/loadingmatch): matchup crests, progress bar and
// rotating tips. Used by the quick match and by the career mode:
//
//   const loading = createLoadingScreen({ title: 'League · Matchday 12', home: getTeamInfo(a), away: getTeamInfo(b) });
//   pushScreen(loading);
//   await StartMatchSession({ ..., onLoadProgress: (f) => loading.setProgress(f) });

import { dataUrl, h } from '../dom';
import type { Screen } from '../router';
import { teamCrest } from '../teams';

export interface LoadingTeam {
  name: string;
  shortName: string;
  /** url of the crest ('' for the generated fallback crest) */
  logo: string;
  color1: string;
  color2: string;
}

export interface LoadingScreenOptions {
  /** e.g. "Quick match", "League · Matchday 12" */
  title?: string;
  /** e.g. "Friendly", "Estadio Municipal" */
  subtitle?: string;
  home?: LoadingTeam;
  away?: LoadingTeam;
  /** tips shown one after another (default: DEFAULT_TIPS) */
  tips?: string[];
  /** status line under the bar, default "Loading" */
  status?: string;
}

export interface LoadingScreen extends Screen {
  /** 0 .. 1 */
  setProgress(fraction: number): void;
  setStatus(text: string): void;
  setTip(text: string): void;
}

export const DEFAULT_TIPS = [
  'Hold sprint to burst past defenders — but your stamina will pay for it later in the match.',
  'A through pass (W / Y) leads your teammate into space. Aim it where he is going, not where he is.',
  'Without the ball, press S / A to pressure the carrier and D / X to make the whole team press.',
  'Tap the shot button for a placed finish; hold it longer for more power.',
  'Use the dribble button (C / RT) to shield the ball and slow the play down.',
  'Switch player (Q / LB) to take control of the teammate closest to the ball.',
  'High passes (A / B) are great for switching play or crossing from the wing.',
  'Match duration and difficulty can be changed in Settings → Gameplay.',
  'Camera too close? Zoom, height and field of view are in Settings → Camera.',
  'Career tip: rest matters. Training hard every day raises your injury risk.',
];

export function createLoadingScreen(o: LoadingScreenOptions = {}): LoadingScreen {
  const tips = o.tips && o.tips.length ? o.tips : DEFAULT_TIPS;
  let tipIndex = Math.floor(Math.random() * tips.length);
  let shown = 0; // displayed progress (eased)
  let target = 0;
  let raf = 0;
  let tipTimer = 0;

  const fill = h('div', { class: 'loading-bar-fill' });
  const percent = h('span', { class: 'loading-percent' }, '0%');
  const status = h('span', { class: 'loading-status' }, o.status ?? 'Loading');
  const tipText = h('p', { class: 'loading-tip-text' }, tips[tipIndex]);
  const bar = h('div', { class: 'loading-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);

  const team = (t: LoadingTeam, side: 'home' | 'away') =>
    h('div', { class: `loading-team loading-team--${side}`, style: `--c1: ${t.color1}; --c2: ${t.color2}` }, teamCrest(t, 'crest--xl'), h('div', { class: 'loading-team-name' }, t.name));

  const matchup =
    o.home && o.away
      ? h('div', { class: 'loading-matchup' }, team(o.home, 'home'), h('div', { class: 'loading-vs' }, 'VS'), team(o.away, 'away'))
      : h('div', { class: 'loading-matchup loading-matchup--solo' }, h('div', { class: 'loading-ball', 'aria-hidden': 'true', style: `background-image: url("${dataUrl('media/menu/credits/ball.png')}")` }));

  const el = h(
    'section',
    {
      class: 'screen screen--loading',
      style: o.home && o.away ? `--home: ${o.home.color1}; --away: ${o.away.color1}` : '',
      'aria-busy': 'true',
    },
    h('div', { class: 'loading-bg', 'aria-hidden': 'true' }, h('div', { class: 'loading-bg-home' }), h('div', { class: 'loading-bg-away' }), h('div', { class: 'loading-bg-brush', style: `-webkit-mask-image: url("${dataUrl('media/menu/main/loading01.png')}"); mask-image: url("${dataUrl('media/menu/main/loading01.png')}")` })),
    h(
      'div',
      { class: 'loading-layout' },
      h('header', { class: 'loading-head' }, o.title ? h('div', { class: 'loading-title' }, o.title) : null, o.subtitle ? h('div', { class: 'loading-subtitle' }, o.subtitle) : null),
      matchup,
      h(
        'footer',
        { class: 'loading-foot' },
        h('div', { class: 'loading-meta' }, status, percent),
        bar,
        h('div', { class: 'loading-tip' }, h('span', { class: 'loading-tip-label' }, 'Tip'), tipText),
      ),
    ),
  );

  const tick = () => {
    // ease towards the reported progress so jumps look smooth
    shown += (target - shown) * 0.18;
    if (Math.abs(target - shown) < 0.002) shown = target;
    const pct = Math.round(shown * 100);
    fill.style.transform = `scaleX(${shown})`;
    percent.textContent = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
    raf = shown === target ? 0 : requestAnimationFrame(tick);
  };

  const screen: LoadingScreen = {
    el,
    onShow() {
      window.clearInterval(tipTimer);
      tipTimer = window.setInterval(() => {
        tipIndex = (tipIndex + 1) % tips.length;
        tipText.classList.remove('is-in');
        void tipText.offsetWidth;
        tipText.textContent = tips[tipIndex];
        tipText.classList.add('is-in');
      }, 6500);
    },
    onHide() {
      window.clearInterval(tipTimer);
      cancelAnimationFrame(raf);
      raf = 0;
    },
    setProgress(fraction: number) {
      target = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
      if (target >= 1) status.textContent = 'Kick-off';
      if (!raf) raf = requestAnimationFrame(tick);
    },
    setStatus(text: string) {
      status.textContent = text;
    },
    setTip(text: string) {
      tipText.textContent = text;
    },
  };
  return screen;
}
