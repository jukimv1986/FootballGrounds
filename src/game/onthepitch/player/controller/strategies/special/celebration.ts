// Port of legacy/src/onthepitch/player/controller/strategies/special/celebration.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import type { Vector3 } from '../../../../../../blunted/base/math/vector3';
import { e_Velocity } from '../../../../../gamedefines';
import type { MentalImage } from '../../../../AIsupport/mentalimage';
import type { ElizaController } from '../../elizacontroller';
import { Strategy } from '../strategy';

export class CelebrationStrategy extends Strategy {
  protected startTime_ms = 0;

  constructor(controller: ElizaController) {
    super(controller);
    this.name = 'celebration';
  }

  /**
   * C++ RequestInput(mentalImage, Vector3 &direction, e_Velocity &velocity).
   * PORT: in C++ this signature (e_Velocity &) did not override Strategy's (float &), so the class stayed abstract and was
   * never used; here it overrides it (e_Velocity is numeric).
   */
  override RequestInput(_mentalImage: MentalImage): { direction: Vector3; velocity: e_Velocity } {
    const direction = this.player.GetDirectionVec();
    const velocity = e_Velocity.e_Velocity_Idle;
    return { direction, velocity };
  }
}
