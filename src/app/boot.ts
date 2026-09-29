// Runtime bootstrap, called by src/main.ts after the database, the configuration and the
// MenuTask are set up, before the title screen is shown.
//
// TODO(lead): wire controllers, audio, renderer, game loop and SetMatchSessionRunner
//   - UserEventManager.GetInstance().Attach(); SetControllers([new HIDKeyboard(), ...gamepads, touch])
//     and keep GetControllers() updated on gamepadconnected / gamepaddisconnected
//     (the controller select screen re-reads GetControllers() on those events)
//   - audio (respect GetConfiguration() "audio_volume"), unlocked on the first user gesture
//   - the Three.js renderer on #game-canvas (GetConfiguration() "graphics_quality": low/medium/high)
//   - the game loop (src/game/gameloop.ts)
//   - SetMatchSessionRunner(...) from src/app/matchsessionrunner.ts; while a match runs the runner
//     (or the quick match flow, which does it when onLoadProgress reports 1) hides the menu layer
//     with setMenuLayerVisible(false) from src/ui/router.ts
// Until then StartMatchSession() rejects with "match engine not available" and the menus say so.

export interface BootProgress {
  /** status text for the boot splash */
  status?: string;
  /** 0 .. 1 */
  fraction?: number;
}

export async function bootRuntime(report?: (progress: BootProgress) => void): Promise<void> {
  report?.({ status: 'Starting engine' });
}
