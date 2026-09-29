// Port of menu/ingame/tacticsdebug.{hpp,cpp}: a debug overlay showing, per tactics property,
// bars for the user value / auto value / live value of both teams.
// Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// PORT: drawn as small DOM bars instead of an Image2D; only created by Match in debug builds.

import type { Vector3 } from '../../../blunted/base/math/vector3';
import type { Match } from '../../onthepitch/match';
import { Gui2View, type Gui2WindowManager } from '../../ui/gui2';

const hasDOM = typeof document !== 'undefined';

export interface TacticsDebugEntry {
  caption: string;
  /** [type][teamid] */
  value: [[number, number], [number, number], [number, number]];
  color: [[Vector3, Vector3], [Vector3, Vector3], [Vector3, Vector3]];
}

function css(c: Vector3): string {
  return `rgb(${Math.round(c.coords[0])}, ${Math.round(c.coords[1])}, ${Math.round(c.coords[2])})`;
}

export class Gui2TacticsDebug extends Gui2View {
  protected match: Match;
  protected entries: TacticsDebugEntry[] = [];
  protected rows: HTMLElement[][][] = []; // [entry][type][teamid] bar elements
  protected _dirtycache = false;

  constructor(windowManager: Gui2WindowManager, name: string, x_percent: number, y_percent: number, width_percent: number, height_percent: number, match: Match) {
    super(windowManager, name, x_percent, y_percent, width_percent, height_percent);
    this.match = match;
    if (this.element) this.element.classList.add('gui2-tacticsdebug');
  }

  override Redraw(): void {
    if (!this._dirtycache) return;
    this.entries.forEach((entry, i) => {
      for (let type = 0; type < 3; type++) {
        for (let team = 0; team < 2; team++) {
          const bar = this.rows[i]?.[type]?.[team];
          if (bar) bar.style.width = `${Math.max(0, Math.min(1, entry.value[type][team])) * 100}%`;
        }
      }
    });
    this._dirtycache = false;
  }

  /** returns entries.size() after adding, like the C++ code */
  AddEntry(caption: string, color1: Vector3, color2: Vector3, color3: Vector3): number {
    const entry: TacticsDebugEntry = {
      caption,
      value: [
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      color: [
        [color1, color1],
        [color2, color2],
        [color3, color3],
      ],
    };
    this.entries.push(entry);

    if (hasDOM && this.element) {
      const row = document.createElement('div');
      row.className = 'td-row';
      const bars: HTMLElement[][] = [];
      const sides = [document.createElement('div'), document.createElement('div')];
      sides[0].className = 'td-side td-side--home';
      sides[1].className = 'td-side td-side--away';
      for (let type = 0; type < 3; type++) {
        bars[type] = [];
        for (let team = 0; team < 2; team++) {
          const track = document.createElement('div');
          track.className = 'td-track';
          const bar = document.createElement('div');
          bar.className = 'td-bar';
          bar.style.background = css(entry.color[type][team]);
          track.appendChild(bar);
          sides[team].appendChild(track);
          bars[type][team] = bar;
        }
      }
      const label = document.createElement('div');
      label.className = 'td-caption';
      label.textContent = caption;
      label.style.color = css(color3);
      row.append(sides[0], label, sides[1]);
      this.element.appendChild(row);
      this.rows.push(bars);
    }

    this._dirtycache = true;
    return this.entries.length;
  }

  SetValue(entryID: number, typeID: number, teamID: number, value: number): void {
    const entry = this.entries[entryID];
    if (!entry) return;
    if (entry.value[typeID][teamID] !== value) {
      entry.value[typeID][teamID] = value;
      this._dirtycache = true;
    }
  }
}
