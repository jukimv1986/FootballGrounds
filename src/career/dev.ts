// Dev entry (career-test.html): boots only the career UI, like the app does — manifest,
// database and configuration — then opens the career menu. `?automation` exposes a small API
// for browser tests.

import { FileSystem } from '../blunted/managers/filesystem';
import { Properties } from '../blunted/base/properties';
import { Database } from '../game/data/database';
import { SetConfiguration, SetDB, SetMenuTask } from '../game/globals';
import { MenuTask } from '../game/menu/menutask';
import { initNav } from '../ui/nav';
import { openCareerMenu } from './index';
import { autoPlay } from './core/autoplay';
import { dayOf } from './core/dates';

async function boot(): Promise<void> {
  await FileSystem.LoadManifest();
  await FileSystem.Preload(['databases/default/database.json']);
  SetDB(Database.LoadDefault());
  SetConfiguration(new Properties());
  SetMenuTask(new MenuTask());
  initNav();
  openCareerMenu();
  if (new URLSearchParams(location.search).has('automation')) {
    (window as unknown as Record<string, unknown>).__career = { autoPlay, dayOf };
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:16px">Career dev boot failed: ${String(e)}</pre>`);
});
