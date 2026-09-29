// Port of legacy/src/onthepitch/player/controller/refereecontroller.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../../../blunted/base/math/vector3';
import { clamp } from '../../../../blunted/base/math/bluntmath';
import {
  ForceSpot,
  PlayerCommand,
  distanceToVelocityMultiplier,
  e_DecayType,
  e_FunctionType,
  e_MagnetType,
  idleVelocity,
  pitchHalfH,
  sprintVelocity,
  type PlayerCommandQueue,
} from '../../../gamedefines';
import type { Match } from '../../match';
import type { Player } from '../player';
import { e_OfficialType, type PlayerOfficial } from '../playerofficial';
import { AI_GetForceFieldMovement, AI_GetOffsideLine } from '../../AIsupport/AIfunctions';
import { RangeVelocity } from '../humanoid/animcollection';
import { IController } from './icontroller';

export class RefereeController extends IController {
  constructor(match: Match) {
    super(match);
  }

  CastPlayer(): PlayerOfficial {
    return this.player as PlayerOfficial;
  }

  GetForceField(forceField: ForceSpot[]): void {
    {
      const forceSpot = new ForceSpot();
      forceSpot.origin = this.match.GetBall().GetAveragePosition(2000).Get2D().Mul(0.6);
      forceSpot.magnetType = e_MagnetType.e_MagnetType_Attract;
      forceSpot.decayType = e_DecayType.e_DecayType_Constant;
      forceSpot.power = 0.5;
      forceField.push(forceSpot);
    }

    {
      const forceSpot = new ForceSpot();
      forceSpot.origin = this.match.GetBall().Predict(200).Get2D();
      forceSpot.magnetType = e_MagnetType.e_MagnetType_Repel;
      forceSpot.decayType = e_DecayType.e_DecayType_Variable;
      forceSpot.power = 0.5;
      forceSpot.scale = 10.0;
      forceField.push(forceSpot);
    }

    const players: Player[] = [];
    this.match.GetActiveTeamPlayers(0, players); // todo: only closest players will do
    this.match.GetActiveTeamPlayers(1, players);
    for (let i = 0; i < players.length; i++) {
      const forceSpot = new ForceSpot();
      forceSpot.origin = players[i].GetPosition().Add(players[i].GetMovement().Mul(0.4));
      forceSpot.magnetType = e_MagnetType.e_MagnetType_Repel;
      forceSpot.decayType = e_DecayType.e_DecayType_Variable;
      forceSpot.power = 0.5;
      forceSpot.scale = 10.0;
      forceField.push(forceSpot);
    }
  }

  override RequestCommand(commandQueue: PlayerCommandQueue): void {
    const official = this.CastPlayer();

    switch (official.GetOfficialType()) {
      case e_OfficialType.e_OfficialType_Referee: {
        const referee = this.match.GetReferee();
        if (
          referee.GetBuffer().active === true &&
          (referee.GetCurrentFoulType() === 2 || referee.GetCurrentFoulType() === 3) &&
          referee.GetBuffer().prepareTime > this.match.GetActualTime_ms() + 5000
        ) {
          // FOUL, walk towards offender

          const foulPlayer = referee.GetCurrentFoulPlayer()!;
          const desiredPosition = foulPlayer.GetPosition().Add(official.GetPosition().Sub(foulPlayer.GetPosition()).GetNormalized(0).Mul(2.0));

          if (official.GetPosition().Sub(desiredPosition).GetLength() > 2.0) {
            const command = new PlayerCommand();
            command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
            command.useDesiredMovement = true;
            command.useDesiredLookAt = true;
            command.desiredDirection = desiredPosition.Sub(official.GetPosition()).GetNormalized(official.GetDirectionVec());
            command.desiredVelocityFloat = RangeVelocity(desiredPosition.Sub(official.GetPosition()).GetLength() * 1.0);
            command.desiredLookAt = foulPlayer.GetPosition();
            commandQueue.push(command);
          } else {
            {
              const command = new PlayerCommand();
              command.desiredFunctionType = e_FunctionType.e_FunctionType_Special;
              command.useDesiredMovement = false;
              command.useDesiredLookAt = false;
              command.useSpecialVar1 = true;
              command.specialVar1 = 3;
              commandQueue.push(command);
            }

            {
              const command = new PlayerCommand();
              command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
              command.useDesiredMovement = true;
              command.useDesiredLookAt = true;
              command.desiredDirection = desiredPosition.Sub(official.GetPosition()).GetNormalized(official.GetDirectionVec());
              command.desiredVelocityFloat = idleVelocity;
              command.desiredLookAt = foulPlayer.GetPosition();
              commandQueue.push(command);
            }
          }
        } else {
          // NORMAL

          const command = new PlayerCommand();
          command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
          command.useDesiredMovement = true;
          command.useDesiredLookAt = true;

          const forceField: ForceSpot[] = [];
          this.GetForceField(forceField);
          const desiredPosition = official.GetPosition().Add(AI_GetForceFieldMovement(forceField, official.GetPosition()));

          command.desiredDirection = desiredPosition.Sub(official.GetPosition()).GetNormalized(official.GetDirectionVec());
          command.desiredVelocityFloat = clamp(desiredPosition.Sub(official.GetPosition()).GetLength() * distanceToVelocityMultiplier * 0.5, idleVelocity, sprintVelocity); // take it easy, we are the ref
          command.desiredLookAt = this.match.GetBall().Predict(60).Get2D();

          commandQueue.push(command);
        }
        break;
      }

      case e_OfficialType.e_OfficialType_Linesman: {
        const command = new PlayerCommand();
        command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
        command.useDesiredMovement = true;
        command.useDesiredLookAt = true;

        let offside: number;
        let desiredPosition: Vector3;
        if (this.player.GetPosition().coords[1] < 0) {
          offside = AI_GetOffsideLine(this.match, this.match.GetMentalImage(0), 1);
          desiredPosition = new Vector3(offside, -(pitchHalfH + 0.8), 0);
        } else {
          offside = AI_GetOffsideLine(this.match, this.match.GetMentalImage(0), 0);
          desiredPosition = new Vector3(offside, pitchHalfH + 0.8, 0);
        }

        command.desiredDirection = desiredPosition.Sub(official.GetPosition()).GetNormalized(official.GetDirectionVec());
        command.desiredVelocityFloat = RangeVelocity(desiredPosition.Sub(official.GetPosition()).GetLength() * distanceToVelocityMultiplier);
        command.desiredLookAt = new Vector3(desiredPosition.coords[0], 0, 0);

        commandQueue.push(command);
        break;
      }
    }
  }

  override Process(): void {}

  override GetDirection(): Vector3 {
    return this.player.GetDirectionVec();
  }

  override GetFloatVelocity(): number {
    return this.player.GetFloatVelocity();
  }

  override GetReactionTime_ms(): number {
    return 60;
  }

  override Reset(): void {}
}
