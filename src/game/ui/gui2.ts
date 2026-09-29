// Replacement for the original Gui2 widget toolkit (utils/gui2), used by the match for in-game
// overlays. Views are positioned in percentages of the screen like the original; in the browser
// they render as absolutely positioned DOM elements inside the #hud layer. Without a DOM (tests)
// they are inert.

import type { Vector3 } from '../../blunted/base/math/vector3';

const hasDOM = typeof document !== 'undefined';

function rgb(color: Vector3, alpha = 1): string {
  return `rgba(${Math.round(color.coords[0])}, ${Math.round(color.coords[1])}, ${Math.round(color.coords[2])}, ${alpha})`;
}

export class Gui2WindowManager {
  protected root: Gui2Root;
  protected container: HTMLElement | null = null;

  constructor() {
    if (hasDOM) {
      this.container = document.getElementById('hud');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'hud';
        document.body.appendChild(this.container);
      }
    }
    this.root = new Gui2Root(this);
  }

  GetRoot(): Gui2Root {
    return this.root;
  }

  GetContainer(): HTMLElement | null {
    return this.container;
  }

  GetAspectRatio(): number {
    if (!hasDOM) return 16 / 9;
    return window.innerWidth / Math.max(1, window.innerHeight);
  }

  /** C++ GetCoordinates(x%, y%, w%, h%, int &x, int &y, int &w, int &h): percent -> pixels */
  GetCoordinates(x_percent: number, y_percent: number, width_percent: number, height_percent: number): { x: number; y: number; w: number; h: number } {
    const W = hasDOM ? window.innerWidth : 1280;
    const H = hasDOM ? window.innerHeight : 720;
    return { x: (x_percent / 100) * W, y: (y_percent / 100) * H, w: (width_percent / 100) * W, h: (height_percent / 100) * H };
  }

  /** removes every in-game view (end of match) */
  Clear(): void {
    this.root.RemoveAllChildren();
    if (this.container) this.container.innerHTML = '';
  }
}

export class Gui2View {
  protected children: Gui2View[] = [];
  protected parent: Gui2View | null = null;
  protected isVisible = false;
  protected element: HTMLElement | null = null;

  constructor(
    protected windowManager: Gui2WindowManager,
    protected name: string,
    protected x_percent: number,
    protected y_percent: number,
    protected width_percent: number,
    protected height_percent: number,
  ) {
    if (hasDOM) {
      this.element = document.createElement('div');
      this.element.className = 'gui2-view';
      this.element.dataset.name = name;
      this.element.style.position = 'absolute';
      this.element.style.display = 'none';
      this.ApplyLayout();
    }
  }

  protected ApplyLayout(): void {
    if (!this.element) return;
    this.element.style.left = `${this.x_percent}%`;
    this.element.style.top = `${this.y_percent}%`;
    this.element.style.width = `${this.width_percent}%`;
    this.element.style.height = `${this.height_percent}%`;
  }

  GetName(): string {
    return this.name;
  }

  GetElement(): HTMLElement | null {
    return this.element;
  }

  AddView(view: Gui2View): void {
    this.children.push(view);
    view.parent = this;
    if (this.element && view.element) this.element.appendChild(view.element);
  }

  RemoveView(view: Gui2View): void {
    const i = this.children.indexOf(view);
    if (i >= 0) this.children.splice(i, 1);
    view.parent = null;
    view.element?.remove();
  }

  RemoveAllChildren(): void {
    for (const c of [...this.children]) this.RemoveView(c);
  }

  GetParent(): Gui2View | null {
    return this.parent;
  }

  SetPosition(x_percent: number, y_percent: number): void {
    this.x_percent = x_percent;
    this.y_percent = y_percent;
    if (this.element) {
      this.element.style.left = `${x_percent}%`;
      this.element.style.top = `${y_percent}%`;
    }
  }

  SetSize(width_percent: number, height_percent: number): void {
    this.width_percent = width_percent;
    this.height_percent = height_percent;
    this.ApplyLayout();
  }

  /** C++ GetSize(float &w, float &h) */
  GetSize(): { width_percent: number; height_percent: number } {
    return { width_percent: this.width_percent, height_percent: this.height_percent };
  }

  /** C++ GetPosition(float &x, float &y) */
  GetPosition(): { x_percent: number; y_percent: number } {
    return { x_percent: this.x_percent, y_percent: this.y_percent };
  }

  SetZPriority(prio: number): void {
    if (this.element) this.element.style.zIndex = String(prio);
  }

  Show(): void {
    this.isVisible = true;
    if (this.element) this.element.style.display = '';
  }

  Hide(): void {
    this.isVisible = false;
    if (this.element) this.element.style.display = 'none';
  }

  IsVisible(): boolean {
    return this.isVisible && (this.parent ? this.parent.IsVisible() : true);
  }

  Process(): void {}

  Redraw(): void {}

  Exit(): void {
    for (const c of [...this.children]) c.Exit();
    this.children = [];
    if (this.parent) this.parent.RemoveView(this);
    this.element?.remove();
  }
}

export class Gui2Root extends Gui2View {
  constructor(windowManager: Gui2WindowManager) {
    super(windowManager, 'root', 0, 0, 100, 100);
    if (this.element) {
      this.element.style.display = '';
      this.element.style.pointerEvents = 'none';
      windowManager.GetContainer()?.appendChild(this.element);
    }
    this.isVisible = true;
  }

  override IsVisible(): boolean {
    return true;
  }
}

export class Gui2Caption extends Gui2View {
  protected caption: string;
  protected transparency = 0;

  constructor(windowManager: Gui2WindowManager, name: string, x_percent: number, y_percent: number, width_percent: number, height_percent: number, caption: string) {
    super(windowManager, name, x_percent, y_percent, width_percent, height_percent);
    this.caption = caption;
    if (this.element) {
      this.element.classList.add('gui2-caption');
      this.element.style.width = 'auto';
      this.element.style.whiteSpace = 'nowrap';
      this.element.style.fontSize = `${height_percent * 0.75}vh`;
      this.element.style.lineHeight = `${height_percent}vh`;
      this.element.textContent = caption;
    }
  }

  SetColor(color: Vector3): void {
    if (this.element) this.element.style.color = rgb(color, 1 - this.transparency);
  }

  SetOutlineColor(outlineColor: Vector3): void {
    if (this.element) {
      const c = rgb(outlineColor);
      this.element.style.textShadow = `-1px -1px 0 ${c}, 1px -1px 0 ${c}, -1px 1px 0 ${c}, 1px 1px 0 ${c}`;
    }
  }

  SetTransparency(trans: number): void {
    this.transparency = trans;
    if (this.element) this.element.style.opacity = String(1 - trans);
  }

  SetCaption(newCaption: string): void {
    if (newCaption === this.caption) return;
    this.caption = newCaption;
    if (this.element) this.element.textContent = newCaption;
  }

  GetCaption(): string {
    return this.caption;
  }

  /** width of the rendered text in screen percent */
  GetTextWidthPercent(subStrLength?: number): number {
    const text = subStrLength === undefined ? this.caption : this.caption.substring(0, subStrLength);
    // approximation: average glyph is ~0.5em wide; font size is 0.75 * height (in vh)
    const aspect = this.windowManager.GetAspectRatio();
    return (text.length * 0.5 * this.height_percent * 0.75) / aspect;
  }

  override GetSize(): { width_percent: number; height_percent: number } {
    return { width_percent: this.GetTextWidthPercent(), height_percent: this.height_percent };
  }
}

export class Gui2Image extends Gui2View {
  constructor(windowManager: Gui2WindowManager, name: string, x_percent: number, y_percent: number, width_percent: number, height_percent: number) {
    super(windowManager, name, x_percent, y_percent, width_percent, height_percent);
    if (this.element) this.element.classList.add('gui2-image');
  }

  /** path relative to the data root, e.g. "media/menu/radar/ball.png" */
  LoadImage(filename: string): void {
    if (this.element) {
      this.element.style.backgroundImage = `url("./data/${filename}")`;
      this.element.style.backgroundSize = '100% 100%';
    }
  }
}
