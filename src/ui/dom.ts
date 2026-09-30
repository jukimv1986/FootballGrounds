// Tiny DOM helpers shared by all UI code (menus, career screens, HUD).

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  dataset?: Record<string, string>;
};

/** h('div', { class: 'card', onclick: () => … }, 'text', h('span', {}, 'child')) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'style') {
      if (typeof value === 'string') el.setAttribute('style', value);
      else Object.assign(el.style, value);
    } else if (key === 'dataset') Object.assign(el.dataset, value as Record<string, string>);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.substring(2).toLowerCase(), value as EventListener);
    else if (key in el && typeof value !== 'string') (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const generatedUrls = new Map<string, string>();

/**
 * Serves a generated image (e.g. a career-mode club crest, as a data: URL) under a data path, so
 * everything that shows images through dataUrl() — the in-match scoreboard too — finds it.
 */
export function registerGeneratedUrl(path: string, url: string | null): void {
  if (url) generatedUrls.set(path, url);
  else generatedUrls.delete(path);
}

/** URL of a file under public/data (or of a generated image registered under that path) */
export function dataUrl(path: string): string {
  const generated = generatedUrls.get(path);
  if (generated) return generated;
  return './data/' + path.split('/').map(encodeURIComponent).join('/');
}
