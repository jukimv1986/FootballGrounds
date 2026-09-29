// App entry: loads the asset manifest, the team database and the configuration, installs the
// globals the ported game code expects (GetDB(), GetConfiguration(), GetMenuTask()), boots the
// runtime (src/app/boot.ts) and shows the title screen.

import { FileSystem } from './blunted/managers/filesystem';
import { Database } from './game/data/database';
import { SetConfiguration, SetDB, SetMenuTask } from './game/globals';
import { MenuTask } from './game/menu/menutask';
import { bootRuntime } from './app/boot';
import { LoadConfiguration } from './ui/config';
import { dataUrl } from './ui/dom';
import { installGlobalErrorHandler, showErrorPanel } from './ui/errorpanel';
import { initNav } from './ui/nav';
import { showTitleScreen } from './ui/screens/title';

export { SaveConfiguration, LoadConfiguration } from './ui/config';

/** images the first screens show; loaded into the browser cache before the title appears */
const MENU_IMAGES = [
  'media/menu/backgrounds/megabackground01.jpg',
  'media/menu/credits/bg.png',
  'media/menu/main/title01.png',
];

function splashStatus(text: string, fraction?: number): void {
  const status = document.getElementById('boot-status');
  if (status) status.textContent = text;
  const bar = document.getElementById('boot-bar');
  if (bar && fraction !== undefined) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`;
}

function hideSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.classList.add('is-done');
  setTimeout(() => splash.remove(), 600);
}

/** warms the browser cache; never blocks boot for more than timeout_ms */
function preloadImages(paths: string[], timeout_ms = 4000): Promise<void> {
  const one = (p: string) =>
    new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = dataUrl(p);
    });
  return Promise.race([Promise.all(paths.map(one)).then(() => undefined), new Promise<void>((r) => setTimeout(r, timeout_ms))]);
}

async function boot(): Promise<void> {
  splashStatus('Loading assets', 0.05);
  await FileSystem.LoadManifest();

  splashStatus('Loading teams', 0.2);
  const files = ['databases/default/database.json'];
  const hasDefaults = FileSystem.Exists('football.config');
  if (hasDefaults) files.push('football.config');
  await Promise.all([FileSystem.Preload(files), preloadImages(MENU_IMAGES)]);

  SetDB(Database.LoadDefault());
  SetConfiguration(LoadConfiguration(hasDefaults ? FileSystem.GetText('football.config') : ''));
  SetMenuTask(new MenuTask());

  splashStatus('Starting engine', 0.6);
  await bootRuntime((p) => splashStatus(p.status ?? 'Starting engine', p.fraction !== undefined ? 0.6 + p.fraction * 0.4 : undefined));

  splashStatus('Ready', 1);
  initNav();
  showTitleScreen();
  hideSplash();
}

installGlobalErrorHandler();
boot().catch((e) => {
  console.error(e);
  hideSplash();
  showErrorPanel(e, {
    title: "The game couldn't start",
    hint: 'Loading the game data failed. Check your connection and try again.',
    fatal: true,
  });
});
