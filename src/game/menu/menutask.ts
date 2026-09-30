// Replacement for menu/menutask: the part of the original menu task the match engine depends on
// (the queued fixture: match data, controller-to-side setup, kit selection, the GUI window manager).
// The actual menus are built in src/ui (DOM).

import type { MatchData } from '../data/matchdata';
import { Gui2WindowManager } from '../ui/gui2';

export interface SideSelection {
  controllerID: number;
  /** -1 (home / team 0), 0 (not playing), 1 (away / team 1) */
  side: number;
}

export class MenuTask {
  protected windowManager = new Gui2WindowManager();
  protected matchData: MatchData | null = null;
  protected sides: SideSelection[] = [];
  protected teamKitNum: [number, number] = [1, 2];

  GetWindowManager(): Gui2WindowManager {
    return this.windowManager;
  }

  SetMatchData(matchData: MatchData | null): void {
    this.matchData = matchData;
  }

  GetMatchData(): MatchData {
    if (!this.matchData) throw new Error('no match data queued');
    return this.matchData;
  }

  SetControllerSetup(sides: SideSelection[]): void {
    this.sides = sides.map((s) => ({ ...s }));
  }

  GetControllerSetup(): SideSelection[] {
    return this.sides.map((s) => ({ ...s }));
  }

  /** kit number (1 = home, 2 = away) per team slot */
  SetTeamKitNum(teamID: number, kitNum: number): void {
    this.teamKitNum[teamID] = kitNum;
  }

  GetTeamKitNum(teamID: number): number {
    return this.teamKitNum[teamID === 0 ? 0 : 1];
  }
}
