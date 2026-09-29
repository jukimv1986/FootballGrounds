// Full-time result screen (C++ menu/ingame/gameover, as a menu screen): score, goal scorers,
// cards and the best rated player. Reusable by the career mode.

import type { MatchEvent, MatchResult, PlayerMatchStats } from '../../app/matchsession';
import { GetDB } from '../../game/globals';
import { h } from '../dom';
import { icon } from '../icons';
import { withNav } from '../nav';
import type { Screen } from '../router';
import type { LoadingTeam } from './loading';
import { teamCrest } from '../teams';
import { HINT_NAVIGATE, HINT_SELECT, button, screenFrame } from '../widgets';

export interface ResultAction {
  label: string;
  kind?: 'primary' | 'ghost' | 'default';
  icon?: string;
  onClick: () => void;
}

export interface ResultScreenOptions {
  kicker?: string;
  home: LoadingTeam;
  away: LoadingTeam;
  result: MatchResult;
  actions: ResultAction[];
  /** Escape / B */
  onBack?: () => void;
}

function playerName(id: number | undefined): string {
  if (id === undefined) return 'Unknown';
  try {
    const p = GetDB().GetPlayer(id);
    return `${p.firstname ? p.firstname.charAt(0) + '. ' : ''}${p.lastname}`;
  } catch {
    return 'Unknown';
  }
}

function eventLine(e: MatchEvent): HTMLElement {
  const kinds: Record<string, string> = { goal: 'Goal', owngoal: 'Own goal', yellow: 'Yellow card', red: 'Red card' };
  const who = playerName(e.playerDatabaseID);
  return h(
    'li',
    { class: `event event--${e.type}` },
    h('span', { class: 'event-minute' }, `${Math.max(1, Math.round(e.minute))}'`),
    h('span', { class: 'event-icon', 'aria-label': kinds[e.type] ?? e.type }),
    h('span', { class: 'event-text' }, who, e.type === 'owngoal' ? h('span', { class: 'event-note' }, ' (og)') : null, e.type === 'goal' && e.assistDatabaseID !== undefined ? h('span', { class: 'event-note' }, ` · assist ${playerName(e.assistDatabaseID)}`) : null),
  );
}

function bestPlayer(stats: PlayerMatchStats[]): PlayerMatchStats | null {
  let best: PlayerMatchStats | null = null;
  for (const s of stats) if (s.minutesPlayed > 0 && (!best || s.rating > best.rating)) best = s;
  return best;
}

export function createResultScreen(o: ResultScreenOptions): Screen {
  const { result } = o;
  const interesting = result.events.filter((e) => e.type === 'goal' || e.type === 'owngoal' || e.type === 'yellow' || e.type === 'red').sort((a, b) => a.minute - b.minute);
  // an own goal counts for the other team: list it on the side that benefits
  const forTeam = (teamID: 0 | 1) => interesting.filter((e) => (e.type === 'owngoal' ? 1 - e.teamID : e.teamID) === teamID);

  const outcome = result.homeGoals > result.awayGoals ? 'home' : result.homeGoals < result.awayGoals ? 'away' : 'draw';
  const team = (t: LoadingTeam, side: 'home' | 'away') =>
    h('div', { class: `result-team result-team--${side} ${outcome === side ? 'is-winner' : ''}`, style: `--c1: ${t.color1}` }, teamCrest(t, 'crest--xl'), h('div', { class: 'result-team-name' }, t.name));

  const events = (teamID: 0 | 1) => {
    const list = forTeam(teamID);
    return h('ul', { class: `event-list event-list--${teamID === 0 ? 'home' : 'away'}` }, list.length ? list.map(eventLine) : h('li', { class: 'event event--none' }, '—'));
  };

  const motm = bestPlayer(result.playerStats);
  const motmCard = motm
    ? h(
        'div',
        { class: 'panel motm' },
        h('span', { class: 'motm-icon' }, icon('trophy')),
        h('div', {}, h('div', { class: 'motm-label' }, 'Player of the match'), h('div', { class: 'motm-name' }, playerName(motm.playerDatabaseID), h('span', { class: 'motm-team' }, ` · ${motm.teamID === 0 ? o.home.shortName : o.away.shortName}`))),
        h('div', { class: 'motm-rating' }, motm.rating.toFixed(1)),
        h('div', { class: 'motm-stats' }, `${motm.goals} G · ${motm.assists} A · ${motm.passesCompleted}/${motm.passes} passes`),
      )
    : null;

  const el = screenFrame({
    id: 'result',
    kicker: o.kicker ?? 'Match',
    title: result.abandoned ? 'Match abandoned' : 'Full time',
    background: 'stadium',
    body: [
      h(
        'div',
        { class: 'result-layout' },
        h(
          'div',
          { class: 'panel scoreline' },
          team(o.home, 'home'),
          h('div', { class: 'score' }, h('span', { class: 'score-num' }, String(result.homeGoals)), h('span', { class: 'score-sep' }, '–'), h('span', { class: 'score-num' }, String(result.awayGoals))),
          team(o.away, 'away'),
        ),
        h('div', { class: 'panel result-events' }, events(0), events(1)),
        motmCard,
      ),
    ],
    hints: [HINT_NAVIGATE, HINT_SELECT],
    actions: o.actions.map((a, i) => button(a.label, a.onClick, { kind: a.kind ?? (i === 0 ? 'primary' : 'default'), icon: a.icon, attrs: i === 0 ? { 'data-nav-default': true } : {} })),
  });

  return withNav({ el }, { onBack: o.onBack ?? (() => undefined) });
}
