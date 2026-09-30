// Career mode — the heart of the game: play the career of a footballer from a 15-year-old
// academy kid to retirement, on the pitch (3D "be a pro" matches or simulation) and off it
// (city life, training, relationships, money, media, contracts, national team).
//
// Module map:
//   core/      pure simulation (no DOM): world generation, calendar & competitions, match
//              simulation, coach AI, training & development, life (housing incl. mortgages,
//              family & children, friends, romance, money), events, contracts & agents, national
//              teams, seasons, milestones, retirement, save/load. Deterministic per career seed.
//   engine/    bridge to the 3D engine: DB registration, kit textures, PLAY flow.
//   ui/        DOM screens (router screens + in-shell tabs), styles in career.css.
//
// The main menu calls openCareerMenu().

import './career.css';

export { openCareerMenu } from './ui/screens/menu';
export { CareerApp } from './ui/app';
export { newCareer, advanceSlot, advanceDay, advanceToNextMatch } from './core/career';
export { autoPlay } from './core/autoplay';
