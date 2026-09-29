// Port of legacy/src/onthepitch/player/controller/strategies/offtheball/default_def.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import type { Vector3 } from '../../../../../../blunted/base/math/vector3';
import { NormalizedClamp, clamp, curve } from '../../../../../../blunted/base/math/bluntmath';
import { distanceToVelocityMultiplier, sprintVelocity } from '../../../../../gamedefines';
import type { MentalImage } from '../../../../AIsupport/mentalimage';
import { AI_GetMindSet } from '../../../../AIsupport/AIfunctions';
import type { ElizaController } from '../../elizacontroller';
import { Strategy } from '../strategy';

export class DefaultDefenseStrategy extends Strategy {
  constructor(controller: ElizaController) {
    super(controller);
    this.name = 'default defense';
  }

  override RequestInput(mentalImage: MentalImage): { direction: Vector3; velocity: number } {
    const offensiveComponents = true;
    const defensiveComponents = true;
    const laziness = true;

    const player = this.player;
    const teamController = this.team.GetController();

    const desiredPosition_static = teamController.GetAdaptedFormationPosition(this.CastPlayer(), false);
    const desiredPosition_dynamic = teamController.GetAdaptedFormationPosition(this.CastPlayer(), true);
    const actionDistance = NormalizedClamp(player.GetPosition().GetDistance(this.match.GetDesignatedPossessionPlayer()!.GetPosition()), 15.0, 20.0);
    const staticPositionBias = curve(1.0 * actionDistance, 1.0); // lower values = swap position with other players' formation positions more easily
    let desiredPosition = desiredPosition_static.Mul(staticPositionBias).Add(desiredPosition_dynamic.Mul(1.0 - staticPositionBias));

    if (offensiveComponents) {
      // support position
      const attackBias = NormalizedClamp((this.controller.GetFadingTeamPossessionAmount() - 0.5) * 1.0, 0.2, 0.9);
      const supportPosition = this.controller.GetSupportPosition_ForceField(mentalImage, desiredPosition);
      desiredPosition = desiredPosition.Mul(1.0 - attackBias).Add(supportPosition.Mul(attackBias));
    }

    if (defensiveComponents) {
      const mindset = AI_GetMindSet(this.CastPlayer().GetDynamicFormationEntry().role);
      desiredPosition = this.controller.AddDefensiveComponent(desiredPosition, Math.pow(clamp(1.9 - mindset - this.controller.GetFadingTeamPossessionAmount(), 0.0, 1.0), 0.7));

      // offside trap (used to be applied before AddDefensiveComponent)
      desiredPosition = teamController.ApplyOffsideTrap(desiredPosition);
    }

    const direction = desiredPosition.Sub(player.GetPosition()).GetNormalized(player.GetDirectionVec());
    let desiredVelocity = desiredPosition.Sub(player.GetPosition()).GetLength() * distanceToVelocityMultiplier;

    // laziness
    if (laziness) desiredVelocity = this.controller.GetLazyVelocity(desiredVelocity);

    desiredVelocity = clamp(desiredVelocity, 0, sprintVelocity);

    return { direction, velocity: desiredVelocity };
  }
}
