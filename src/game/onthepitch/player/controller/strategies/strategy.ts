// Port of legacy/src/onthepitch/player/controller/strategies/strategy.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import type { Vector3 } from '../../../../../blunted/base/math/vector3';
import type { MentalImage } from '../../../AIsupport/mentalimage';
import type { Match } from '../../../match';
import type { Team } from '../../../team';
import type { Player } from '../../player';
import type { PlayerBase } from '../../playerbase';
import type { ElizaController } from '../elizacontroller';

export abstract class Strategy {
  protected controller: ElizaController;

  protected name = '';

  // for convenience
  protected player: PlayerBase;
  protected team: Team;
  protected match: Match;

  constructor(controller: ElizaController) {
    this.controller = controller;
    this.player = controller.GetPlayer();
    this.team = controller.GetTeam();
    this.match = controller.GetMatch();
  }

  CastPlayer(): Player {
    return this.player as Player;
  }

  /** C++ RequestInput(mentalImage, Vector3 &direction, float &velocity): the out-params are returned */
  abstract RequestInput(mentalImage: MentalImage): { direction: Vector3; velocity: number };

  GetName(): string {
    return this.name;
  }
}
