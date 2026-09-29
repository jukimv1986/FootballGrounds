// Career-specific stroke icons (24x24, currentColor), complementing src/ui/icons.ts.

const PATHS: Record<string, string> = {
  hub: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  training: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-7 8-7s7 2.5 8 7"/>',
  club: '<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>',
  city: '<path d="M3 21V9l6-3v15M9 21V4l6 3v14M15 21v-9l6 2v7M2 21h20"/><path d="M12 9h.01M12 12h.01M12 15h.01M6 12h.01M6 15h.01M18 16h.01"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.6 6.5-5.6s5.7 2 6.5 5.6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.6c2 .7 3.2 2.5 3.6 5.4"/>',
  inbox: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  finances: '<path d="M12 3v18M16.5 7.5c0-1.9-2-3-4.5-3s-4.5 1.2-4.5 3.2c0 4.6 9 2.6 9 7.3 0 2-2 3.3-4.5 3.3s-4.5-1.2-4.5-3.1"/>',
  career: '<path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 12h18M11 12v2h2v-2"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M7 21v-7h10v7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
  forward: '<path d="M5 18l7-6-7-6M12 18l7-6-7-6"/>',
  match: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2l3.3 2.4-1.3 3.9h-4l-1.3-3.9z"/>',
  energy: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  heart: '<path d="M12 20s-7.5-4.6-9-9.5C2 7 4.5 4.5 7.5 4.5c2 0 3.5 1.2 4.5 2.7 1-1.5 2.5-2.7 4.5-2.7 3 0 5.5 2.5 4.5 6-1.5 4.9-9 9.5-9 9.5z"/>',
  star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  car: '<path d="M5 17h14M4 13l2-5h12l2 5v5H4z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  play3d: '<path d="M7 4.5v15l12-7.5z"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  sim: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/><path d="M12 8v4l3 2"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  pin: '<path d="M12 21s-7-6.3-7-11.5A7 7 0 0 1 12 2.5a7 7 0 0 1 7 7C19 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  bandage: '<rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M10 10h.01M14 14h.01M12 12h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  whistle: '<circle cx="9" cy="14" r="5"/><path d="M12.5 10.5L21 6v4l-6.3 2.4"/>',
};

export function cicon(name: string, className = 'icon'): SVGSVGElement {
  const w = document.createElement('span');
  w.innerHTML = `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? PATHS.info}</svg>`;
  return w.firstElementChild as SVGSVGElement;
}
