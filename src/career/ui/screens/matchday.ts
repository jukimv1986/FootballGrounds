// Match day: the fixture, both line-ups (the coach's picks, you highlighted), your role and
// condition, and the choice: PLAY the match in 3D (you control only yourself) or SIMULATE.

import { h } from '../../../ui/dom';
import { pushScreen, back, type Screen } from '../../../ui/router';
import { withNav } from '../../../ui/nav';
import { createLoadingScreen } from '../../../ui/screens/loading';
import { formatMatchDuration } from '../../../ui/screens/matchoptions';
import { GetConfigUnit } from '../../../ui/config';
import { _default_MatchDuration } from '../../../game/gamedefines';
import { pendingMatchContext, simulatePendingMatch } from '../../core/career';
import { teamName } from '../../core/competitions';
import { formatDateLong } from '../../core/dates';
import { fullName } from '../../core/footballer';
import { comp, city } from '../../core/index';
import { POSITION_NAMES } from '../../core/attributes';
import { USER_ID, lineupPlayer, lineupStrength, type Lineup } from '../../core/selection';
import { shortName } from '../../core/players';
import { canPlay3D, playPendingMatch3D } from '../../engine/play';
import type { CareerApp } from '../app';
import { crest, meter, pill, rgb } from '../components';
import { cicon } from '../icons';
import { createReportScreen } from './report';
import type { MatchReport } from '../../core/types';

/** match_duration values of the match day's quick / long options (see formatMatchDuration) */
export const SHORT_MATCH = 0.1;
export const LONG_MATCH = 0.75;

function lineupList(app: CareerApp, l: Lineup): HTMLElement {
  const s = app.state;
  const row = (e: Lineup['starters'][number]) => {
    const isUser = e.npcId === USER_ID;
    const p = isUser ? null : lineupPlayer(s, l, e.npcId);
    return h('li', { class: `cc-lu-row ${isUser ? 'is-user' : ''}` }, h('span', { class: 'cc-lu-pos' }, e.pos), h('span', { class: 'cc-lu-name' }, isUser ? fullName(s.user) : p ? shortName(p) : '—'), h('span', { class: 'cc-lu-rating' }, String(Math.round(e.rating))));
  };
  return h('div', { class: 'cc-lineup' }, h('ol', { class: 'cc-lu-list' }, ...l.starters.map(row)), l.bench.length ? h('div', { class: 'cc-lu-bench-title' }, 'Substitutes') : null, h('ol', { class: 'cc-lu-list cc-lu-bench' }, ...l.bench.map(row)));
}

export function createMatchDayScreen(app: CareerApp): Screen {
  const s = app.state;
  const ctx = pendingMatchContext(s);
  const el = h('section', { class: 'screen cc-screen cc-matchday' });
  const screen = withNav({ el }, { onBack: () => back() });
  if (!ctx) {
    el.append(h('div', { class: 'cc-screen-inner' }, h('p', {}, 'No match today.'), h('button', { class: 'btn', type: 'button', onclick: () => back() }, 'Back')));
    return screen;
  }
  const f = ctx.fixture;
  const c = comp(s, f.compId);
  const [hl, al] = ctx.lineups;
  const hs = lineupStrength(hl);
  const as = lineupStrength(al);
  const u = s.user;
  const homeClub = s.world.clubs[f.home];
  const venue = f.national ? 'National stadium' : homeClub ? `${homeClub.stadium}, ${city(s, homeClub.cityId).name}` : '';
  const mine = ctx.lineups[ctx.side];
  const myEntry = [...mine.starters, ...mine.bench].find((e) => e.npcId === USER_ID);
  const roleText = ctx.role === 'start' ? `You start as ${POSITION_NAMES[myEntry?.pos ?? u.pos].toLowerCase()}` : ctx.role === 'bench' ? 'You start on the bench' : 'You are not in the squad';
  const play = canPlay3D(s);
  const [c1] = f.national ? [[200, 200, 200] as [number, number, number]] : homeClub ? homeClub.colors : [[120, 120, 120] as [number, number, number]];
  const away = s.world.clubs[f.away];

  const finish = (report: MatchReport | null, note?: string) => {
    // back to the career shell, with the report on top
    app.show();
    if (report) pushScreen(createReportScreen(app, report, note));
  };

  const simulate = () => {
    const report = simulatePendingMatch(s);
    finish(report);
  };

  const play3d = async () => {
    const loading = createLoadingScreen({
      title: `${c?.name ?? 'Match'} · ${teamName(s, f.home, f.youth)} vs ${teamName(s, f.away, f.youth)}`,
      subtitle: venue,
      home: { name: teamName(s, f.home, f.youth), shortName: homeClub?.shortName ?? 'HOM', logo: '', color1: rgb(homeClub?.colors[0] ?? [200, 200, 200]), color2: rgb(homeClub?.colors[1] ?? [40, 40, 40]) },
      away: { name: teamName(s, f.away, f.youth), shortName: away?.shortName ?? 'AWY', logo: '', color1: rgb(away?.colors[0] ?? [40, 40, 40]), color2: rgb(away?.colors[1] ?? [200, 200, 200]) },
      tips: ['Be a pro: you control only your own player. Move into space, call for the ball and do your job.', 'Your attributes in the 3D match are exactly your career attributes.', 'Tired legs? Energy, fitness and sharpness come from your week — and your nights.', 'Hold sprint to burst past defenders — but your stamina will pay for it later in the match.'],
    });
    pushScreen(loading);
    const res = await playPendingMatch3D(s, { onLoadProgress: (x) => loading.setProgress(x) });
    finish(res.report, res.note);
    if (res.simulated && res.note) app.toast(res.note, 'warn');
    app.save(false);
  };

  // match length for PLAY: the game setting, or a quick / long match just for career games
  const lengthRow = () => {
    const configured = GetConfigUnit('match_duration', _default_MatchDuration);
    const options: { key: string; label: string; value: number | null }[] = [
      { key: 'short', label: 'Short', value: SHORT_MATCH },
      { key: 'normal', label: 'Normal', value: null },
      { key: 'long', label: 'Long', value: LONG_MATCH },
    ];
    const current = s.settings.matchDuration;
    const row = h(
      'div',
      { class: 'cc-md-length', role: 'group', 'aria-label': 'Match length' },
      h('span', { class: 'cc-kicker' }, 'Match length'),
      ...options.map((o) => {
        const selected = o.value === null ? current === null : current === o.value;
        const minutes = formatMatchDuration(o.value ?? configured);
        return h(
          'button',
          {
            class: `cc-choice-chip ${selected ? 'is-selected' : ''}`,
            type: 'button',
            'aria-pressed': selected ? 'true' : 'false',
            title: o.value === null ? 'Your match duration setting' : undefined,
            onclick: () => {
              s.settings.matchDuration = o.value;
              row.replaceWith(lengthRow());
            },
          },
          h('strong', {}, o.label),
          h('small', {}, minutes),
        );
      }),
    );
    return row;
  };

  el.append(
    h('div', { class: 'cc-matchday-bg', style: `--c1: ${rgb(c1)}` }),
    h(
      'div',
      { class: 'cc-screen-inner' },
      h('header', { class: 'cc-md-head' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => back(), 'data-nav-skip': true }, cicon('back')), h('div', {}, h('div', { class: 'cc-kicker' }, c ? (c.type === 'cup' || c.type === 'continental' || c.id.startsWith('TOUR') ? `${c.name} · ${c.roundNames[f.round] ?? ''}` : c.name) : 'Match'), h('h1', { class: 'cc-md-title' }, 'Match day'), h('p', { class: 'cc-dim' }, `${formatDateLong(s.day)} · ${venue}`))),
      h(
        'div',
        { class: 'cc-md-matchup' },
        h('div', { class: 'cc-md-team' }, crest(s, f.home, 'xl'), h('strong', {}, teamName(s, f.home, f.youth)), h('span', { class: 'cc-dim' }, `Strength ${Math.round(hs.overall)}`)),
        h('div', { class: 'cc-md-vs' }, 'VS'),
        h('div', { class: 'cc-md-team' }, crest(s, f.away, 'xl'), h('strong', {}, teamName(s, f.away, f.youth)), h('span', { class: 'cc-dim' }, `Strength ${Math.round(as.overall)}`)),
      ),
      h('div', { class: `cc-md-role cc-md-role--${ctx.role}` }, h('strong', {}, roleText), ctx.role === 'bench' ? h('span', {}, 'The coach may bring you on in the second half.') : null),
      h('div', { class: 'cc-md-cond' }, meter('Energy', u.energy, { compact: true }), meter('Fitness', u.fitness, { compact: true }), meter('Sharpness', u.sharpness, { compact: true }), meter('Morale', u.morale, { compact: true })),
      h(
        'div',
        { class: 'cc-md-actions' },
        h(
          'button',
          { class: 'btn btn--primary btn--kickoff cc-md-play', type: 'button', disabled: play.ok ? undefined : true, title: play.reason ?? '', onclick: () => void play3d(), 'data-nav-default': play.ok ? true : undefined },
          cicon('play3d'),
          h('span', {}, 'Play match (3D)'),
        ),
        h('button', { class: 'btn cc-md-sim', type: 'button', onclick: simulate, 'data-nav-default': play.ok ? undefined : true }, cicon('sim'), h('span', {}, ctx.role === 'start' ? 'Simulate' : ctx.role === 'bench' ? 'Simulate (you may come on)' : 'Simulate')),
      ),
      play.ok ? lengthRow() : null,
      h('p', { class: 'cc-md-note cc-dim' }, play.ok ? 'PLAY: you control only yourself, the camera follows you. Your real career attributes are used.' : play.reason ?? ''),
      h('div', { class: 'cc-md-lineups' }, h('div', {}, h('h3', {}, teamName(s, f.home, f.youth), h('span', { class: 'cc-dim' }, ` · ${hl.formation}`)), lineupList(app, hl)), h('div', {}, h('h3', {}, teamName(s, f.away, f.youth), h('span', { class: 'cc-dim' }, ` · ${al.formation}`)), lineupList(app, al))),
      pill(ctx.side === 0 ? 'Home' : 'Away', 'dim'),
    ),
  );
  return screen;
}
