// Quick match: team + kit selection (C++ menu/startmatch/teamselect), then controller setup
// (menu/controllerselect), match options (menu/startmatch/matchoptions), the loading screen
// (menu/startmatch/loadingmatch) and a full-time result screen.

import { HasMatchSessionRunner, StartMatchSession, type MatchResult } from '../../app/matchsession';
import { GetConfiguration, GetDB } from '../../game/globals';
import { _default_Difficulty, _default_MatchDuration } from '../../game/gamedefines';
import type { SideSelection } from '../../game/menu/menutask';
import { GetConfigUnit, SaveConfiguration } from '../config';
import { h } from '../dom';
import { icon } from '../icons';
import { setNavHandler, withNav } from '../nav';
import { back, pushScreen, setMenuLayerVisible, showScreen, type Screen } from '../router';
import { getLeagueGroups, getOrderedTeamIDs, getTeamInfo, kitPreview, leagueBadge, ratingBadge, ratingBars, teamCrest, type TeamInfo } from '../teams';
import { HINT_BACK, HINT_NAVIGATE, HINT_SELECT, button, screenFrame, showModal } from '../widgets';
import { createControllerSelectScreen } from './controllerselect';
import { createLoadingScreen } from './loading';
import { createMatchOptionsScreen } from './matchoptions';
import { createResultScreen } from './result';
import { showTitleScreen } from './title';

export interface QuickMatchSetup {
  homeTeamID: number;
  awayTeamID: number;
  /** 1 = home kit, 2 = away kit */
  homeKit: number;
  awayKit: number;
  sides: SideSelection[];
  /** 0 .. 1 (config match_duration) */
  matchDuration: number;
  /** 0 .. 1 (config match_difficulty) */
  difficulty: number;
}

export const QUICKMATCH_STEPS = ['Teams', 'Controls', 'Options'];

let lastSetup: QuickMatchSetup | null = null;

function defaultSetup(): QuickMatchSetup {
  const ids = getOrderedTeamIDs();
  const config = GetConfiguration();
  const has = (id: number) => ids.includes(id);
  let home = config.GetInt('menu_quickmatch_home', -1);
  let away = config.GetInt('menu_quickmatch_away', -1);
  if (!has(home)) home = ids[0] ?? -1;
  if (!has(away)) {
    // default opponent: first team of another league
    const homeLeague = has(home) ? GetDB().GetTeam(home).league_id : -1;
    away = ids.find((id) => GetDB().GetTeam(id).league_id !== homeLeague) ?? ids[1] ?? home;
  }
  return {
    homeTeamID: home,
    awayTeamID: away,
    homeKit: 1,
    awayKit: 2,
    sides: [],
    matchDuration: GetConfigUnit('match_duration', _default_MatchDuration),
    difficulty: GetConfigUnit('match_difficulty', _default_Difficulty),
  };
}

/** opens the quick match flow on top of the current screen */
export function openQuickMatch(): void {
  if (getOrderedTeamIDs().length === 0) {
    showModal({ title: 'No teams available', icon: 'warn', body: [h('p', {}, 'The team database is empty.')] });
    return;
  }
  const setup = lastSetup ?? defaultSetup();
  pushScreen(createTeamSelectScreen(setup));
}

function rememberTeams(setup: QuickMatchSetup): void {
  lastSetup = setup;
  const config = GetConfiguration();
  config.SetInt('menu_quickmatch_home', setup.homeTeamID);
  config.SetInt('menu_quickmatch_away', setup.awayTeamID);
  SaveConfiguration();
}

/** same team on both sides: make sure the kits differ */
function fixKitClash(setup: QuickMatchSetup, changed: 'home' | 'away'): void {
  if (setup.homeTeamID === setup.awayTeamID && setup.homeKit === setup.awayKit) {
    if (changed === 'home') setup.awayKit = setup.homeKit === 1 ? 2 : 1;
    else setup.homeKit = setup.awayKit === 1 ? 2 : 1;
  }
}

// ----- team select screen

type Side = 'home' | 'away';

export function createTeamSelectScreen(setup: QuickMatchSetup): Screen {
  const order = getOrderedTeamIDs();
  const cards: Record<Side, HTMLElement> = { home: h('div'), away: h('div') };

  const teamOf = (side: Side) => (side === 'home' ? setup.homeTeamID : setup.awayTeamID);
  const setTeam = (side: Side, id: number) => {
    if (side === 'home') setup.homeTeamID = id;
    else setup.awayTeamID = id;
    fixKitClash(setup, side);
    render();
  };
  const cycle = (side: Side, delta: number) => {
    const i = order.indexOf(teamOf(side));
    setTeam(side, order[(i + delta + order.length) % order.length]);
    const sw = cards[side].querySelector<HTMLElement>('.team-switch');
    sw?.classList.remove('bump-left', 'bump-right');
    void sw?.offsetWidth;
    sw?.classList.add(delta < 0 ? 'bump-left' : 'bump-right');
  };

  const buildCard = (side: Side): HTMLElement => {
    const info = getTeamInfo(teamOf(side));
    const record = GetDB().GetTeam(info.id);
    const kit = side === 'home' ? setup.homeKit : setup.awayKit;

    const teamSwitch = h(
      'div',
      {
        class: 'team-switch',
        tabindex: '0',
        role: 'button',
        'aria-label': `${side === 'home' ? 'Home' : 'Away'} team: ${info.name}. Left and right to change, Enter to browse.`,
        dataset: { side },
        'data-nav-default': side === 'home' ? true : undefined,
        onclick: (e: MouseEvent) => {
          if ((e.target as HTMLElement).closest('.team-switch-arrow')) return;
          openTeamPicker(side);
        },
      },
      h('button', { type: 'button', class: 'team-switch-arrow is-prev', tabindex: '-1', 'aria-label': 'Previous team', onclick: () => cycle(side, -1) }, icon('prev')),
      h('span', { class: 'team-switch-crest' }, teamCrest(info, 'crest--xl')),
      h('button', { type: 'button', class: 'team-switch-arrow is-next', tabindex: '-1', 'aria-label': 'Next team', onclick: () => cycle(side, 1) }, icon('next')),
    );
    setNavHandler(teamSwitch, (action) => {
      if (action === 'left' || action === 'right') {
        cycle(side, action === 'left' ? -1 : 1);
        return true;
      }
      return false;
    });

    const kitButtons = [1, 2].map((n) =>
      h(
        'button',
        {
          type: 'button',
          class: `kit-option ${kit === n ? 'is-selected' : ''}`,
          'aria-pressed': String(kit === n),
          dataset: { kit: String(n), side },
          onclick: () => {
            if (side === 'home') setup.homeKit = n;
            else setup.awayKit = n;
            fixKitClash(setup, side);
            render();
          },
        },
        kitPreview(record, n),
        h('span', { class: 'kit-option-label' }, n === 1 ? 'Home kit' : 'Away kit'),
      ),
    );

    return h(
      'article',
      { class: `team-card team-card--${side}`, style: `--c1: ${info.color1}; --c2: ${info.color2}` },
      h('div', { class: 'team-card-glow', 'aria-hidden': 'true' }),
      h('div', { class: 'team-card-top' }, h('span', { class: 'side-chip' }, side === 'home' ? 'Home' : 'Away'), h('span', { class: 'team-card-league' }, leagueBadge(info.leagueLogo, info.leagueName), h('span', {}, info.leagueName))),
      teamSwitch,
      h('h2', { class: 'team-card-name' }, info.name),
      h('div', { class: 'team-card-country' }, info.countryName ? `${info.countryName} · ${info.shortName}` : info.shortName),
      h('div', { class: 'team-card-stats' }, ratingBadge(info.overall), ratingBars(info)),
      h('div', { class: 'kit-choice' }, ...kitButtons),
    );
  };

  const vs = h(
    'div',
    { class: 'versus' },
    h('span', { class: 'versus-text' }, 'VS'),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn swap-btn',
        'aria-label': 'Swap home and away',
        title: 'Swap home and away',
        onclick: () => {
          [setup.homeTeamID, setup.awayTeamID] = [setup.awayTeamID, setup.homeTeamID];
          [setup.homeKit, setup.awayKit] = [setup.awayKit, setup.homeKit];
          render();
        },
      },
      icon('swap'),
    ),
  );

  const grid = h('div', { class: 'teamselect-grid' }, cards.home, vs, cards.away);
  // the footer "Browse clubs" button opens the picker for the side used last
  let lastSide: Side = 'home';
  grid.addEventListener('focusin', (e) => {
    const card = (e.target as HTMLElement).closest('.team-card');
    if (card) lastSide = card.classList.contains('team-card--away') ? 'away' : 'home';
  });

  const render = () => {
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active?.closest('.team-card') ? (active.classList.contains('team-switch') ? `switch-${active.dataset.side}` : active.dataset.kit ? `kit-${active.dataset.side}-${active.dataset.kit}` : '') : '';
    for (const side of ['home', 'away'] as Side[]) {
      const card = buildCard(side);
      cards[side].replaceWith(card);
      cards[side] = card;
    }
    if (focusKey) {
      const [kind, side, kit] = focusKey.split('-');
      const target = kind === 'switch' ? cards[side as Side].querySelector<HTMLElement>('.team-switch') : cards[side as Side].querySelector<HTMLElement>(`[data-kit="${kit}"]`);
      target?.focus({ preventScroll: true });
    }
  };

  const openTeamPicker = (side: Side) => {
    const current = teamOf(side);
    const groups = getLeagueGroups();
    const modal = showModal({
      kicker: side === 'home' ? 'Home team' : 'Away team',
      title: 'Choose a club',
      className: 'modal--wide team-picker',
      body: groups.map((g) =>
        h(
          'section',
          { class: 'picker-league' },
          h('header', { class: 'picker-league-head' }, leagueBadge(g.logo, g.name), h('span', { class: 'picker-league-name' }, g.name), g.countryName ? h('span', { class: 'picker-league-country' }, g.countryName) : null),
          h(
            'div',
            { class: 'picker-teams' },
            g.teams.map((t: TeamInfo) =>
              h(
                'button',
                {
                  type: 'button',
                  class: `picker-team ${t.id === current ? 'is-current' : ''}`,
                  style: `--c1: ${t.color1}; --c2: ${t.color2}`,
                  'data-nav-default': t.id === current ? true : undefined,
                  onclick: () => {
                    modal.close();
                    setTeam(side, t.id);
                    cards[side].querySelector<HTMLElement>('.team-switch')?.focus({ preventScroll: true });
                  },
                },
                teamCrest(t, 'crest--md'),
                h('span', { class: 'picker-team-name' }, t.name),
                h('span', { class: 'picker-team-meta' }, h('span', { class: 'picker-team-short' }, t.shortName), h('span', { class: 'picker-team-ovr' }, `${t.overall} OVR`)),
              ),
            ),
          ),
        ),
      ),
      actions: [{ label: 'Cancel', kind: 'ghost' }],
    });
  };

  render();

  const next = () => {
    rememberTeams(setup);
    pushScreen(createControllerSelectScreen(setup));
  };

  const el = screenFrame({
    id: 'teamselect',
    kicker: 'Quick match',
    title: 'Choose teams',
    onBack: () => back(),
    steps: { labels: QUICKMATCH_STEPS, active: 0 },
    background: 'stadium',
    body: [grid],
    hints: [HINT_NAVIGATE, { keys: ['←', '→'], pad: ['◀', '▶'], label: 'Change team' }, HINT_SELECT, HINT_BACK],
    actions: [button('Browse clubs', () => openTeamPicker(lastSide), { kind: 'ghost', icon: 'grid', className: 'hide-sm' }), button('Next', next, { kind: 'primary', icon: 'next', className: 'btn--next' })],
  });

  return withNav({ el }, { onBack: () => back() });
}

// ----- match launch

function describeSides(sides: SideSelection[]): string {
  const home = sides.filter((s) => s.side === -1).length;
  const away = sides.filter((s) => s.side === 1).length;
  if (home === 0 && away === 0) return 'CPU vs CPU';
  return `${home || 'CPU'} vs ${away || 'CPU'}`;
}

function engineUnavailable(): void {
  showModal({
    kicker: 'Quick match',
    title: 'Match engine not available',
    icon: 'warn',
    body: [
      h('p', {}, 'The 3D match engine is not wired up in this build yet, so the match cannot be played.'),
      h('p', { class: 'muted' }, 'Your team selection and settings have been kept — try again once the engine is available.'),
    ],
    actions: [{ label: 'OK', kind: 'primary' }],
  });
}

/** starts the match session with a loading screen; shows the result screen afterwards */
export async function launchQuickMatch(setup: QuickMatchSetup): Promise<void> {
  rememberTeams(setup);
  if (!HasMatchSessionRunner()) {
    engineUnavailable();
    return;
  }
  const home = getTeamInfo(setup.homeTeamID);
  const away = getTeamInfo(setup.awayTeamID);
  const title = `Quick match · ${describeSides(setup.sides)}`;
  const loading = createLoadingScreen({ title: 'Quick match', subtitle: 'Friendly', home, away });
  pushScreen(loading);

  let result: MatchResult;
  try {
    result = await StartMatchSession({
      homeTeamDatabaseID: setup.homeTeamID,
      awayTeamDatabaseID: setup.awayTeamID,
      homeKit: setup.homeKit,
      awayKit: setup.awayKit,
      sides: setup.sides.map((s) => ({ ...s })),
      matchDuration: setup.matchDuration,
      difficulty: setup.difficulty,
      title,
      onLoadProgress: (fraction) => {
        loading.setProgress(fraction);
        // the match is on screen now: hide the menu layer until the session resolves
        if (fraction >= 1) setMenuLayerVisible(false);
      },
    });
  } catch (e) {
    setMenuLayerVisible(true);
    back(); // leave the loading screen
    const message = e instanceof Error ? e.message : String(e);
    if (/match engine not available/i.test(message)) engineUnavailable();
    else
      showModal({
        kicker: 'Quick match',
        title: 'The match could not be started',
        icon: 'warn',
        body: [h('p', {}, 'Something went wrong while preparing the match.'), h('pre', { class: 'error-detail' }, message)],
      });
    return;
  }
  setMenuLayerVisible(true);

  showScreen(
    createResultScreen({
      kicker: 'Quick match · Friendly',
      home,
      away,
      result,
      actions: [
        { label: 'Rematch', kind: 'primary', icon: 'refresh', onClick: () => void rematch(setup) },
        { label: 'Change teams', icon: 'swap', onClick: () => changeTeams(setup) },
        { label: 'Main menu', icon: 'home', onClick: () => showTitleScreen() },
      ],
      onBack: () => showTitleScreen(),
    }),
  );
}

async function rematch(setup: QuickMatchSetup): Promise<void> {
  showTitleScreen();
  pushScreen(createTeamSelectScreen(setup));
  pushScreen(createControllerSelectScreen(setup));
  pushScreen(createMatchOptionsScreen(setup));
  await launchQuickMatch(setup);
}

function changeTeams(setup: QuickMatchSetup): void {
  showTitleScreen();
  pushScreen(createTeamSelectScreen(setup));
}
