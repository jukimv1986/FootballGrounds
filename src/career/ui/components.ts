// Career UI building blocks: avatar (drawn with the game's skin and hair textures), club crests,
// meters, stat bars, cards, pills and small formatting helpers. Plain DOM via src/ui/dom.ts.

import { dataUrl, h } from '../../ui/dom';
import { cicon } from './icons';
import { isNationalId } from '../core/competitions';
import { COUNTRIES, NATIONS } from '../core/data/geography';
import { formatFollowers, formatMoney } from '../core/messages';
import type { CareerState, Club, Id, KitPattern, RGB } from '../core/types';

export type Child = Node | string | number | null | undefined | false | Child[];

export function rgb(c: RGB, a = 1): string {
  return a === 1 ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

function lum(c: RGB): number {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

export function inkOn(c: RGB): string {
  return lum(c) > 0.6 ? '#101418' : '#ffffff';
}

// ----- formatting

export function money(state: CareerState, v: number): string {
  return formatMoney(state, v);
}

export function followers(n: number): string {
  return formatFollowers(n);
}

export function pct(v: number): string {
  return `${Math.round(v)}`;
}

export function stat100(v: number): number {
  return Math.round(v * 100);
}

// ----- generic

export function card(title: string | null, body: Child[], opts: { className?: string; action?: Node | null; kicker?: string } = {}): HTMLElement {
  return h(
    'section',
    { class: `cc-card ${opts.className ?? ''}` },
    title || opts.action ? h('header', { class: 'cc-card-head' }, h('div', {}, opts.kicker ? h('div', { class: 'cc-kicker' }, opts.kicker) : null, title ? h('h3', { class: 'cc-card-title' }, title) : null), opts.action ?? null) : null,
    h('div', { class: 'cc-card-body' }, ...body),
  );
}

export function pill(text: string, tone: 'good' | 'bad' | 'info' | 'gold' | 'dim' | 'warn' = 'dim'): HTMLElement {
  return h('span', { class: `cc-pill cc-pill--${tone}` }, text);
}

export function btn(label: string, onClick: () => void, kind: 'primary' | 'ghost' | 'danger' | 'default' = 'default', opts: { icon?: string; disabled?: boolean | string; small?: boolean; title?: string; className?: string } = {}): HTMLButtonElement {
  const b = h(
    'button',
    { class: `btn btn--${kind} ${opts.small ? 'cc-btn-sm' : ''} ${opts.className ?? ''}`, type: 'button', onclick: onClick, title: opts.title ?? (typeof opts.disabled === 'string' ? opts.disabled : undefined) },
    opts.icon ? cicon(opts.icon) : null,
    h('span', {}, label),
  );
  if (opts.disabled) b.disabled = true;
  return b;
}

/** a labelled 0..100 meter */
export function meter(label: string, value: number, opts: { tone?: 'auto' | 'good' | 'bad' | 'info' | 'gold'; hint?: string; compact?: boolean; max?: number } = {}): HTMLElement {
  const max = opts.max ?? 100;
  const v = Math.max(0, Math.min(max, value));
  const f = v / max;
  const tone = opts.tone && opts.tone !== 'auto' ? opts.tone : f >= 0.66 ? 'good' : f >= 0.4 ? 'info' : f >= 0.2 ? 'warn' : 'bad';
  return h(
    'div',
    { class: `cc-meter ${opts.compact ? 'cc-meter--compact' : ''}`, title: opts.hint ?? '' },
    h('div', { class: 'cc-meter-top' }, h('span', { class: 'cc-meter-label' }, label), h('span', { class: 'cc-meter-value' }, String(Math.round(v)))),
    h('div', { class: 'cc-meter-track' }, h('div', { class: `cc-meter-fill cc-tone-${tone}`, style: `width: ${(f * 100).toFixed(1)}%` })),
  );
}

/** attribute bar (0..1 value) with a growth delta */
export function statBar(label: string, v: number, delta = 0, cap?: number): HTMLElement {
  const n = stat100(v);
  const tier = n >= 85 ? 'elite' : n >= 70 ? 'good' : n >= 50 ? 'ok' : 'low';
  const d = Math.round(delta * 1000) / 10;
  return h(
    'div',
    { class: 'cc-stat' },
    h('span', { class: 'cc-stat-label' }, label),
    h(
      'span',
      { class: 'cc-stat-track' },
      cap !== undefined ? h('span', { class: 'cc-stat-cap', style: `left: ${Math.min(100, cap * 100).toFixed(1)}%`, title: 'Natural potential' }) : null,
      h('span', { class: `cc-stat-fill cc-stat--${tier}`, style: `width: ${Math.min(100, n)}%` }),
    ),
    h('span', { class: `cc-stat-value cc-stat--${tier}` }, String(n)),
    h('span', { class: `cc-stat-delta ${d > 0 ? 'is-up' : d < 0 ? 'is-down' : ''}` }, d > 0.04 ? `▲${d.toFixed(1)}` : d < -0.04 ? `▼${Math.abs(d).toFixed(1)}` : ''),
  );
}

export function ovrBadge(value: number, label = 'OVR', size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const v = Math.round(value);
  const tier = v >= 85 ? 'elite' : v >= 75 ? 'gold' : v >= 65 ? 'silver' : 'bronze';
  return h('span', { class: `cc-ovr cc-ovr--${tier} cc-ovr--${size}` }, h('span', { class: 'cc-ovr-value' }, String(v)), h('span', { class: 'cc-ovr-label' }, label));
}

export function stars(n: number, max = 5): HTMLElement {
  const full = Math.round(n * 2) / 2;
  const out: string[] = [];
  for (let i = 1; i <= max; i++) out.push(full >= i ? '★' : full >= i - 0.5 ? '⯪' : '☆');
  return h('span', { class: 'cc-stars', 'aria-label': `${full} of ${max}` }, out.join(''));
}

export function formDots(form: ('W' | 'D' | 'L')[]): HTMLElement {
  return h('span', { class: 'cc-form' }, ...form.map((r) => h('span', { class: `cc-form-dot cc-form-${r}` }, r)));
}

export function emptyState(text: string): HTMLElement {
  return h('p', { class: 'cc-empty' }, text);
}

export function table(headers: (string | { label: string; className?: string })[], rows: Child[][], opts: { className?: string; highlight?: (i: number) => boolean } = {}): HTMLElement {
  return h(
    'div',
    { class: `cc-table-wrap ${opts.className ?? ''}` },
    h(
      'table',
      { class: 'cc-table' },
      h('thead', {}, h('tr', {}, ...headers.map((x) => (typeof x === 'string' ? h('th', {}, x) : h('th', { class: x.className ?? '' }, x.label))))),
      h('tbody', {}, ...rows.map((r, i) => h('tr', { class: opts.highlight?.(i) ? 'is-user' : '' }, ...r.map((c) => h('td', {}, c))))),
    ),
  );
}

// ----- crests

const crestCache = new Map<string, string>();

function patternSvg(pattern: KitPattern, c2: string): string {
  switch (pattern) {
    case 'stripes':
      return `<path d="M36 0h14v140H36zM64 0h14v140H64zM92 0h14v140H92z" fill="${c2}"/>`;
    case 'pinstripes':
      return `<path d="M30 0h3v140h-3zM45 0h3v140h-3zM60 0h3v140h-3zM75 0h3v140h-3zM90 0h3v140h-3zM105 0h3v140h-3z" fill="${c2}"/>`;
    case 'hoops':
      return `<path d="M0 34h128v14H0zM0 64h128v14H0zM0 94h128v14H0z" fill="${c2}"/>`;
    case 'halves':
      return `<path d="M64 0h64v140H64z" fill="${c2}"/>`;
    case 'sash':
      return `<path d="M8 10l24-6 90 112-24 12z" fill="${c2}"/>`;
    case 'sleeves':
      return `<path d="M0 0h128v26H0z" fill="${c2}"/>`;
    case 'chevron':
      return `<path d="M10 40l54 34 54-34v18l-54 34-54-34z" fill="${c2}"/>`;
    default:
      return `<path d="M56 0h16v140H56z" fill="${c2}" opacity="0.85"/>`;
  }
}

export function crestSvgUrl(colors: [RGB, RGB], pattern: KitPattern, label: string): string {
  const key = `${colors.join('|')}|${pattern}|${label}`;
  let url = crestCache.get(key);
  if (url) return url;
  const c1 = rgb(colors[0]);
  const c2 = rgb(colors[1]);
  const border = Math.abs(lum(colors[0]) - lum(colors[1])) > 0.25 ? c2 : inkOn(colors[0]);
  const ink = inkOn(colors[0]);
  const shield = 'M64 6l52 14-4 52c-4 26-20 42-48 54C36 114 20 98 16 72L12 20z';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 140"><defs><clipPath id="s"><path d="${shield}"/></clipPath><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs><path d="${shield}" fill="${c1}"/><g clip-path="url(#s)">${patternSvg(pattern, c2)}<rect width="128" height="140" fill="url(#g)"/></g><path d="${shield}" fill="none" stroke="${border}" stroke-width="7"/><text x="64" y="80" text-anchor="middle" font-family="Alegreya Sans SC, Arial, sans-serif" font-weight="800" font-size="32" fill="${ink}" stroke="${c1}" stroke-width="4" paint-order="stroke">${escapeXml(label.substring(0, 3))}</text></svg>`;
  url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  crestCache.set(key, url);
  return url;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function clubCrestUrl(c: Club): string {
  if (c.logoUrl && c.dbTeamId !== undefined) return dataUrl(`databases/default/${c.logoUrl}`);
  return crestSvgUrl(c.colors, c.kitPattern, c.shortName);
}

export function teamColors(state: CareerState, id: Id): [RGB, RGB] {
  if (isNationalId(id)) {
    const t = state.nationalTeams.find((x) => x.id === id);
    const def = COUNTRIES.find((c) => c.key === t?.nation) ?? NATIONS.find((n) => n.key === t?.nation);
    return (def?.colors ?? [[255, 255, 255], [0, 0, 0]]) as [RGB, RGB];
  }
  return state.world.clubs[id]?.colors ?? [[200, 200, 200], [60, 60, 60]];
}

/** crest image for a club or national team */
export function crest(state: CareerState, id: Id, size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' = 'sm'): HTMLElement {
  let src: string;
  let alt: string;
  if (isNationalId(id)) {
    const t = state.nationalTeams.find((x) => x.id === id);
    src = crestSvgUrl(teamColors(state, id), 'halves', t?.nation ?? 'NAT');
    alt = t?.nation ?? 'National team';
  } else {
    const c = state.world.clubs[id];
    if (!c) return h('span', { class: `cc-crest cc-crest--${size}` });
    src = clubCrestUrl(c);
    alt = c.name;
  }
  const img = h('img', { class: `cc-crest cc-crest--${size}`, src, alt, draggable: 'false', decoding: 'async' });
  if (!isNationalId(id)) {
    const c = state.world.clubs[id];
    img.addEventListener('error', () => (img.src = crestSvgUrl(c.colors, c.kitPattern, c.shortName)), { once: true });
  }
  return img;
}

// ----- avatar

const SKIN_BASE: Record<number, string> = { 1: '#e4b9a3', 2: '#b79784', 3: '#907360', 4: '#664a37' };
const HAIR_BASE: Record<string, string> = { black: '#1d1812', brown: '#5e3c26', darkblonde: '#4f4128', blonde: '#b79963', red: '#8a4a33' };

export const HAIR_STYLES = ['short01', 'short02', 'medium01', 'medium02', 'long01', 'bald'] as const;
export const HAIR_COLORS = ['black', 'brown', 'darkblonde', 'blonde', 'red'] as const;
export const HAIR_STYLE_NAMES: Record<string, string> = { bald: 'Shaved', short01: 'Buzz cut', short02: 'Short', medium01: 'Textured', medium02: 'Curly', long01: 'Long' };
export const HAIR_COLOR_NAMES: Record<string, string> = { black: 'Black', brown: 'Brown', darkblonde: 'Dark blonde', blonde: 'Blonde', red: 'Red' };

function hairPath(style: string): string {
  switch (style) {
    case 'short01':
      return 'M34 52c0-20 12-32 26-32s26 12 26 32c-3-8-8-12-10-13-6 3-26 3-32 0-2 1-7 5-10 13z';
    case 'short02':
      return 'M32 54c-2-22 10-38 29-38 18 0 29 12 27 36-3-8-6-13-9-15-4 1-10-3-14-7-6 6-18 8-26 9-3 3-5 9-7 15z';
    case 'medium01':
      return 'M30 60c-4-26 9-44 31-44 21 0 34 16 29 44-2-8-4-14-7-17-10 2-22-4-26-10-5 7-14 10-21 11-3 4-5 10-6 16z';
    case 'medium02':
      return 'M29 58c-6-12 0-22 6-24-2-8 6-16 14-14 4-6 14-8 20-2 8-2 16 4 15 12 7 2 10 12 5 22 1 6 0 10-2 14-2-8-5-14-9-17-12 2-24-2-30-8-6 6-12 9-16 11-2 3-3 7-3 10z';
    case 'long01':
      return 'M28 96c-6-24-6-44 2-60 7-14 18-20 31-20 14 0 25 7 31 20 8 16 7 36 1 60-3-12-5-30-7-40-4-6-8-10-10-11-10 2-21-2-27-8-4 6-10 10-14 12-3 8-5 26-7 47z';
    default:
      return '';
  }
}

export interface Look {
  skin: number;
  hair: string;
  hairColor: string;
  shirt?: [RGB, RGB];
  number?: number;
}

let avatarSeq = 0;

/** SVG portrait: skin and hair are painted with the game's textures over a base tint */
export function avatar(look: Look, size = 120): SVGSVGElement {
  const id = `av${avatarSeq++}`;
  const skinTex = dataUrl(`media/objects/players/textures/skin0${Math.max(1, Math.min(4, look.skin))}.png`);
  const hairTex = dataUrl(`media/objects/players/textures/hair/${look.hairColor}.png`);
  const skin = SKIN_BASE[look.skin] ?? SKIN_BASE[1];
  const hair = HAIR_BASE[look.hairColor] ?? HAIR_BASE.black;
  const [c1, c2] = look.shirt ?? [[40, 120, 80], [240, 240, 240]];
  const hp = hairPath(look.hair);
  const wrapper = document.createElement('span');
  wrapper.innerHTML = `<svg class="cc-avatar" viewBox="0 0 120 140" width="${size}" height="${Math.round(size * 1.1667)}" role="img" aria-label="Player portrait">
  <defs>
    <pattern id="${id}s" patternUnits="userSpaceOnUse" width="16" height="16"><rect width="16" height="16" fill="${skin}"/><image href="${skinTex}" width="16" height="16" opacity="0.55" preserveAspectRatio="none"/></pattern>
    <pattern id="${id}h" patternUnits="userSpaceOnUse" width="24" height="24"><rect width="24" height="24" fill="${hair}"/><image href="${hairTex}" width="24" height="24" opacity="0.6" preserveAspectRatio="none"/></pattern>
    <radialGradient id="${id}bg" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${rgb(c1, 0.55)}"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></radialGradient>
    <linearGradient id="${id}sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></linearGradient>
  </defs>
  <rect width="120" height="140" rx="14" fill="url(#${id}bg)"/>
  <path d="M10 140c2-22 16-34 34-38l16 10 16-10c18 4 32 16 34 38z" fill="${rgb(c1)}"/>
  <path d="M44 102l16 12 16-12-4-4-12 8-12-8z" fill="${rgb(c2)}"/>
  <path d="M10 140c2-22 16-34 34-38l16 10 16-10c18 4 32 16 34 38z" fill="url(#${id}sh)"/>
  ${look.number !== undefined ? `<text x="92" y="132" font-family="Alegreya Sans SC, Arial" font-weight="800" font-size="16" fill="${inkOn(c1)}" opacity="0.85">${look.number}</text>` : ''}
  <path d="M50 84h20v18c-4 5-16 5-20 0z" fill="url(#${id}s)"/>
  <path d="M50 92c6 4 14 4 20 0v-6H50z" fill="#000" opacity="0.12"/>
  <ellipse cx="33.5" cy="62" rx="5" ry="8" fill="url(#${id}s)"/>
  <ellipse cx="86.5" cy="62" rx="5" ry="8" fill="url(#${id}s)"/>
  <path d="M34 56c0-24 11-38 26-38s26 14 26 38c0 22-12 36-26 36S34 78 34 56z" fill="url(#${id}s)"/>
  <path d="M34 56c0 22 12 36 26 36 6 0 11-2 15-6-20 2-36-10-41-30z" fill="#000" opacity="0.08"/>
  <path d="M44 55c3-2 8-2 11 0M65 55c3-2 8-2 11 0" stroke="${hair}" stroke-width="2.6" stroke-linecap="round" fill="none" opacity="0.9"/>
  <ellipse cx="50" cy="61" rx="3.2" ry="2.4" fill="#fff"/><ellipse cx="70" cy="61" rx="3.2" ry="2.4" fill="#fff"/>
  <circle cx="50.5" cy="61.2" r="1.7" fill="#2a1d14"/><circle cx="70.5" cy="61.2" r="1.7" fill="#2a1d14"/>
  <path d="M60 63c-1 6-3 9-4 11 2 1.5 6 1.5 8 0" stroke="#000" stroke-opacity="0.22" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M52 80c5 3 11 3 16 0" stroke="#5a2f2a" stroke-opacity="0.7" stroke-width="2" fill="none" stroke-linecap="round"/>
  ${hp ? `<path d="${hp}" fill="url(#${id}h)"/>` : `<path d="M36 44c4-16 14-24 24-24s20 8 24 24c-6-6-14-9-24-9s-18 3-24 9z" fill="${hair}" opacity="0.18"/>`}
</svg>`;
  return wrapper.firstElementChild as SVGSVGElement;
}

/** small shirt glyph in club colors */
export function shirtIcon(colors: [RGB, RGB], pattern: KitPattern = 'plain', size = 28): SVGSVGElement {
  const [c1, c2] = colors;
  const w = document.createElement('span');
  const stripes = pattern === 'stripes' ? `<path d="M11 6h3v22h-3zM18 6h3v22h-3z" fill="${rgb(c2)}"/>` : pattern === 'hoops' ? `<path d="M5 12h22v3H5zM5 19h22v3H5z" fill="${rgb(c2)}"/>` : pattern === 'halves' ? `<path d="M16 4h9v24h-9z" fill="${rgb(c2)}"/>` : '';
  w.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><defs><clipPath id="sh${avatarSeq}"><path d="M11 3l-8 5 3 6 3-1v16h14V13l3 1 3-6-8-5c-1 3-3 4-5 4s-4-1-5-4z"/></clipPath></defs><path d="M11 3l-8 5 3 6 3-1v16h14V13l3 1 3-6-8-5c-1 3-3 4-5 4s-4-1-5-4z" fill="${rgb(c1)}" stroke="rgba(0,0,0,.35)" stroke-width="1"/><g clip-path="url(#sh${avatarSeq++})">${stripes}</g></svg>`;
  return w.firstElementChild as SVGSVGElement;
}

export function sectionTitle(text: string, extra?: Node | null): HTMLElement {
  return h('div', { class: 'cc-section-title' }, h('h2', {}, text), extra ?? null);
}

export function keyValue(rows: [string, Child][]): HTMLElement {
  return h('dl', { class: 'cc-kv' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}
