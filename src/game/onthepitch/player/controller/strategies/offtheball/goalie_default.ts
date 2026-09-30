// Port of legacy/src/onthepitch/player/controller/strategies/offtheball/goalie_default.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../../../../../blunted/base/math/vector3';
import { NormalizedClamp, clamp } from '../../../../../../blunted/base/math/bluntmath';
import { Line } from '../../../../../../blunted/base/geometry/line';
import { distanceToVelocityMultiplier, idleVelocity, pitchHalfH, pitchHalfW, sprintVelocity, walkVelocity } from '../../../../../gamedefines';
import type { MentalImage } from '../../../../AIsupport/mentalimage';
import { AI_GetClosestPlayer, AI_GetTimeNeededForDistance_ms } from '../../../../AIsupport/AIfunctions';
import type { Player } from '../../../player';
import type { ElizaController } from '../../elizacontroller';
import { Strategy } from '../strategy';

export function CalculateBestAchievableTarget(player: Player, pos1: Vector3, time1_sec: number, pos2: Vector3, time2_sec: number): Vector3 {
  const stepsPerMeter = 4.0;
  const stepSize = Math.fround(1.0 / clamp(pos1.GetDistance(pos2) * stepsPerMeter, 1.0, 20.0));

  // (C++ accumulates percentage in a float)
  for (let percentage = 0.0; percentage <= 1.0; percentage = Math.fround(percentage + stepSize)) {
    const checkPos = pos1.Add(pos2.Sub(pos1).Mul(percentage));
    const checkTime_sec = time1_sec + (time2_sec - time1_sec) * percentage;

    const maxTime_ms = -1;
    const timeNeeded_ms = AI_GetTimeNeededForDistance_ms(player.GetPosition(), player.GetMovement(), checkPos, player.GetMaxVelocity(), false /*precise*/, maxTime_ms, false /*debug*/).optimistic_ms;
    if (timeNeeded_ms * 0.001 <= checkTime_sec) {
      return checkPos;
    }
  }

  return pos2;
}

export class GoalieDefaultStrategy extends Strategy {
  protected ballBoundForGoal = false;
  protected ballBoundForGoal_ycoord = 0.0;

  constructor(controller: ElizaController) {
    super(controller);
    this.name = 'goalie default';
  }

  override RequestInput(mentalImage: MentalImage): { direction: Vector3; velocity: number } {
    const player = this.player;
    const team = this.team;
    const side = team.GetSide();

    // base position
    const lineDistance = 10.0; // default distance keeper stays in front of goal line
    const ballPos = mentalImage.GetBallPrediction(Math.trunc(600 + this.CastPlayer().GetTimeNeededToGetToBall_ms() * 0.2)).Get2D(); // todo: not sure if we should keep this to 'now' or more predictive
    let targetPos = new Vector3((pitchHalfW - lineDistance) * side, 0, 0);
    const goalPos = new Vector3(pitchHalfW * side, 0, 0);

    let maxVelocity = sprintVelocity;

    if (ballPos.coords[0] * side > 0) {
      // optimization

      this.CalculateIfBallIsBoundForGoal(mentalImage);

      if (!this.IsBallBoundForGoal()) {
        // tactical position, make goal as small as possible

        // todo: maybe in some situations, we should prefer walking as max velo, because then the correct body directino can be applied (walking backwards, for example), which are better for deflect anims
        maxVelocity = sprintVelocity;

        // first, make line from ballPos to one post, then one to the other post, then calculate the line in between.
        // this line is the line we want our goalie to be on: it splits the goal in to equal halves (in the 'ball view projection', that is)
        const toPost1 = new Vector3(pitchHalfW * side, 3.7, 0).Sub(ballPos);
        const toPost2 = new Vector3(pitchHalfW * side, -3.7, 0).Sub(ballPos);
        const angle = toPost2.GetAngle2D(toPost1);
        const middle = toPost1.GetRotated2D(angle * 0.5).GetNormalized(new Vector3(side, 0, 0));
        const ballToGoal = new Line();
        ballToGoal.SetVertex(0, ballPos);
        ballToGoal.SetVertex(1, ballPos.Add(middle));

        // this line is now arbitrary length - make it so long that v2 is on the backline
        // (or rather, near the backline - keeping ON the backline is dangerous; some anims may only touch the ball when it's already behind the line, which is pretty useless :p)
        const backLine = new Line();
        backLine.SetVertex(0, new Vector3((pitchHalfW - 0.7) * side, -pitchHalfH, 0));
        backLine.SetVertex(1, new Vector3((pitchHalfW - 0.7) * side, pitchHalfH, 0));
        let intersect = ballToGoal.GetIntersectionPoint(backLine).Get2D();
        intersect = intersect.WithCoord(1, clamp(intersect.coords[1], -3.7, 3.7));
        ballToGoal.SetVertex(1, intersect);

        let awayFromGoalOffset_m = 0.7; // meters away from goal line (over the ballToGoal line, not straight forward)
        let awayFromGoalBias = 0.3; // factor between goal and ball
        awayFromGoalBias *= NormalizedClamp(this.controller.GetFadingTeamPossessionAmount(), 1.0, 1.5);

        // when opponent comes rushing in and team mates are too far away to help, come out to 'reduce goal size'

        if (this.controller.GetFadingTeamPossessionAmount() < 1.0) {
          const opp = this.controller.GetOppTeam().GetDesignatedTeamPossessionPlayer();
          const oppPos = opp.GetPosition().Add(opp.GetMovement().Mul(0.32));

          // if opp isn't in ball control, don't use ball pos but opp pos
          if (opp.HasPossession() === false) {
            ballToGoal.SetVertex(0, oppPos.Mul(0.6).Add(ballPos.Mul(0.4)));
          } else {
            ballToGoal.SetVertex(0, oppPos.Mul(0.4).Add(ballPos.Mul(0.6)));
          }

          // first, calculate how close the opponent on the ball is to the goal/shooting treshold
          const shootThreshold = 20.0; // average/base value; this distance is dynamic
          const oppToGoalDistance = goalPos.Sub(oppPos).GetLength();
          const oppToThresholdDistance = clamp(oppToGoalDistance - shootThreshold * NormalizedClamp(oppToGoalDistance, 0.0, shootThreshold * 2.0), 0.0, pitchHalfW); // variable threshold distance
          const shootingPoint = oppPos.Add(goalPos.Sub(oppPos).GetNormalized(0).Mul(oppToThresholdDistance));

          // now calculate the distance between this shooting point and our closest mate
          const mate = AI_GetClosestPlayer(team, shootingPoint, false, this.CastPlayer());
          let mateToThresholdDistance = 99999;
          if (mate) {
            const matePos = mate.GetPosition().Add(mate.GetMovement().Mul(0.24));
            mateToThresholdDistance = shootingPoint.Sub(matePos).GetLength();
          }

          if (mateToThresholdDistance > oppToThresholdDistance + 1.0) {
            // come out, brave keeper!

            awayFromGoalBias = 1.0;

            // the amount of 'come out bias' is related to how dangerous the opponent's closest mate is if they are to receive the ball.
            // basically, the same as the above code, but with the secondary opponent and mate
            const oppHelper = AI_GetClosestPlayer(this.controller.GetOppTeam(), goalPos, false, opp);
            if (oppHelper) {
              const oppHelperPosition = oppHelper.GetPosition().Add(oppHelper.GetMovement().Mul(0.32));

              // first, calculate how close the opponent helper is to the goal/shooting treshold
              const helperShootThreshold = 24.0; // average/base value; this distance is dynamic
              const oppHelperToGoalDistance = goalPos.Sub(oppHelperPosition).GetLength();
              const oppHelperToThresholdDistance = clamp(
                oppHelperToGoalDistance - helperShootThreshold * NormalizedClamp(oppHelperToGoalDistance, 0.0, helperShootThreshold * 2.0),
                0.0,
                pitchHalfW,
              ); // variable threshold distance
              const helperShootingPoint = oppHelperPosition.Add(goalPos.Sub(oppHelperPosition).GetNormalized(0).Mul(oppHelperToThresholdDistance));

              // now calculate the distance between this shooting point and our closest mate
              const mateHelper = AI_GetClosestPlayer(team, helperShootingPoint, false, this.CastPlayer());
              let mateHelperToThresholdDistance = 99999;
              if (mateHelper) mateHelperToThresholdDistance = helperShootingPoint.Sub(mateHelper.GetPosition().Add(mateHelper.GetMovement().Mul(0.24))).GetLength();

              let secondaryDistanceDiff = 0.0;
              // if this var is bigger, LESS likely to come out because of secondary danger
              if (mateHelperToThresholdDistance > oppHelperToThresholdDistance) secondaryDistanceDiff = NormalizedClamp(mateHelperToThresholdDistance - oppHelperToThresholdDistance, 0.0, 2.0);

              // also take into account the ratio between the primary opp to goal and the helper opp to goal distance
              // if this var is bigger, LESS likely to come out because of secondary danger
              let helperVSPrimaryDistanceRatio = 1.0 - NormalizedClamp(oppHelperToThresholdDistance / (oppToThresholdDistance + 0.0001), 1.0, 1.5);
              helperVSPrimaryDistanceRatio *= 0.7; // always allow some coming out despite opp mate danger

              awayFromGoalBias = clamp(1.0 - secondaryDistanceDiff * helperVSPrimaryDistanceRatio, 0.0, 1.0);
            }
          }
        } // end keeper come out code

        const applyRushOut = team.GetController().GetEndApplyKeeperRush_ms() > this.match.GetActualTime_ms();
        if (applyRushOut) awayFromGoalBias = 1.0;

        const distance = Math.max(ballToGoal.GetLength() - 0.5, 0.0); // keep distance from target, we don't want to overshoot
        awayFromGoalOffset_m = clamp(distance * awayFromGoalBias, awayFromGoalOffset_m, pitchHalfW); // when ball is farther away, goalie stays farther away from goal (to make runs when necessary)

        // offset from goal line
        targetPos = ballToGoal.GetVertex(1).Add(ballToGoal.GetVertex(0).Sub(ballToGoal.GetVertex(1)).GetNormalized(0).Mul(awayFromGoalOffset_m));

        // when going back to goal: go slower to allow for proper body direction
        const { distance: distanceToBallToGoalLine, u } = ballToGoal.GetDistanceToPoint(player.GetPosition());
        if (targetPos.Sub(goalPos).GetLength() < player.GetPosition().Sub(goalPos).GetLength() && distanceToBallToGoalLine < 1.0 && u > 0.0) maxVelocity = walkVelocity;

        targetPos = targetPos.WithCoord(0, clamp(targetPos.coords[0], -pitchHalfW + 0.2, pitchHalfW - 0.2)); // not very useful to stand behind backline
      } else {
        // intercept ball
        // todo: doesn't yet walk backwards if ball is too high

        maxVelocity = sprintVelocity;

        const ballToGoal = new Line();
        ballToGoal.SetVertex(0, mentalImage.GetBallPrediction(10).Get2D());
        const minGoalLineDist = 0.4;
        let ballOverGoalLinePos = new Vector3(pitchHalfW * side, this.ballBoundForGoal_ycoord, 0);
        ballOverGoalLinePos = ballOverGoalLinePos.Add(ballToGoal.GetVertex(0).Sub(ballOverGoalLinePos).GetNormalized(0).Mul(minGoalLineDist));
        ballToGoal.SetVertex(1, ballOverGoalLinePos);
        let { u } = ballToGoal.GetDistanceToPoint(player.GetPosition().Add(player.GetMovement().Mul(0.05)));

        const { u: u_at_1sec } = ballToGoal.GetDistanceToPoint(mentalImage.GetBallPrediction(1010).Get2D());

        let should_gk_run_towards_the_goal = false;
        if (u_at_1sec > 1e-4) {
          const time_to_reach_gk = u / u_at_1sec;
          // (C++ converts the float time to unsigned int ms)
          const ball_position_at_gk = mentalImage.GetBallPrediction(Math.trunc(10 + 1000 * time_to_reach_gk));
          if (ball_position_at_gk.coords[2] > 2.5) {
            should_gk_run_towards_the_goal = true;
          }
        }

        u = clamp(u, 0.0, 1.0);

        if (should_gk_run_towards_the_goal) {
          targetPos = ballOverGoalLinePos;
        } else {
          targetPos = ballToGoal.GetVertex(0).Add(ballToGoal.GetVertex(1).Sub(ballToGoal.GetVertex(0)).Mul(u));
          targetPos = new Vector3(clamp(targetPos.coords[0], -pitchHalfW + 0.2, pitchHalfW - 0.2), targetPos.coords[1], 0.0); // not very useful to stand behind line
        }
      }
    }

    let direction = targetPos.Sub(player.GetPosition());
    const velocity = clamp(direction.GetLength() * distanceToVelocityMultiplier, idleVelocity, maxVelocity);
    direction = direction.GetNormalized(player.GetDirectionVec());
    return { direction, velocity };
  }

  CalculateIfBallIsBoundForGoal(mentalImage: MentalImage): void {
    this.ballBoundForGoal = false;
    let intersect = false;
    this.ballBoundForGoal_ycoord = 0;

    const side = this.team.GetSide();

    const panic = 1.02 + (1.0 - (this.CastPlayer().GetStat('mental_defensivepositioning') * 0.6 + this.CastPlayer().GetStat('mental_vision') * 0.4)) * 0.5;
    if (mentalImage.GetBallPrediction(4000).coords[0] * side > pitchHalfW && this.player.GetPosition().Sub(mentalImage.GetBallPrediction(250)).GetLength() < 32.0) {
      // only if ball is close enough (cpu optimization)

      // 2d version

      const ballToGoal = new Line();
      ballToGoal.SetVertex(0, mentalImage.GetBallPrediction(0).Get2D());
      ballToGoal.SetVertex(1, mentalImage.GetBallPrediction(800).Get2D());
      const goalLine = new Line();
      goalLine.SetVertex(0, new Vector3(pitchHalfW * side, -pitchHalfH, 0));
      goalLine.SetVertex(1, new Vector3(pitchHalfW * side, pitchHalfH, 0));

      const intersectPoint = ballToGoal.GetIntersectionPoint(goalLine).Get2D();
      if (Math.abs(intersectPoint.coords[1]) > 3.7 * panic) intersect = false;
      else intersect = true;

      if (intersect) {
        this.ballBoundForGoal_ycoord = intersectPoint.coords[1];
        this.ballBoundForGoal = true;
      }
    }
  }

  IsBallBoundForGoal(): boolean {
    return this.ballBoundForGoal;
  }
}
