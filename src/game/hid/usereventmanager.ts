// Replacement for managers/usereventmanager (SDL keyboard state). Key identifiers are
// KeyboardEvent.code strings; the SDLK_* constants below map the ones the game uses.

export const SDLK_UP = 'ArrowUp';
export const SDLK_RIGHT = 'ArrowRight';
export const SDLK_DOWN = 'ArrowDown';
export const SDLK_LEFT = 'ArrowLeft';
export const SDLK_RETURN = 'Enter';
export const SDLK_ESCAPE = 'Escape';
export const SDLK_BACKSPACE = 'Backspace';
export const SDLK_SPACE = 'Space';
export const SDLK_F1 = 'F1';
export const SDLK_F2 = 'F2';
export const SDLK_F3 = 'F3';
export const SDLK_F4 = 'F4';
export const SDLK_w = 'KeyW';
export const SDLK_a = 'KeyA';
export const SDLK_s = 'KeyS';
export const SDLK_d = 'KeyD';
export const SDLK_q = 'KeyQ';
export const SDLK_e = 'KeyE';
export const SDLK_z = 'KeyZ';
export const SDLK_c = 'KeyC';

export type SDL_Keycode = string;

export class UserEventManager {
  private static instance: UserEventManager | null = null;
  protected keys = new Set<string>();
  protected attached = false;

  static GetInstance(): UserEventManager {
    if (!UserEventManager.instance) UserEventManager.instance = new UserEventManager();
    return UserEventManager.instance;
  }

  /** starts listening to the window's keyboard events (browser only) */
  Attach(target: Window = window): void {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener('keydown', (e) => this.keys.add(e.code));
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  GetKeyboardState(key: SDL_Keycode): boolean {
    return this.keys.has(key);
  }

  SetKeyboardState(key: SDL_Keycode, state: boolean): void {
    if (state) this.keys.add(key);
    else this.keys.delete(key);
  }
}
