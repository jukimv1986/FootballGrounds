// Title screen / main menu (C++ menu/mainmenu: Match, Cup, League, Editor, Settings, Credits,
// Exit). The browser build offers Career, Quick Match, Settings and Credits. The career mode
// (src/career) is loaded lazily, so the menus keep working while it is not available.

import { dataUrl, h } from '../dom';
import { icon } from '../icons';
import { withNav } from '../nav';
import { pushScreen, showScreen, type Screen } from '../router';
import { HINT_NAVIGATE, HINT_SELECT, hintBar, showModal, showToast } from '../widgets';
import { openQuickMatch } from './quickmatch';
import { createSettingsScreen } from './settings';
import { createCreditsScreen } from './credits';

export const APP_VERSION = '0.1.0';

// the career mode is written in parallel; import it lazily so a missing/broken module only
// disables the Career entry (import.meta.glob resolves to {} while src/career/index.ts is absent)
const careerModules = import.meta.glob<{ openCareerMenu?: () => void }>('../../career/index.ts');

async function openCareer(): Promise<void> {
  const loader = Object.values(careerModules)[0];
  if (!loader) {
    careerComingSoon();
    return;
  }
  try {
    const mod = await loader();
    if (typeof mod.openCareerMenu !== 'function') throw new Error('openCareerMenu() not exported');
    mod.openCareerMenu();
  } catch (e) {
    console.error('career mode failed to load', e);
    careerComingSoon();
  }
}

function careerComingSoon(): void {
  showModal({
    kicker: 'Career mode',
    title: 'Coming soon',
    icon: 'career',
    body: [
      h(
        'p',
        {},
        'Career mode — play a footballer from academy prospect to retirement, with training, city life and transfers — is still being built. Try a Quick Match in the meantime.',
      ),
    ],
    actions: [{ label: 'Quick Match', kind: 'primary', onClick: () => openQuickMatch() }, { label: 'Close' }],
  });
}

interface MenuEntry {
  id: string;
  label: string;
  sub: string;
  icon: string;
  primary?: boolean;
  run: () => void;
}

export function createTitleScreen(): Screen {
  const entries: MenuEntry[] = [
    { id: 'career', label: 'Career', sub: 'From youngster to legend — your life on and off the pitch', icon: 'career', primary: true, run: () => void openCareer() },
    { id: 'quickmatch', label: 'Quick Match', sub: 'Pick two clubs and kick off', icon: 'ball', run: () => openQuickMatch() },
    { id: 'settings', label: 'Settings', sub: 'Graphics · Audio · Camera · Gameplay · Controls', icon: 'settings', run: () => pushScreen(createSettingsScreen()) },
    { id: 'credits', label: 'Credits', sub: 'The people behind the game', icon: 'credits', run: () => pushScreen(createCreditsScreen()) },
  ];

  const menu = h(
    'nav',
    { class: 'title-menu', 'aria-label': 'Main menu' },
    entries.map((e, i) =>
      h(
        'button',
        {
          type: 'button',
          class: `menu-item ${e.primary ? 'menu-item--primary' : ''}`,
          dataset: { id: e.id },
          style: `--i: ${i}`,
          onclick: e.run,
          'data-nav-default': i === 0 ? true : undefined,
        },
        h('span', { class: 'menu-item-icon' }, icon(e.icon)),
        h('span', { class: 'menu-item-text' }, h('span', { class: 'menu-item-label' }, e.label), h('span', { class: 'menu-item-sub' }, e.sub)),
        h('span', { class: 'menu-item-chevron' }, icon('chevron')),
      ),
    ),
  );

  const el = h(
    'section',
    { class: 'screen screen--title' },
    h(
      'div',
      { class: 'title-bg', 'aria-hidden': 'true' },
      h('div', { class: 'title-bg-layer title-bg-city', style: `background-image: url("${dataUrl('media/menu/backgrounds/megabackground01.jpg')}")` }),
      h('div', { class: 'title-bg-layer title-bg-player', style: `background-image: url("${dataUrl('media/menu/credits/bg.png')}")` }),
      h('div', { class: 'title-bg-sweep' }),
      h('div', { class: 'title-bg-shade' }),
    ),
    h(
      'div',
      { class: 'title-layout' },
      h(
        'header',
        { class: 'title-brand' },
        h(
          'div',
          { class: 'wordmark', role: 'img', 'aria-label': 'Football Career' },
          h('span', { class: 'wordmark-top' }, 'Football'),
          h('span', { class: 'wordmark-main' }, 'Career'),
          h('span', { class: 'wordmark-bar' }),
        ),
        h('p', { class: 'title-tagline' }, 'Live the life of a professional footballer.'),
      ),
      menu,
      h(
        'footer',
        { class: 'title-foot' },
        hintBar([HINT_NAVIGATE, HINT_SELECT]),
        h(
          'div',
          { class: 'title-credit' },
          h('img', { class: 'title-credit-logo', src: dataUrl('media/menu/main/title01.png'), alt: 'Gameplay Football', draggable: 'false' }),
          h('span', {}, `v${APP_VERSION} · powered by Gameplay Football`),
        ),
      ),
    ),
  );

  let timer = 0;
  return withNav(
    {
      el,
      onShow() {
        // alternate the two backgrounds (city at night / the striker in the spotlight)
        let player = false;
        window.clearInterval(timer);
        timer = window.setInterval(() => {
          player = !player;
          el.classList.toggle('show-player', player);
        }, 11000);
      },
      onHide() {
        window.clearInterval(timer);
      },
    },
    {
      wrap: true,
      onBack: () => showToast('Close the tab to quit — your settings are saved.', 'info'),
    },
  );
}

export function showTitleScreen(): void {
  showScreen(createTitleScreen());
}
