// Screen management shared by menus and career mode.
//
// DOM layout (created by index.html):
//   <canvas id="game-canvas">  the Three.js match renderer (full screen, behind everything)
//   <div id="hud">             in-match overlays (Gui2 widgets: scoreboard, radar, captions)
//   <div id="app">             menu / career screens (hidden while a match is playing)

export interface Screen {
  /** root element of the screen */
  el: HTMLElement;
  /** called after the element is attached */
  onShow?(): void;
  /** called before the element is detached */
  onHide?(): void;
}

const stack: Screen[] = [];

function appRoot(): HTMLElement {
  let root = document.getElementById('app');
  if (!root) {
    root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
  }
  return root;
}

function mountTop(): void {
  const root = appRoot();
  root.replaceChildren();
  const top = stack[stack.length - 1];
  if (top) {
    root.appendChild(top.el);
    top.onShow?.();
  }
}

/** replaces the whole stack with this screen */
export function showScreen(screen: Screen): void {
  for (const s of stack) s.onHide?.();
  stack.length = 0;
  stack.push(screen);
  mountTop();
}

/** pushes a screen on top (back() returns to the previous one) */
export function pushScreen(screen: Screen): void {
  stack[stack.length - 1]?.onHide?.();
  stack.push(screen);
  mountTop();
}

/** pops the top screen */
export function back(): void {
  if (stack.length <= 1) return;
  stack.pop()?.onHide?.();
  mountTop();
}

/** hides the menu layer (while a match is running) */
export function setMenuLayerVisible(visible: boolean): void {
  appRoot().style.display = visible ? '' : 'none';
}
