// Port of legacy/src/onthepitch/player/controller/icontroller.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import type { Vector3 } from '../../../../blunted/base/math/vector3';
import { cround } from '../../../../blunted/base/math/bluntmath';
import type { PlayerCommandQueue } from '../../../gamedefines';
import type { Match } from '../../match';
import type { PlayerBase } from '../playerbase';

export abstract class IController {
  protected player!: PlayerBase;
  protected match: Match;

  protected fallbackController: IController | null = null;

  constructor(match: Match) {
    this.match = match;
  }

  abstract RequestCommand(commandQueue: PlayerCommandQueue): void;
  Process(): void {}
  abstract GetDirection(): Vector3;
  abstract GetFloatVelocity(): number;

  SetPlayer(player: PlayerBase): void {
    this.player = player;
  }

  // for convenience
  GetPlayer(): PlayerBase {
    return this.player;
  }

  GetMatch(): Match {
    return this.match;
  }

  GetReactionTime_ms(): number {
    return Math.trunc(cround(80.0 - this.player.GetStat('physical_reaction') * 40.0));
  }

  SetFallbackController(controller: IController | null): void {
    this.fallbackController = controller;
  }

  abstract Reset(): void;
}
