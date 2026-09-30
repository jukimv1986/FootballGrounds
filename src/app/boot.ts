// Runtime bootstrap, called by src/main.ts after the database, the configuration and the
// MenuTask are set up, before the title screen is shown: creates the controllers, the Three.js
// renderer on #game-canvas and installs the match session runner (which owns the game loop and
// the Web Audio backend) so StartMatchSession() works.

import { DetectQuality, type RenderQuality } from '../blunted/render/quality';
import { ThreeRenderer } from '../blunted/render/threerenderer';
import { GetConfiguration } from '../game/globals';
import { InitControllers } from '../game/hid/controllers';
import { InstallMatchSessionRunner, type MatchRenderer } from './matchsessionrunner';

export interface BootProgress {
  /** status text for the boot splash */
  status?: string;
  /** 0 .. 1 */
  fraction?: number;
}

let renderer: ThreeRenderer | null = null;

function ConfiguredQuality(): RenderQuality {
  const q = GetConfiguration().Get('graphics_quality', '');
  return q === 'low' || q === 'medium' || q === 'high' ? q : DetectQuality();
}

/** the app's renderer (null if WebGL is unavailable) */
export function GetRenderer(): ThreeRenderer | null {
  return renderer;
}

export async function bootRuntime(report?: (progress: BootProgress) => void): Promise<void> {
  report?.({ status: 'Starting engine', fraction: 0 });
  InitControllers();

  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#game-canvas missing');
  try {
    renderer = new ThreeRenderer(canvas, { quality: ConfiguredQuality() });
  } catch (e) {
    // no WebGL: menus and career still work, 3D matches are unavailable (StartMatchSession rejects)
    console.warn('3D renderer unavailable', e);
    return;
  }
  const r = renderer;
  let quality = ConfiguredQuality();
  // the settings screen can change the quality at any time: pick it up on the next frame
  const matchRenderer: MatchRenderer = {
    Render: (scene3D, camera) => {
      const q = ConfiguredQuality();
      if (q !== quality) {
        quality = q;
        r.SetQuality(q);
      }
      r.Render(scene3D, camera);
    },
    Clear: () => r.Clear(),
  };
  // the app's own loading screens (quick match, career) show progress, so no overlay panel
  InstallMatchSessionRunner({ renderer: matchRenderer, showLoadingPanel: false });
  report?.({ status: 'Engine ready', fraction: 1 });
}
