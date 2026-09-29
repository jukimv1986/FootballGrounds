// Port of legacy/src/onthepitch/humangamer.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import type { IHIDevice } from '../hid/ihidevice';
import { HumanController } from './player/controller/humancontroller';
import type { Player } from './player/player';
import type { Team } from './team';

export enum e_PlayerColor {
  e_PlayerColor_Blue,
  e_PlayerColor_Green,
  e_PlayerColor_Red,
  e_PlayerColor_Yellow,
  e_PlayerColor_Purple,
  e_PlayerColor_Default,
}

export class HumanGamer {
  protected team: Team;
  protected hid: IHIDevice;
  protected controller: HumanController;

  protected playerColor: e_PlayerColor;
  protected selectedPlayer: Player | null;

  constructor(team: Team, hid: IHIDevice, color: e_PlayerColor) {
    this.team = team;
    this.hid = hid;
    this.playerColor = color;
    this.controller = new HumanController(team.GetMatch(), hid);

    const activePlayers: Player[] = [];
    team.GetActivePlayers(activePlayers);
    this.selectedPlayer = null;
    this.SetSelectedPlayerID(-1);
  }

  /** C++ destructor (Team calls this where the C++ deleted its human gamers) */
  Exit(): void {
    // todo: team is being destructed at this point, cannot use its methods
    if (this.selectedPlayer) {
      this.selectedPlayer.SetExternalController(null);
      this.selectedPlayer.SetDebug(false);
    }
  }

  GetSelectedPlayerID(): number {
    if (this.selectedPlayer) return this.selectedPlayer.GetID();
    else return -1;
  }

  GetSelectedPlayer(): Player | null {
    return this.selectedPlayer;
  }

  SetSelectedPlayerID(id: number): void {
    if (this.selectedPlayer) {
      if (this.selectedPlayer.GetID() === id) return;
      this.selectedPlayer.SetExternalController(null);
      this.selectedPlayer.SetDebug(false);
    }
    if (id !== -1) {
      this.selectedPlayer = this.team.GetPlayer(id)!;
      this.selectedPlayer.SetExternalController(this.controller);
      if (this.team.GetID() === 0) {
        this.selectedPlayer.SetDebug(true);
      }
    } else {
      this.selectedPlayer = null;
    }
  }

  GetHIDevice(): IHIDevice {
    return this.hid;
  }

  GetHumanController(): HumanController {
    return this.controller;
  }

  GetPlayerColor(): e_PlayerColor {
    return this.playerColor;
  }

  PreparePutBuffers(): void {}

  Put(): void {}
}
