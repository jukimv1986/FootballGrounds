// Team presentation helpers shared by the quick match, loading, result and career screens:
// crest images (with a generated fallback shield for teams without a logo), kit previews cut
// from the kit textures, league grouping and ratings computed from the players' base_stat.

import { GetDB } from '../game/globals';
import type { LeagueRecord, TeamRecord } from '../game/data/database';
import { dataUrl, h } from './dom';
import { titleCase } from './widgets';

const DB_ROOT = 'databases/default/';

export interface TeamInfo {
  id: number;
  name: string;
  shortName: string;
  leagueId: number;
  leagueName: string;
  /** url, or '' */
  leagueLogo: string;
  countryName: string;
  /** url, or '' when the team has no logo */
  logo: string;
  /** css colors */
  color1: string;
  color2: string;
  /** 0 .. 99 */
  overall: number;
  attack: number;
  midfield: number;
  defence: number;
  playerCount: number;
}

export interface LeagueGroup {
  league: LeagueRecord;
  name: string;
  logo: string;
  countryName: string;
  teams: TeamInfo[];
}

/** "255, 50, 50" -> "rgb(255, 50, 50)" */
export function cssColor(dbColor: string, fallback = '#888'): string {
  const parts = dbColor.split(',').map((s) => Number(s.trim()));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
}

export function teamLogoUrl(team: TeamRecord): string {
  return team.logo_url ? dataUrl(DB_ROOT + team.logo_url) : '';
}

/** kit texture url (kitNum 1 = home, 2 = away) */
export function kitTextureUrl(team: TeamRecord, kitNum: number): string {
  if (!team.kit_url) return '';
  return dataUrl(`${DB_ROOT}${team.kit_url}_kit_0${kitNum === 2 ? 2 : 1}.png`);
}

export function shortNameOf(team: TeamRecord): string {
  if (team.shortname) return team.shortname;
  // C++ TeamData: first 3 letters of the name without spaces, upper case
  return team.name.replace(/\s+/g, '').substring(0, 3).toUpperCase();
}

type Line = 'GK' | 'DEF' | 'MID' | 'ATT';

function formationRoles(team: TeamRecord): string[] {
  const roles: string[] = [];
  const re = /<p(\d+)>[\s\S]*?<role>\s*([A-Za-z]+)\s*<\/role>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(team.formation_xml ?? ''))) roles[Number(m[1]) - 1] = m[2].toUpperCase();
  return roles;
}

function lineOfRole(role: string | undefined): Line {
  if (!role) return 'MID';
  if (role === 'GK') return 'GK';
  if (/^(CF|ST|SS|LW|RW|LF|RF|F)$/.test(role)) return 'ATT';
  if (role.endsWith('B') || role === 'SW') return 'DEF';
  return 'MID';
}

const infoCache = new Map<number, TeamInfo>();

/** clears cached team info (call after the database changed, e.g. career mode edits) */
export function invalidateTeamInfo(): void {
  infoCache.clear();
}

export function getTeamInfo(teamID: number): TeamInfo {
  const cached = infoCache.get(teamID);
  if (cached) return cached;
  const db = GetDB();
  const team = db.GetTeam(teamID);
  const league = db.leagues.find((l) => l.id === team.league_id);
  const country = league ? db.countries.find((c) => c.id === league.country_id) : undefined;

  const national = team.national === 1;
  const players = db.players
    .filter((p) => (national ? p.nationalteam_id === team.id : p.team_id === team.id))
    .sort((a, b) => (national ? a.nationalteamformationorder - b.nationalteamformationorder : a.formationorder - b.formationorder));
  const starters = players.slice(0, 11);
  const roles = formationRoles(team);
  const lines: Record<Line, number[]> = { GK: [], DEF: [], MID: [], ATT: [] };
  starters.forEach((p, i) => lines[lineOfRole(roles[i])].push(p.base_stat));
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const toRating = (v: number) => Math.round(Math.min(0.99, Math.max(0, v)) * 100);
  const overall = toRating(avg(starters.map((p) => p.base_stat)));

  const info: TeamInfo = {
    id: team.id,
    name: team.name,
    shortName: shortNameOf(team),
    leagueId: team.league_id,
    leagueName: league ? titleCase(league.name) : national ? 'National teams' : 'Other',
    leagueLogo: league?.logo_url ? dataUrl(DB_ROOT + league.logo_url) : '',
    countryName: country?.name ?? '',
    logo: teamLogoUrl(team),
    color1: cssColor(team.color1, '#3ddc84'),
    color2: cssColor(team.color2, '#ffffff'),
    overall,
    attack: lines.ATT.length ? toRating(avg(lines.ATT)) : overall,
    midfield: lines.MID.length ? toRating(avg(lines.MID)) : overall,
    defence: lines.DEF.length ? toRating(avg([...lines.DEF, ...lines.GK])) : overall,
    playerCount: players.length,
  };
  infoCache.set(teamID, info);
  return info;
}

/** all teams grouped by league (league order as in the database, teams by name) */
export function getLeagueGroups(): LeagueGroup[] {
  const db = GetDB();
  const groups: LeagueGroup[] = [];
  const byLeague = new Map<number, LeagueGroup>();
  for (const league of db.leagues) {
    const country = db.countries.find((c) => c.id === league.country_id);
    const g: LeagueGroup = { league, name: titleCase(league.name), logo: league.logo_url ? dataUrl(DB_ROOT + league.logo_url) : '', countryName: country?.name ?? '', teams: [] };
    byLeague.set(league.id, g);
    groups.push(g);
  }
  for (const team of db.teams) {
    let g = byLeague.get(team.league_id);
    if (!g) {
      const pseudo: LeagueRecord = { id: team.league_id, country_id: -1, name: team.national ? 'national teams' : 'other teams', logo_url: '' };
      g = { league: pseudo, name: titleCase(pseudo.name), logo: '', countryName: '', teams: [] };
      byLeague.set(team.league_id, g);
      groups.push(g);
    }
    g.teams.push(getTeamInfo(team.id));
  }
  for (const g of groups) g.teams.sort((a, b) => a.name.localeCompare(b.name));
  return groups.filter((g) => g.teams.length > 0);
}

/** flat list of all team ids in league/name order (for ←/→ cycling) */
export function getOrderedTeamIDs(): number[] {
  return getLeagueGroups().flatMap((g) => g.teams.map((t) => t.id));
}

// ----- DOM

/** team crest image; falls back to a shield in the team colors with the short name */
export function teamCrest(info: Pick<TeamInfo, 'logo' | 'shortName' | 'color1' | 'color2' | 'name'>, className = ''): HTMLElement {
  const fallback = () =>
    h(
      'span',
      { class: `crest crest--fallback ${className}`, style: `--c1: ${info.color1}; --c2: ${info.color2}`, 'aria-label': info.name },
      h('span', { class: 'crest-initials' }, info.shortName),
    );
  if (!info.logo) return fallback();
  const img = h('img', { class: `crest ${className}`, src: info.logo, alt: info.name, draggable: 'false', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

/** small league badge image (or an empty placeholder) */
export function leagueBadge(logo: string, name: string, className = ''): HTMLElement {
  if (!logo) return h('span', { class: `league-badge league-badge--empty ${className}`, 'aria-hidden': 'true' });
  return h('img', { class: `league-badge ${className}`, src: logo, alt: name, draggable: 'false', decoding: 'async' });
}

/**
 * Kit preview: the shirt front and shorts cut from the 1024x1024 kit texture
 * (shirt front at 0,0 - 512x580, shorts at 5,587 - 546x181).
 */
export function kitPreview(team: TeamRecord, kitNum: number, className = ''): HTMLElement {
  // absolute: a relative url() inside a custom property resolves against the stylesheet using it
  const relative = kitTextureUrl(team, kitNum);
  const url = relative ? new URL(relative, document.baseURI).href : '';
  const style = url ? `--kit: url("${url}")` : `--kit: none; --kit-fallback: ${kitNum === 2 ? cssColor(team.color2) : cssColor(team.color1)}`;
  return h('span', { class: `kit ${className}`, style, 'aria-hidden': 'true' }, h('span', { class: 'kit-shirt' }), h('span', { class: 'kit-shorts' }));
}

/** OVR badge */
export function ratingBadge(value: number, label = 'OVR'): HTMLElement {
  const tier = value >= 80 ? 'gold' : value >= 70 ? 'silver' : 'bronze';
  return h('span', { class: `rating rating--${tier}` }, h('span', { class: 'rating-value' }, String(value)), h('span', { class: 'rating-label' }, label));
}

/** ATT / MID / DEF bars */
export function ratingBars(info: TeamInfo): HTMLElement {
  const bar = (label: string, v: number) =>
    h('div', { class: 'rbar' }, h('span', { class: 'rbar-label' }, label), h('span', { class: 'rbar-track' }, h('span', { class: 'rbar-fill', style: `width: ${v}%` })), h('span', { class: 'rbar-value' }, String(v)));
  return h('div', { class: 'rbars' }, bar('ATT', info.attack), bar('MID', info.midfield), bar('DEF', info.defence));
}
