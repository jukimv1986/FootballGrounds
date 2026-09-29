// Port of menu/ingame/scoreboard.{hpp,cpp}.
// Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// PORT: the original composed the scoreboard from Gui2Image/Gui2Caption children on a
// background bitmap. Here it is a broadcast-style DOM bar (styled in src/ui/ingame.css): league
// logo, clock, both teams (color, logo, short name) around the score, and the TV logo on the right.
// Without a DOM (tests) it is inert.

import type { Vector3 } from '../../../blunted/base/math/vector3';
import type { Match } from '../../onthepitch/match';
import { GetDB } from '../../globals';
import { Gui2View, type Gui2WindowManager } from '../../ui/gui2';

const hasDOM = typeof document !== 'undefined';

/** data-root relative path -> url (see src/ui/dom.ts dataUrl) */
function dataUrl(path: string): string {
  return './data/' + path.split('/').map(encodeURIComponent).join('/');
}

function cssColor(c: Vector3 | undefined, fallback: string): string {
  if (!c) return fallback;
  return `rgb(${Math.round(c.coords[0])}, ${Math.round(c.coords[1])}, ${Math.round(c.coords[2])})`;
}

/** TeamData.GetLogoUrl() is "databases/default/..." like C++; accept a bare database path too */
function logoPath(url: string): string {
  if (!url) return '';
  return url.startsWith('databases/') || url.startsWith('media/') ? url : 'databases/default/' + url;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Gui2ScoreBoard extends Gui2View {
  protected match: Match;

  protected timeStr = '';
  protected goalCount: [number, number] = [0, 0];

  // PORT: plain DOM elements instead of Gui2Caption / Gui2Image children
  protected timeCaption: HTMLElement | null = null;
  protected teamNameCaption: (HTMLElement | null)[] = [null, null];
  protected goalCountCaption: (HTMLElement | null)[] = [null, null];
  protected leagueLogo: HTMLImageElement | null = null;
  protected teamLogo: (HTMLImageElement | null)[] = [null, null];
  protected tvLogo: HTMLImageElement | null = null;
  protected goalFlashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(windowManager: Gui2WindowManager, match: Match) {
    super(windowManager, 'scoreboard', 2, 2, 96, 4);
    this.match = match;

    if (hasDOM && this.element) {
      this.element.classList.add('gui2-scoreboard');

      const bar = el('div', 'sb-bar');

      this.leagueLogo = el('img', 'sb-league');
      this.leagueLogo.alt = '';
      this.leagueLogo.src = dataUrl(this.LeagueLogoPath());
      this.leagueLogo.addEventListener('error', () => this.leagueLogo?.remove(), { once: true });

      this.timeCaption = el('div', 'sb-clock', '0:00');

      const teams: HTMLElement[] = [];
      for (let teamID = 0; teamID < 2; teamID++) {
        const teamData = match.GetTeam(teamID).GetTeamData();
        const team = el('div', `sb-team sb-team--${teamID === 0 ? 'home' : 'away'}`);
        team.style.setProperty('--c1', cssColor(teamData.GetColor1(), teamID === 0 ? '#3ddc84' : '#5db2ff'));
        team.style.setProperty('--c2', cssColor(teamData.GetColor2(), '#ffffff'));
        const color = el('span', 'sb-color');
        const logo = el('img', 'sb-logo');
        logo.alt = '';
        const path = logoPath(teamData.GetLogoUrl());
        if (path) logo.src = dataUrl(path);
        logo.addEventListener('error', () => (logo.style.visibility = 'hidden'), { once: true });
        const name = el('span', 'sb-name', teamData.GetShortName());
        name.title = teamData.GetName();
        if (teamID === 0) team.append(color, logo, name);
        else team.append(name, logo, color);
        this.teamNameCaption[teamID] = name;
        this.teamLogo[teamID] = logo;
        teams.push(team);
      }

      const score = el('div', 'sb-score');
      this.goalCountCaption[0] = el('span', 'sb-goals', '0');
      this.goalCountCaption[1] = el('span', 'sb-goals', '0');
      score.append(this.goalCountCaption[0], el('span', 'sb-dash', '–'), this.goalCountCaption[1]);

      bar.append(this.leagueLogo, this.timeCaption, teams[0], score, teams[1]);

      this.tvLogo = el('img', 'sb-tv');
      this.tvLogo.alt = '';
      this.tvLogo.src = dataUrl('media/menu/tvlogo.png');

      this.element.append(bar, this.tvLogo);
    }

    this.SetGoalCount(0, 0);
    this.SetGoalCount(1, 0);

    this.Show();
  }

  /** PORT: C++ always showed media/menu/league.png ("todo: actual league picca"); use the teams' league when both play in it */
  protected LeagueLogoPath(): string {
    try {
      const db = GetDB();
      const names = [0, 1].map((t) => this.match.GetTeam(t).GetTeamData().GetName());
      const records = names.map((n) => db.teams.find((t) => t.name === n));
      if (records[0] && records[1] && records[0].league_id === records[1].league_id) {
        const league = db.leagues.find((l) => l.id === records[0]!.league_id);
        if (league?.logo_url) return 'databases/default/' + league.logo_url;
      }
    } catch {
      // no database (tests): fall through
    }
    return 'media/menu/league.png';
  }

  override Redraw(): void {}

  SetTimeStr(timeStr: string): void {
    if (timeStr === this.timeStr) return;
    this.timeStr = timeStr;
    if (this.timeCaption) this.timeCaption.textContent = timeStr;
  }

  SetGoalCount(teamID: number, goalCount: number): void {
    const previous = this.goalCount[teamID];
    this.goalCount[teamID] = goalCount;
    // PORT: C++ padded the count with a space for the fixed-width caption; the DOM centers it
    const caption = this.goalCountCaption[teamID];
    if (caption) caption.textContent = String(goalCount);
    if (goalCount > previous && this.element) {
      // goal: flash the score
      this.element.classList.remove('is-goal');
      void this.element.offsetWidth;
      this.element.classList.add('is-goal');
      this.element.dataset.goalTeam = String(teamID);
      if (this.goalFlashTimer) clearTimeout(this.goalFlashTimer);
      this.goalFlashTimer = setTimeout(() => this.element?.classList.remove('is-goal'), 3000);
    }
  }

  override Exit(): void {
    if (this.goalFlashTimer) clearTimeout(this.goalFlashTimer);
    this.goalFlashTimer = null;
    super.Exit();
  }
}
