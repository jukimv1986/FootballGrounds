// Match options (C++ menu/startmatch/matchoptions): difficulty and match duration sliders, saved
// as the defaults (config match_difficulty / match_duration), then kick-off.

import { GetConfiguration } from '../../game/globals';
import { _default_Difficulty, _default_MatchDuration } from '../../game/gamedefines';
import { SaveConfiguration } from '../config';
import { h } from '../dom';
import { withNav } from '../nav';
import { back, type Screen } from '../router';
import { getTeamInfo, kitPreview, teamCrest } from '../teams';
import { HINT_BACK, HINT_NAVIGATE, HINT_SELECT, button, screenFrame, sliderRow } from '../widgets';
import { GetDB } from '../../game/globals';
import { QUICKMATCH_STEPS, launchQuickMatch, type QuickMatchSetup } from './quickmatch';
import { listControllers } from './controllerselect';

/** C++ Match: matchDurationFactor = match_duration * 0.2 + 0.05; 90 game minutes take 90 * factor real minutes */
export function matchDurationMinutes(duration: number): number {
  return 90 * (duration * 0.2 + 0.05);
}

export function formatMatchDuration(duration: number): string {
  return `≈ ${Math.round(matchDurationMinutes(duration))} min`;
}

const DIFFICULTY_NAMES = ['Amateur', 'Semi-pro', 'Professional', 'World class', 'Legendary'];

export function formatDifficulty(v: number): string {
  return DIFFICULTY_NAMES[Math.min(DIFFICULTY_NAMES.length - 1, Math.floor(v * DIFFICULTY_NAMES.length))];
}

export function createMatchOptionsScreen(setup: QuickMatchSetup): Screen {
  const home = getTeamInfo(setup.homeTeamID);
  const away = getTeamInfo(setup.awayTeamID);
  const config = GetConfiguration();

  const duration = sliderRow({
    label: 'Match duration',
    description: 'Real time for 90 minutes of football (5 .. 25 min).',
    value: setup.matchDuration,
    defaultValue: _default_MatchDuration,
    format: formatMatchDuration,
    onInput: (v) => {
      setup.matchDuration = v;
      config.Set('match_duration', v);
    },
  });
  const difficulty = sliderRow({
    label: 'Difficulty',
    description: 'How well the CPU plays when you face it.',
    value: setup.difficulty,
    defaultValue: _default_Difficulty,
    format: (v) => `${formatDifficulty(v)} · ${Math.round(v * 100)}`,
    onInput: (v) => {
      setup.difficulty = v;
      config.Set('match_difficulty', v);
    },
  });
  for (const input of [duration.input, difficulty.input]) input.addEventListener('change', () => SaveConfiguration());

  const controllers = listControllers();
  const who = (side: number) =>
    setup.sides
      .filter((s) => s.side === side)
      .map((s) => controllers.find((c) => c.controllerID === s.controllerID)?.name ?? `Controller ${s.controllerID + 1}`);
  const sideLine = (side: number) => {
    const names = who(side);
    return names.length ? names.join(', ') : 'CPU';
  };

  const teamBlock = (info: typeof home, kit: number, side: number) =>
    h(
      'div',
      { class: 'matchup-team', style: `--c1: ${info.color1}` },
      teamCrest(info, 'crest--lg'),
      h('div', { class: 'matchup-name' }, info.name),
      h('div', { class: 'matchup-kit' }, kitPreview(GetDB().GetTeam(info.id), kit, 'kit--sm'), h('span', {}, kit === 1 ? 'Home kit' : 'Away kit')),
      h('div', { class: `matchup-ctrl ${who(side).length ? 'is-human' : ''}` }, sideLine(side)),
    );

  const kickOff = button('Kick off', () => void launchQuickMatch(setup), { kind: 'primary', icon: 'whistle', className: 'btn--kickoff', attrs: { 'data-nav-default': true } });

  const el = screenFrame({
    id: 'matchoptions',
    kicker: 'Quick match',
    title: 'Match options',
    onBack: () => back(),
    steps: { labels: QUICKMATCH_STEPS, active: 2 },
    background: 'stadium',
    body: [
      h(
        'div',
        { class: 'options-layout' },
        h(
          'div',
          { class: 'panel matchup' },
          h('div', { class: 'matchup-kicker' }, 'Friendly · Kick-off'),
          h('div', { class: 'matchup-row' }, teamBlock(home, setup.homeKit, -1), h('div', { class: 'matchup-vs' }, 'VS'), teamBlock(away, setup.awayKit, 1)),
        ),
        h('div', { class: 'panel options-panel' }, h('h2', { class: 'panel-title' }, 'Rules'), duration.el, difficulty.el, h('p', { class: 'muted small' }, 'These values are saved as your defaults.')),
      ),
    ],
    hints: [HINT_NAVIGATE, { keys: ['←', '→'], pad: ['◀', '▶'], label: 'Adjust' }, HINT_SELECT, HINT_BACK],
    actions: [kickOff],
  });

  return withNav({ el }, { onBack: () => back() });
}
