// Port of legacy/src/onthepitch/teamAIcontroller.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../blunted/base/math/vector3';
import { NormalizedClamp, clamp, cround, curve, pi, random } from '../../blunted/base/math/bluntmath';
import { Line } from '../../blunted/base/geometry/line';
import { Properties } from '../../blunted/base/properties';
import { assert } from '../../blunted/base/assert';
import { atof } from '../../blunted/base/utils';
import { e_PlayerRole, e_SetPiece, pitchHalfH, pitchHalfW, type FormationEntry } from '../gamedefines';
import { Verbose } from '../globals';
import { AI_GetAdaptedFormationPosition, AI_GetClosestPlayer, AI_GetClosestPlayers, AI_GetMindSet, AI_GetOffsideLine } from './AIsupport/AIfunctions';
import {
  HUNGARIAN_ASSIGNED,
  HUNGARIAN_MODE_MINIMIZE_COST,
  array_to_matrix,
  hungarian_free,
  hungarian_init,
  hungarian_problem_t,
  hungarian_solve,
} from '../misc/hungarian';
import type { Match } from './match';
import type { Team } from './team';
import type { Player } from './player/player';

export class TacticalOpponentInfo {
  constructor(
    public player: Player,
    public dangerFactor: number,
  ) {}
}

/** declared (but never defined) in the original header; ascending dangerFactor */
export function SortTacticalOpponentInfo(a: TacticalOpponentInfo, b: TacticalOpponentInfo): boolean {
  return a.dangerFactor < b.dangerFactor;
}

export function ReverseSortTacticalOpponentInfo(a: TacticalOpponentInfo, b: TacticalOpponentInfo): boolean {
  return a.dangerFactor > b.dangerFactor;
}

export function SelectAttackingRunPlayer(team: Team): Player | null {
  const possessionPlayer = team.GetDesignatedTeamPossessionPlayer();

  const offenseFocusPos = possessionPlayer.GetPosition().Add(new Vector3(-team.GetSide() * 26.0, 0, 0));

  const attackingRunPlayer = AI_GetClosestPlayer(team, offenseFocusPos, true, possessionPlayer);
  return attackingRunPlayer;
}

export function mixup(base: number, varname: string, role: e_PlayerRole): number {
  let value = -100.0;

  if (role === e_PlayerRole.e_PlayerRole_CB) {
    if (varname === 'position_offense_width_factor') value = 0.2; // wider defense
  }

  if (role === e_PlayerRole.e_PlayerRole_LB || role === e_PlayerRole.e_PlayerRole_RB) {
    if (varname === 'position_defense_ownhalf_factor') value = -0.075; // go forward
    if (varname === 'position_offense_width_factor') value = 0.2; // wider defense
    if (varname === 'position_offense_ownhalf_factor') value = -0.1; // go forward
  }

  if (role === e_PlayerRole.e_PlayerRole_LM || role === e_PlayerRole.e_PlayerRole_RM) {
    // wingers stay high up to offer counter-attack support
    if (varname === 'position_defense_ownhalf_factor') value = -0.05;
    if (varname === 'position_offense_ownhalf_factor') value = -0.1; // go forward
  }

  if (role === e_PlayerRole.e_PlayerRole_AM) {
    // attackers stay high up to offer counter-attack support
    if (varname === 'position_defense_depth_factor') value = 0.125;
  }

  if (role === e_PlayerRole.e_PlayerRole_CF) {
    // strikers stay high up to offer counter-attack support
    if (varname === 'position_defense_depth_factor') value = 0.125;
  }

  if (value > -100.0) {
    // offset version
    return clamp(base + value, 0.0, 1.0);
  } else {
    return base;
  }
}

// PORT: indices into the numeric cache of liveTeamTactics (see TeamAIController.liveTacticsValues)
const TACTICS_NAMES = [
  'position_offense_depth_factor',
  'position_defense_depth_factor',
  'position_offense_width_factor',
  'position_defense_width_factor',
  'position_offense_ownhalf_factor',
  'position_defense_ownhalf_factor',
  'position_offense_midfieldfocus',
  'position_defense_midfieldfocus',
  'position_offense_midfieldfocus_strength',
  'position_defense_midfieldfocus_strength',
  'position_offense_sidefocus_strength',
  'position_defense_sidefocus_strength',
  'position_offense_microfocus_strength',
  'position_defense_microfocus_strength',
] as const;

export class TeamAIController {
  protected match: Match;
  protected team: Team;
  protected taker: Player | null = null;
  protected setPieceType = e_SetPiece.e_SetPiece_None;

  protected baseTeamTactics = new Properties();
  protected teamTacticsModMultipliers = new Properties();
  protected liveTeamTactics = new Properties();
  /** PORT: liveTeamTactics.GetReal(TACTICS_NAMES[i]), cached by UpdateTactics (performance only) */
  protected liveTacticsValues: number[] = [];

  protected offensivenessBias = 0.5;

  protected teamHasPossession = false;
  protected teamHasUniquePossession = false;
  protected oppTeamHasPossession = false;
  protected oppTeamHasUniquePossession = false;
  protected teamHasBestPossession = false;
  protected teamPossessionAmount = 1.0;
  protected fadingTeamPossessionAmount = 1.0;
  protected timeNeededToGetToBall = 100;
  protected oppTimeNeededToGetToBall = 100;

  protected depth: number;
  protected width: number;

  protected offsideTrapX: number;

  protected endApplyAttackingRun_ms: number;
  protected attackingRunPlayer: Player | null;
  protected endApplyTeamPressure_ms: number;
  protected teamPressurePlayer: Player | null;
  protected endApplyKeeperRush_ms: number;

  /** sort of like the attacking run player, but more for a forward offset for a player close to the action, to support the player in possession */
  protected forwardSupportPlayer: Player | null;

  protected tacticalOpponentInfo: TacticalOpponentInfo[] = [];

  constructor(team: Team) {
    this.team = team;
    this.match = team.GetMatch();
    this.taker = null;

    this.depth = 0.45;
    this.width = 0.95;

    this.setPieceType = e_SetPiece.e_SetPiece_None;

    this.offsideTrapX = 0;

    this.endApplyAttackingRun_ms = 0;
    this.attackingRunPlayer = null;
    this.endApplyTeamPressure_ms = 0;
    this.teamPressurePlayer = null;
    this.endApplyKeeperRush_ms = 0;
    this.forwardSupportPlayer = null;

    this.baseTeamTactics.Set('position_offense_depth_factor', 0.9);
    this.baseTeamTactics.Set('position_defense_depth_factor', 0.75);
    this.baseTeamTactics.Set('position_offense_width_factor', 0.9);
    this.baseTeamTactics.Set('position_defense_width_factor', 0.8);
    this.baseTeamTactics.Set('position_offense_ownhalf_factor', 0.52);
    this.baseTeamTactics.Set('position_defense_ownhalf_factor', 0.54);
    this.baseTeamTactics.Set('position_offense_midfieldfocus', 0.6);
    this.baseTeamTactics.Set('position_defense_midfieldfocus', 0.5);
    this.baseTeamTactics.Set('position_offense_midfieldfocus_strength', 0.35);
    this.baseTeamTactics.Set('position_defense_midfieldfocus_strength', 0.35);
    this.baseTeamTactics.Set('position_offense_sidefocus_strength', 0.1); // take possession factor more seriously (high) or ball position (low)
    this.baseTeamTactics.Set('position_defense_sidefocus_strength', 0.4);
    this.baseTeamTactics.Set('position_offense_microfocus_strength', 0.7);
    this.baseTeamTactics.Set('position_defense_microfocus_strength', 0.8);

    // how much [-1 * this value .. +1 * this value] offset we can add to the above tactics.
    this.teamTacticsModMultipliers.Set('position_offense_depth_factor', 0.1);
    this.teamTacticsModMultipliers.Set('position_defense_depth_factor', 0.1);
    this.teamTacticsModMultipliers.Set('position_offense_width_factor', 0.1);
    this.teamTacticsModMultipliers.Set('position_defense_width_factor', 0.1);
    this.teamTacticsModMultipliers.Set('position_offense_midfieldfocus', 0.3);
    this.teamTacticsModMultipliers.Set('position_defense_midfieldfocus', 0.3);
    this.teamTacticsModMultipliers.Set('position_offense_sidefocus_strength', 0.1);
    this.teamTacticsModMultipliers.Set('position_defense_sidefocus_strength', 0.1);
    this.teamTacticsModMultipliers.Set('position_offense_microfocus_strength', 0.15);
    this.teamTacticsModMultipliers.Set('position_defense_microfocus_strength', 0.15);

    this.offensivenessBias = 0.5;

    this.UpdateTactics();
  }

  Process(): void {
    const match = this.match;
    const team = this.team;
    const side = team.GetSide();
    const oppTeam = match.GetTeam(Math.abs(team.GetID() - 1));
    const ball = match.GetBall();

    if (match.GetActualTime_ms() % 1000 === 0) this.UpdateTactics();

    this.CalculateSituation();

    const startDistance = 30.0 + 20.0 * this.offensivenessBias; // distance from goal where we start holding the opponents (but are likely to fallback somewhat)
    const forceDistance = 6.0; // minimum distance from goal - try to 'hold' the opp there

    let deepestDanger = (pitchHalfW - startDistance) * side;

    // ball as max
    let adaptedBallX = ball.Predict(0).coords[0];
    // when far away from our goal (startDistance), drop back more easily. closer to forceDistance, don't buckle.
    adaptedBallX *= side; // > 0 == on our half (easier to work with)
    const offsetX = 20.0 + 10.0 * (1.0 - this.offensivenessBias); // when ball is this distance away from startDistance, we start falling back more towards forceDistance.
    const startToForcedBias = NormalizedClamp(adaptedBallX, pitchHalfW - startDistance - offsetX, pitchHalfW - forceDistance); // where, between startDistance and forceDistance, is the ball? 0 .. 1
    adaptedBallX += offsetX * (1.0 - startToForcedBias); // the fall back intensity gradually diminishes when getting closer to forceDistance
    adaptedBallX *= side; // back to absolute space
    if (adaptedBallX * side > deepestDanger * side) deepestDanger = adaptedBallX;

    // ballfuture as max
    const ballFutureX = ball.Predict(700).coords[0];
    if (ballFutureX * side > deepestDanger * side) deepestDanger = ballFutureX;

    // opp as max
    const opp = oppTeam.GetDesignatedTeamPossessionPlayer();
    const cautionDistance = 4.0 * side;
    const oppPos = opp.GetPosition();
    const oppMov = opp.GetMovement();
    if ((oppPos.coords[0] + oppMov.coords[0] * 0.15 + cautionDistance) * side > deepestDanger * side) deepestDanger = oppPos.coords[0] + oppMov.coords[0] * 0.1 + cautionDistance;

    // slacking teammate as max
    const lineX = AI_GetOffsideLine(match, match.GetMentalImage(0), Math.abs(team.GetID()));
    const allowSlackDistance = 4.0; // despite teammates slacking behind line this much, just hold the line
    if (lineX * side - allowSlackDistance > deepestDanger * side) {
      deepestDanger = lineX - allowSlackDistance * side;
    }

    this.offsideTrapX = deepestDanger;

    // calculate who's dangerous

    const players: Player[] = [];
    match.GetActiveTeamPlayers(Math.abs(team.GetID() - 1), players);

    let mostDangerousPos = new Vector3((pitchHalfW - 2.0) * side, 0, 0);
    mostDangerousPos = mostDangerousPos.Mul(0.8).Add(ball.Predict(100).Get2D().Mul(0.2));

    this.tacticalOpponentInfo = [];

    const oppDesignatedPlayer = oppTeam.GetDesignatedTeamPossessionPlayer();
    for (let i = 0; i < players.length; i++) {
      let dangerFactor = 1.0 - NormalizedClamp(players[i].GetPosition().Sub(mostDangerousPos).GetLength(), 0, pitchHalfW * 2);

      // player on ball is most dangerous
      dangerFactor *= 0.95;
      if (players[i] === oppDesignatedPlayer) dangerFactor += 0.05;

      this.tacticalOpponentInfo.push(new TacticalOpponentInfo(players[i], dangerFactor));
    }

    // sort list
    this.tacticalOpponentInfo.sort((a, b) => (ReverseSortTacticalOpponentInfo(a, b) ? -1 : ReverseSortTacticalOpponentInfo(b, a) ? 1 : 0));

    // team pressure
    // (disabled in the original: interferes with other defense AI code for now)

    // trigger attacking runs

    if (match.GetActualTime_ms() % 500 === 0 && this.endApplyAttackingRun_ms <= match.GetActualTime_ms()) {
      if (team.GetHumanGamerCount() < 2) {
        // with >= 2 human players, one can do the running manually
        if (match.GetBestPossessionTeamID() === team.GetID()) {
          const neededRating = 0.5;

          // from a certain distance, running is not very useful (can't pass that far)
          const runner = SelectAttackingRunPlayer(team);
          if (runner) {
            const distance = runner.GetPosition().Sub(team.GetDesignatedTeamPossessionPlayer().GetPosition()).GetLength();
            const distanceRating = Math.pow(1.0 - NormalizedClamp(distance, 0, 40), 0.5);

            // more likely to run when there's less defenders in front
            const opponents: Player[] = [];
            const spot = runner
              .GetPosition()
              .Mul(new Vector3(1.0, 0.8, 0.0))
              .Add(new Vector3(side * 10.0, 0, 0));
            AI_GetClosestPlayers(team.GetMatch().GetTeam(Math.abs(team.GetID() - 1)), spot, false, opponents, 4);
            let oppDensityRating = 1.0;
            for (let i = 0; i < opponents.length; i++) {
              const oppDistance = opponents[i].GetPosition().Sub(spot).GetLength();
              const oppDistanceRatingInv = Math.pow(curve(1.0 - NormalizedClamp(oppDistance, 0, 15), 1.0), 0.5);
              oppDensityRating -= oppDistanceRatingInv * 0.3; // subtractive!
            }

            const runConditionsRating = distanceRating * oppDensityRating;

            if (runConditionsRating >= neededRating) {
              this.ApplyAttackingRun();
              if (Verbose()) console.debug('!!! tactics induced run !!!');
            }
          }
        }
      }
    }

    if (match.GetActualTime_ms() % 1500 === 0) {
      const designated = team.GetDesignatedTeamPossessionPlayer();
      this.forwardSupportPlayer = AI_GetClosestPlayer(
        team,
        designated
          .GetPosition()
          .Mul(new Vector3(1.0, 1.0, 0.0))
          .Add(new Vector3(-side * 1.5, 0, 0)),
        false,
        designated,
      );
    }
  }

  GetAdaptedFormationPosition(player: Player, useDynamicFormationPosition = true): Vector3 {
    const match = this.match;
    const team = this.team;
    const side = team.GetSide();
    const ball = match.GetBall();

    const toggle_yFocus = true;
    const toggle_microFocus = true;
    const toggle_midfieldFocus = true;

    let role: e_PlayerRole;
    if (useDynamicFormationPosition) role = player.GetDynamicFormationEntry().role;
    else role = player.GetFormationEntry().role;

    let focalPoint = match.GetDesignatedPossessionPlayer().GetPosition();
    const urgencyBias = 1.0 - NormalizedClamp(focalPoint.Sub(player.GetPosition()).GetLength(), 2.0, 30.0);
    // C++ passed these float expressions to an unsigned int parameter (truncation)
    const ballX = ball.GetAveragePosition(Math.trunc(3500 * (1.0 - urgencyBias * 0.7))).coords[0];
    const ballY = ball.GetAveragePosition(Math.trunc(4000 * (1.0 - urgencyBias * 0.5))).coords[1];

    const t = this.liveTacticsValues;
    const offense_depthFactor = mixup(t[0], TACTICS_NAMES[0], role);
    const defense_depthFactor = mixup(t[1], TACTICS_NAMES[1], role);
    const offense_widthFactor = mixup(t[2], TACTICS_NAMES[2], role);
    const defense_widthFactor = mixup(t[3], TACTICS_NAMES[3], role);
    const offense_ownHalfFactor = mixup(t[4], TACTICS_NAMES[4], role);
    const defense_ownHalfFactor = mixup(t[5], TACTICS_NAMES[5], role);
    const offense_midfieldFocus = mixup(t[6], TACTICS_NAMES[6], role);
    const defense_midfieldFocus = mixup(t[7], TACTICS_NAMES[7], role);
    const offense_midfieldFocusStrength = mixup(t[8], TACTICS_NAMES[8], role);
    const defense_midfieldFocusStrength = mixup(t[9], TACTICS_NAMES[9], role);
    let offense_sideFocusStrength = mixup(t[10], TACTICS_NAMES[10], role);
    let defense_sideFocusStrength = mixup(t[11], TACTICS_NAMES[11], role);
    const offense_microFocusStrength = mixup(t[12], TACTICS_NAMES[12], role);
    const defense_microFocusStrength = mixup(t[13], TACTICS_NAMES[13], role);

    const mindSet = AI_GetMindSet(role);
    offense_sideFocusStrength += (-0.5 + mindSet) * 0.2;
    defense_sideFocusStrength += (0.5 - mindSet) * 0.2;
    offense_sideFocusStrength = clamp(offense_sideFocusStrength + -0.3 + this.offensivenessBias * 0.3, 0.0, 1.0);
    defense_sideFocusStrength = clamp(defense_sideFocusStrength + -0.3 + (1.0 - this.offensivenessBias) * 0.3, 0.0, 1.0);

    const possessionAmountBias = NormalizedClamp(this.fadingTeamPossessionAmount - 0.5, 0.3, 0.7);
    // also take the ball's position as part of the possessionBias equation
    const ballBias = NormalizedClamp((ballX / pitchHalfW) * -side, -0.7, 0.7); // 0 == own half, 1 == opponent half
    // if possessionBias is unclear (near 0.5), take ballBias more seriously as indicator of possession.
    let ballBiasBias = 1.0 - Math.abs(possessionAmountBias * 2.0 - 1.0); // biasception
    ballBiasBias *= 0.6; // don't take ballBias too serious - we need defenders to somewhat keep watch when possession team is unclear, even when the ball is forward
    let possessionBias = possessionAmountBias * (1.0 - ballBiasBias) + ballBias * ballBiasBias;

    possessionBias = clamp(possessionBias + (this.offensivenessBias - 0.5) * 0.3, 0.0, 1.0);

    // offense can be a bit more relaxed
    focalPoint = ball
      .GetAveragePosition(3000)
      .Get2D()
      .Mul(1.0)
      .Add(focalPoint.Mul(0.0))
      .Mul(possessionBias)
      .Add(ball.GetAveragePosition(2000).Get2D().Mul(0.5).Add(focalPoint.Mul(0.5)).Mul(1.0 - possessionBias));

    const adaptedDepth = this.depth * (offense_depthFactor * possessionBias + defense_depthFactor * (1.0 - possessionBias));
    const adaptedWidth = this.width * (offense_widthFactor * possessionBias + defense_widthFactor * (1.0 - possessionBias));

    const offsetX =
      pitchHalfW * side * ((offense_ownHalfFactor * 2.0 - 1.0) * possessionBias + (defense_ownHalfFactor * 2.0 - 1.0) * (1.0 - possessionBias));

    const sideFocusStrength = offense_sideFocusStrength * possessionBias + defense_sideFocusStrength * (1.0 - possessionBias);

    const sideFocus = possessionBias * 2.0 - 1.0; // -1 == own side, 1 == opp side

    const sideX = 0.2 * sideFocus * -side * pitchHalfW + 0.8 * -match.GetAveragePossessionSide(6000) * pitchHalfW;
    let centerX = clamp(ballX * (1.0 - sideFocusStrength) + sideX * sideFocusStrength + offsetX, -pitchHalfW, pitchHalfW);

    // center of width
    let centerY = clamp(ballY, -pitchHalfH, pitchHalfH);

    // leave space for actual depth (50% depth on both sides of center)
    const adaptCenterToFitDepthBias = 0.95; // the lower this value, the more players will move with the centerX, and be clamped to the edges of the pitch
    const adaptCenterToFitWidthBias = 0.9; // the lower this value, the more players will move with the centerY, and be clamped to the edges of the pitch
    centerX *= ((1.0 - adaptedDepth) / 1.0) * adaptCenterToFitDepthBias + (1.0 - adaptCenterToFitDepthBias);
    centerY *= ((1.0 - adaptedWidth) / 1.0) * adaptCenterToFitWidthBias + (1.0 - adaptCenterToFitWidthBias);

    let backXBound = centerX - adaptedDepth * pitchHalfW * -side;
    const frontXBound = centerX + adaptedDepth * pitchHalfW * -side;
    const lowYBound = centerY - adaptedWidth * pitchHalfH;
    const highYBound = centerY + adaptedWidth * pitchHalfH;

    // maybe setting offside trap this way doesn't work too well: after all, defensive positioning stuff is done after this, thereby diminishing trap sometimes.
    // on the other hand, maybe this is a good basic trap setup, and we could apply the trap with the applyoffsidetrap function after the defensive positioning as well. (done from the def/mid strategies code)
    if (backXBound * side > this.GetOffsideTrapX() * side) backXBound = this.GetOffsideTrapX();

    const xFocus = 0.0;
    const xFocusStrength = 0.0;
    const yFocus = ballY * 1.0;
    let yFocusStrength = 0.5 * possessionBias + 0.2 * (1.0 - possessionBias); // todo: make dynamic/configurable

    let microFocus = focalPoint;
    const defensiveFocusPos = new Vector3(clamp(microFocus.coords[0] + side * 2.0, -pitchHalfW, backXBound * side), microFocus.coords[1] * 0.9, 0);
    microFocus = new Vector3(clamp(microFocus.coords[0] - side * 1.0, -pitchHalfW, pitchHalfW), microFocus.coords[1] * 0.9, 0)
      .Mul(possessionBias)
      .Add(defensiveFocusPos.Mul(1.0 - possessionBias));
    let microFocusStrength = offense_microFocusStrength * possessionBias + defense_microFocusStrength * (1.0 - possessionBias);

    // on own half in possession: little microfocus strength. on own half not in possession: lots of microfocus. other half: the other way around.
    let microFocusSideBias = NormalizedClamp((ballX / pitchHalfW) * -side, -0.7, 0.7); // ball on own half == lower values
    microFocusSideBias = microFocusSideBias * 0.7 + 0.3;
    const autoMicroFocusStrength = Math.pow(microFocusSideBias, 0.8) * possessionBias + Math.pow(1.0 - microFocusSideBias, 0.6) * (1.0 - possessionBias);
    microFocusStrength = microFocusStrength * (0.2 + 0.8 * autoMicroFocusStrength);

    // midfield focus. higher == more on opponent's half
    const manualMidfieldFocus = offense_midfieldFocus * possessionBias + defense_midfieldFocus * (1.0 - possessionBias);
    const autoMidfieldFocus = NormalizedClamp((ballX / pitchHalfW) * -side, -0.8, 0.8); // midfield follows ball
    const midfieldFocus = manualMidfieldFocus * 0.7 + autoMidfieldFocus * 0.3;
    let midfieldFocusStrength = offense_midfieldFocusStrength * possessionBias + defense_midfieldFocusStrength * (1.0 - possessionBias);
    if (!toggle_yFocus) yFocusStrength = 0.0;
    if (!toggle_microFocus) microFocusStrength = 0.0;
    if (!toggle_midfieldFocus) midfieldFocusStrength = 0.0;

    const desiredPos = AI_GetAdaptedFormationPosition(
      team.GetMatch(),
      player,
      backXBound,
      frontXBound,
      lowYBound,
      highYBound,
      xFocus,
      xFocusStrength,
      yFocus,
      yFocusStrength,
      microFocus,
      microFocusStrength,
      midfieldFocus,
      midfieldFocusStrength,
      useDynamicFormationPosition,
    );

    return new Vector3(clamp(desiredPos.coords[0], -pitchHalfW, pitchHalfW), clamp(desiredPos.coords[1], -pitchHalfH, pitchHalfH), desiredPos.coords[2]);
  }

  CalculateDynamicRoles(): void {
    const players: Player[] = [];
    this.team.GetActivePlayers(players);

    // PORT: the original loop never advanced its iterator (it only terminated when the first active player was the
    // goalie, else it hung); this removes the first goalie found, which is what it intended.
    for (let i = 0; i < players.length; i++) {
      if (players[i].GetFormationEntry().role === e_PlayerRole.e_PlayerRole_GK) {
        players.splice(i, 1);
        break;
      }
    }

    const playerNum = players.length;

    // collect adapted formation positions
    const adaptedFormationPositions: Vector3[] = [];
    for (let y = 0; y < playerNum; y++) {
      adaptedFormationPositions.push(this.GetAdaptedFormationPosition(players[y], false));
    }

    // PORT: the (loop-invariant) player positions and integer costs are computed once instead of per iteration
    const playerPositions: Vector3[] = [];
    for (let x = 0; x < playerNum; x++) {
      playerPositions.push(players[x].GetPosition().Add(players[x].GetMovement().Mul(0.5)));
    }
    // intCosts[x + y * playerNum] == cost of player x to formation position y
    const intCosts: number[] = new Array(playerNum * playerNum);

    // first make a sorted list on all possible distances between players and formation targets
    const distances: number[] = [];
    for (let x = 0; x < playerNum; x++) {
      for (let y = 0; y < playerNum; y++) {
        const playerPos = playerPositions[x];
        const formationPos = adaptedFormationPositions[y];
        const distance = playerPos.Sub(formationPos).GetLength();
        const intCost = Math.trunc(cround(distance * 10));
        distances.push(intCost);
        intCosts[x + y * playerNum] = intCost;
      }
    }

    distances.sort((a, b) => a - b);

    const r: number[] = new Array(playerNum * playerNum);

    for (let i = playerNum; i < distances.length; i += 5) {
      // libhungarian by Cyrill Stachniss, 2004

      const p = new hungarian_problem_t();

      for (let x = 0; x < playerNum; x++) {
        for (let y = 0; y < playerNum; y++) {
          let intCost = intCosts[x + y * playerNum];
          if (intCost >= distances[i]) intCost = 50000;
          r[x + y * playerNum] = intCost;
        }
      }

      const m = array_to_matrix(r, playerNum, playerNum);

      /* initialize the hungarian_problem using the cost matrix*/
      hungarian_init(p, m, playerNum, playerNum, HUNGARIAN_MODE_MINIMIZE_COST);

      /* solve the assignement problem */
      const totalCost = hungarian_solve(p);

      let ready = false;
      // C++: i >= distances.size() - 5 on unsigned ints
      const isLastRound = distances.length >= 5 && i >= distances.length - 5;
      if (totalCost !== -1 && (totalCost < 50000 || isLastRound)) {
        // assign dynamic role with best cost
        for (let x = 0; x < playerNum; x++) {
          for (let y = 0; y < playerNum; y++) {
            if (p.assignment[y][x] === HUNGARIAN_ASSIGNED) {
              const formationEntry: FormationEntry = players[y].GetFormationEntry().Clone();
              players[x].SetDynamicFormationEntry(formationEntry);
            }
          }
        }

        ready = true;
      }

      /* free used memory */
      hungarian_free(p);

      if (ready) break;
    }
  }

  CalculateMarkingQuality(player: Player, opp: Player): number {
    // todo?: a better method than a virtual line would be a virtual circle, originating from the goalpos with playerpos - goalpos distance as radius. not sure how to calculate 'u' then though

    const side = this.team.GetSide();

    const oppPosition = opp.GetPosition().Add(opp.GetMovement().Mul(0.1));
    const playerPosition = player.GetPosition().Add(player.GetMovement().Mul(0.1));

    // draw virtual line from 'left' to 'right' of player, perpendicular to the goal. anything 'above' this line he can catch up with. well,
    // not if it's too much to the side of this line / closer to goal; there just isn't enough time then to catch up.

    const goalPos = new Vector3(pitchHalfW * side, 0, 0);
    const toGoal = goalPos.Sub(playerPosition);
    const lineLength = clamp(toGoal.GetLength(), 4.0, 14.0);
    const line = new Line();
    const toGoalNorm = toGoal.GetNormalized(new Vector3(side, 0, 0));
    const safetyVec = toGoalNorm.Neg().Mul(0.5);
    line.SetVertex(0, playerPosition.Add(safetyVec).Add(toGoalNorm.GetRotated2D(-0.5 * pi).Mul(lineLength))); // left of player (seen from goal)
    line.SetVertex(1, playerPosition.Add(safetyVec).Add(toGoalNorm.GetRotated2D(0.5 * pi).Mul(lineLength))); // right of player (seen from goal)

    const oppIsOnRightSideOfLine = line.WhatSide(oppPosition); // notice the descriptive variable name
    // u: 'position' on line, v0 == 0 .. v1 == 1
    const { distance: oppFromLineDistance, u } = line.GetDistanceToPoint(oppPosition);

    let adaptedOppFromLineDistance = oppFromLineDistance;
    if (oppIsOnRightSideOfLine) adaptedOppFromLineDistance = Math.abs(oppFromLineDistance - 2.0); // we put the 'best spot' a bit further away from the line

    const oppFromLineDistanceFactor = Math.pow(NormalizedClamp(adaptedOppFromLineDistance, 0.0, 60.0), 0.5);
    const oppOnLineDistanceFactor = Math.pow(clamp(Math.abs(u * 2.0 - 1.0), 0.0, 1.0), 0.5);

    let result = 1.0;

    // opponent further away from the line == bad (well.. not bad.. but not very useful either. probably, another team mate is there, if not, can always catch up when opp gets closer)
    result -= oppFromLineDistanceFactor * 0.5;
    // opponent further away on the line == bad
    result -= oppOnLineDistanceFactor * 0.5;

    result = clamp(result, 0.0, 1.0);

    // argh, he's passed us already!
    if (!oppIsOnRightSideOfLine) result *= 0.6;

    // now add a bit of good old fashioned distancerating so that there'll still be some definition if result is now 0.0f
    const oppDistance = 1.0 - NormalizedClamp(playerPosition.Sub(oppPosition).GetLength(), 0.0, pitchHalfW * 2.0);
    result = result * 0.8 + oppDistance * 0.2;

    return result;
  }

  CalculateManMarking(): void {
    // new method

    const numMarkedOpponents = 3;

    const oppInfo = this.GetTacticalOpponentInfo();

    const players: Player[] = [];
    this.team.GetActivePlayers(players);

    // reset previous man marking
    for (let i = 0; i < players.length; i++) {
      players[i].SetManMarkingID(-1);
    }

    // most dangerous opponent gets closest player to cover him, and so on
    // (oppInfo is already sorted, most dangerous first. this is done in this->process() which is called earlier from team->process())
    for (let opp = 0; opp < Math.min(oppInfo.length, numMarkedOpponents); opp++) {
      let closestPlayer: Player | null = null;
      let bestMarkingQuality = -1.0;
      let closestPlayerIndex = -1;

      const oppPlayer = oppInfo[opp].player;

      // find closest player for this opponent
      for (let index = 0; index < players.length; index++) {
        if (players[index].GetFormationEntry().role !== e_PlayerRole.e_PlayerRole_GK) {
          const markingQuality = this.CalculateMarkingQuality(players[index], oppPlayer);

          if (markingQuality > bestMarkingQuality) {
            closestPlayer = players[index];
            bestMarkingQuality = markingQuality;
            closestPlayerIndex = index;
          }
        }
      }

      if (closestPlayer) {
        closestPlayer.SetManMarkingID(oppPlayer.GetID());
        players.splice(closestPlayerIndex, 1);
      }

      if (players.length === 0) break;
    }
  }

  /** C++ void ApplyOffsideTrap(Vector3 &position) const: returns the adapted position */
  ApplyOffsideTrap(position: Vector3): Vector3 {
    const side = this.team.GetSide();

    // smooth version

    // area, centered around offsideTrapX, that will be compressed.
    // so the area from [offsideTrapX - areaLength .. offsideTrapX + areaLength] will be compressed into [offsideTrapX .. offsideTrapX + areaLength]
    const areaHalfLength = 2.0;
    const absPosX = position.coords[0] * side;
    const absOffsideTrapX = this.offsideTrapX * side;

    if (absPosX > absOffsideTrapX - areaHalfLength) {
      const areaFront = absOffsideTrapX - areaHalfLength;
      const posFromAreaFront = absPosX - areaFront;
      let posFactor = posFromAreaFront / (areaHalfLength * 2.0);
      posFactor = clamp(posFactor, 0.0, 1.0); // 0.0f == most forward, 1.0f == deepest players

      const absResultPosX = areaFront + areaHalfLength * posFactor; // this compresses the 2 * areaHalfLength into 1 * areaHalfLength

      return position.WithCoord(0, absResultPosX * side);
    }

    return position;
  }

  GetOffsideTrapX(): number {
    return this.offsideTrapX;
  }

  PrepareSetPiece(setPiece: e_SetPiece, takerTeamID = -1): void {
    this.setPieceType = setPiece;

    if (takerTeamID === -1) assert(this.setPieceType === e_SetPiece.e_SetPiece_None);
    if (this.setPieceType === e_SetPiece.e_SetPiece_None) return;

    const team = this.team;
    const side = team.GetSide();
    const match = team.GetMatch();
    const ball = match.GetBall();

    const players: Player[] = [];
    team.GetActivePlayers(players);
    for (let i = 0; i < players.length; ) {
      if (players[i].GetFormationEntry().role === e_PlayerRole.e_PlayerRole_GK) {
        players[i].ResetPosition(new Vector3(pitchHalfW * side * 0.98, 0, 0), ball.Predict(0).Get2D());
        players.splice(i, 1);
      } else {
        i++;
      }
    }

    const isTakerTeam = takerTeamID === team.GetID() ? true : false;

    if (isTakerTeam) team.SetFadingTeamPossessionAmount(1.5);
    else team.SetFadingTeamPossessionAmount(0.5);

    switch (setPiece) {
      case e_SetPiece.e_SetPiece_KickOff:
        for (let i = 0; i < players.length; i++) {
          let basePos = players[i].GetFormationEntry().position.Mul(new Vector3(-side * pitchHalfW * 0.6, -side * pitchHalfH * 0.6, 0));
          basePos = basePos.WithCoord(1, basePos.coords[1] + random(-2.0, 2.0)); // to stop people from bumping into each other and such
          basePos = basePos.WithCoord(0, basePos.coords[0] * 0.5);
          basePos = basePos.WithCoord(0, basePos.coords[0] + pitchHalfW * 0.2 * side);
          if (basePos.coords[0] * side < 0.5) basePos = basePos.WithCoord(0, 0.5 * side); // not allowed to stand on opp side
          if (basePos.GetLength() < 9.4) {
            // not allowed to stand in center spot
            basePos = basePos.GetNormalized(new Vector3(side, 0, 0));
            basePos = basePos.Mul(9.4);
          }
          players[i].ResetPosition(basePos, ball.Predict(0).Get2D());

          // supporting players
          if (isTakerTeam) {
            const result: Player[] = [];
            AI_GetClosestPlayers(team, new Vector3(0), false, result, 2);
            for (let j = 0; j < result.length; j++) {
              result[j].ResetPosition(new Vector3(0, j * 1.4 * side, 0), ball.Predict(0).Get2D());
            }
          }
        }
        break;

      case e_SetPiece.e_SetPiece_GoalKick:
        for (let i = 0; i < players.length; i++) {
          let backXBound: number, frontXBound: number;
          if (isTakerTeam) {
            backXBound = side * pitchHalfW * 0.5;
            frontXBound = -side * pitchHalfW * 0.2;
          } else {
            backXBound = side * pitchHalfW * 0.4;
            frontXBound = -side * pitchHalfW * 0.1;
          }
          const lowYBound = -pitchHalfH * 0.7;
          const highYBound = pitchHalfH * 0.7;
          const basePos = AI_GetAdaptedFormationPosition(match, players[i], backXBound, frontXBound, lowYBound, highYBound, 0, 0, 0, 0, 0, 0, 0, 0, false);
          players[i].ResetPosition(basePos, ball.Predict(0).Get2D());
        }
        break;

      case e_SetPiece.e_SetPiece_Corner:
        for (let i = 0; i < players.length; i++) {
          let backXBound: number, frontXBound: number, xFocus: number, xFocusStrength: number, yFocus: number, yFocusStrength: number, midfieldFocus: number, midfieldFocusStrength: number;
          const ballPos = ball.Predict(0).Get2D();
          if (isTakerTeam) {
            backXBound = -side * pitchHalfW * 0.2;
            frontXBound = -side * pitchHalfW * 0.96;
            xFocus = frontXBound * 0.85;
            xFocusStrength = 0.7;
            yFocus = ballPos.coords[1] * 0.1;
            yFocusStrength = 0.7;
            midfieldFocus = 0.9;
            midfieldFocusStrength = 0.5;
          } else {
            backXBound = side * pitchHalfW * 0.98;
            frontXBound = side * pitchHalfW * 0.5;
            xFocus = backXBound * 0.94;
            xFocusStrength = 0.8;
            yFocus = ballPos.coords[1] * 0.1;
            yFocusStrength = 0.9;
            midfieldFocus = 0.1;
            midfieldFocusStrength = 0.7;
          }
          const lowYBound = -pitchHalfH * 0.6;
          const highYBound = pitchHalfH * 0.6;
          const basePos = AI_GetAdaptedFormationPosition(
            match,
            players[i],
            backXBound,
            frontXBound,
            lowYBound,
            highYBound,
            xFocus,
            xFocusStrength,
            yFocus,
            yFocusStrength,
            new Vector3(ballPos.coords[0] * 0.95, ballPos.coords[1] * 0.1, 0),
            0.9,
            midfieldFocus,
            midfieldFocusStrength,
            false,
          );
          players[i].ResetPosition(basePos, ball.Predict(0).Get2D());
        }
        break;

      case e_SetPiece.e_SetPiece_ThrowIn:
        for (let i = 0; i < players.length; i++) {
          let backXBound: number, frontXBound: number, xFocus: number, xFocusStrength: number, yFocus: number, yFocusStrength: number;
          const ballPos = ball.Predict(0).Get2D();
          if (isTakerTeam) {
            backXBound = clamp(ballPos.coords[0] + 30 * side, -pitchHalfW, pitchHalfW);
            frontXBound = clamp(ballPos.coords[0] + 20 * -side, -pitchHalfW, pitchHalfW);
            xFocus = clamp(ballPos.coords[0] + 4 * -side, -pitchHalfW, pitchHalfW);
            xFocusStrength = 0.4;
            yFocus = ballPos.coords[1] * 0.996;
            yFocusStrength = 0.6;
          } else {
            backXBound = clamp(ballPos.coords[0] + 30 * side, -pitchHalfW, pitchHalfW);
            frontXBound = clamp(ballPos.coords[0] + 15 * -side, -pitchHalfW, pitchHalfW);
            xFocus = clamp(ballPos.coords[0] + 16 * side, -pitchHalfW, pitchHalfW);
            xFocusStrength = 0.2;
            yFocus = ballPos.coords[1] * 0.95;
            yFocusStrength = 0.5;
          }
          const lowYBound = -pitchHalfH * 0.75 + ballPos.coords[1] * 0.25;
          const highYBound = pitchHalfH * 0.75 + ballPos.coords[1] * 0.25;
          const basePos = AI_GetAdaptedFormationPosition(
            match,
            players[i],
            backXBound,
            frontXBound,
            lowYBound,
            highYBound,
            xFocus,
            xFocusStrength,
            yFocus,
            yFocusStrength,
            ballPos,
            0.7,
            0,
            0,
            false,
          );
          players[i].ResetPosition(basePos, ball.Predict(0).Get2D());
        }
        break;

      case e_SetPiece.e_SetPiece_FreeKick: {
        for (let i = 0; i < players.length; i++) {
          let backXBound: number, frontXBound: number, xFocus: number, xFocusStrength: number, yFocus: number, yFocusStrength: number;
          const ballPos = ball.Predict(0).Get2D();
          if (isTakerTeam) {
            const xOffset = clamp((ballPos.coords[0] * -side) / pitchHalfW, -1.0, 1.0) * 0.5 + 0.5; // 0 == close to our goal, 1 == far from our goal
            backXBound = clamp(side * pitchHalfW * (0.7 - xOffset * 0.7), -pitchHalfW, pitchHalfW);
            frontXBound = clamp(side * pitchHalfW * (-0.3 - xOffset * 0.7), -pitchHalfW, pitchHalfW);
            xFocus = clamp(ballPos.coords[0] + 10 * -side, -pitchHalfW, pitchHalfW);
            xFocusStrength = 0.5 + xOffset * 0.2;
            yFocus = ballPos.coords[1] * 0.4;
            yFocusStrength = 0.6 + xOffset * 0.2;
          } else {
            const xOffset = clamp((ballPos.coords[0] * -side) / pitchHalfW, -1.0, 1.0) * 0.5 + 0.5; // 0 == close to our goal, 1 == far from our goal
            backXBound = clamp(side * pitchHalfW * (1.0 - xOffset * 0.6), -pitchHalfW, pitchHalfW);
            frontXBound = clamp(side * pitchHalfW * (0.5 - xOffset * 0.8), -pitchHalfW, pitchHalfW);
            xFocus = clamp(ballPos.coords[0] + 20 * side, -pitchHalfW, pitchHalfW);
            xFocusStrength = 0.6 - xOffset * 0.4;
            yFocus = ballPos.coords[1] * 0.2;
            yFocusStrength = 0.8 - xOffset * 0.4;
          }
          const lowYBound = -pitchHalfH * 0.7;
          const highYBound = pitchHalfH * 0.7;
          let basePos = AI_GetAdaptedFormationPosition(
            match,
            players[i],
            backXBound,
            frontXBound,
            lowYBound,
            highYBound,
            xFocus,
            xFocusStrength,
            yFocus,
            yFocusStrength,
            ballPos,
            0.4,
            0,
            0,
            false,
          );

          // keep distance
          if (!isTakerTeam) {
            const ball2D = ball.Predict(0).Get2D();
            if (basePos.Sub(ball2D).GetLength() < 9.15) {
              basePos = ball2D.Add(basePos.Sub(ball2D).GetNormalized().Mul(9.15));
            }
          }

          players[i].ResetPosition(basePos, ball.Predict(0).Get2D());
        }

        // wall
        const ball2D = ball.Predict(0).Get2D();
        if (!isTakerTeam && ball2D.Sub(new Vector3(side * pitchHalfW, 0, 0)).GetLength() < 40.0) {
          const result: Player[] = [];
          AI_GetClosestPlayers(team, ball2D, false, result, 3);
          for (let i = 0; i < result.length; i++) {
            let toGoal = new Vector3(side * pitchHalfW, 0, 0).Sub(ball2D).GetNormalized(0);
            toGoal = toGoal.Add(new Vector3(0, 1.0 - i, 0).Mul(0.07));
            toGoal = toGoal.GetNormalized();
            result[i].ResetPosition(ball2D.Add(toGoal.Mul(9.15)), ball2D);
          }
        }

        break;
      }

      case e_SetPiece.e_SetPiece_Penalty:
        for (let i = 0; i < players.length; i++) {
          let backXBound: number, frontXBound: number, xFocus: number, xFocusStrength: number, yFocus: number, yFocusStrength: number;
          const ballPos = ball.Predict(0).Get2D();
          if (isTakerTeam) {
            backXBound = clamp(ballPos.coords[0] + 50 * side, -pitchHalfW, pitchHalfW);
            frontXBound = clamp(ballPos.coords[0] + 10 * -side, -pitchHalfW, pitchHalfW);
            xFocus = ballPos.coords[0];
            xFocusStrength = 0.6;
            yFocus = 0.0;
            yFocusStrength = 0.8;
          } else {
            backXBound = clamp(ballPos.coords[0] + 11 * side, -pitchHalfW, pitchHalfW);
            frontXBound = clamp(ballPos.coords[0] + 20 * -side, -pitchHalfW, pitchHalfW);
            xFocus = ballPos.coords[0];
            xFocusStrength = 1.0;
            yFocus = 0.0;
            yFocusStrength = 1.0;
          }
          const lowYBound = -pitchHalfH * 0.8;
          const highYBound = pitchHalfH * 0.8;
          let basePos = AI_GetAdaptedFormationPosition(
            match,
            players[i],
            backXBound,
            frontXBound,
            lowYBound,
            highYBound,
            xFocus,
            xFocusStrength,
            yFocus,
            yFocusStrength,
            0,
            0,
            0,
            0,
            false,
          );

          // outside the box
          const penaltySide = ball.Predict(0).coords[0] < 0 ? -1 : 1;
          if (basePos.coords[0] * penaltySide > pitchHalfW - 16.5 - 0.5) basePos = basePos.WithCoord(0, (pitchHalfW - 16.5 - 0.5) * penaltySide);

          // outside penalty arc as well
          const ball2D = ball.Predict(0).Get2D();
          if (basePos.Sub(ball2D).GetLength() < 9.15 + 0.5) {
            basePos = ball2D.Add(basePos.Sub(ball2D).GetNormalized().Mul(9.15 + 0.5));
          }

          players[i].ResetPosition(basePos, ball.Predict(0).Get2D());
        }
        break;

      default:
        for (let i = 0; i < players.length; i++) {
          const basePos = players[i].GetFormationEntry().position.Mul(new Vector3(-side * pitchHalfW * 0.7, -side * pitchHalfH * 0.7, 0));

          players[i].ResetPosition(basePos, ball.Predict(0).Get2D());
        }
        break;
    }

    if (isTakerTeam) {
      const ball2D = ball.Predict(0).Get2D();
      const taker = AI_GetClosestPlayer(team, ball2D, false)!;
      this.taker = taker;

      if (setPiece === e_SetPiece.e_SetPiece_ThrowIn || setPiece === e_SetPiece.e_SetPiece_KickOff) {
        taker.ResetPosition(ball2D.Add(ball2D.GetNormalized(new Vector3(0, -side, 0)).Mul(0.3)), ball2D);
      } else if (setPiece === e_SetPiece.e_SetPiece_FreeKick) {
        taker.ResetPosition(ball2D.Add(new Vector3(side, 0, 0).Mul(2.3)), ball2D);
      } else {
        taker.ResetPosition(ball2D.Add(ball2D.GetNormalized(new Vector3(0, -side, 0)).Mul(2.3)), ball2D);
      }
      if (setPiece === e_SetPiece.e_SetPiece_ThrowIn) {
        taker.SelectRetainAnim();
      }
      if (setPiece === e_SetPiece.e_SetPiece_Penalty) {
        taker.ResetPosition(ball2D.Add(new Vector3(side, 0, 0).Mul(3.0)), ball2D);
      }
    } else this.taker = null;

    // keep distance from ball
    let minDistance = 2.0;
    if (!isTakerTeam) minDistance = 5.0;
    for (let i = 0; i < players.length; i++) {
      if (players[i] !== this.taker) {
        const ball2D = ball.Predict(0).Get2D();
        const toBall = players[i].GetPosition().Sub(ball2D);
        const ballDistance = toBall.GetLength();
        if (ballDistance < minDistance) players[i].ResetPosition(players[i].GetPosition().Add(toBall.GetNormalized(0).Mul(minDistance)), ball2D);
      }
    }
  }

  GetPieceTaker(): Player | null {
    return this.taker;
  }

  GetSetPieceType(): e_SetPiece {
    return this.setPieceType;
  }

  ApplyAttackingRun(manualPlayer: Player | null = null): void {
    this.endApplyAttackingRun_ms = this.match.GetActualTime_ms() + 4000;

    this.attackingRunPlayer = manualPlayer ? manualPlayer : SelectAttackingRunPlayer(this.team);
  }

  ApplyTeamPressure(): void {
    this.endApplyTeamPressure_ms = this.match.GetActualTime_ms() + 500;

    const opp = this.match.GetTeam(Math.abs(this.team.GetID() - 1)).GetBestPossessionPlayer();
    const opponentPos = opp.GetPosition().Add(opp.GetMovement().Mul(0.24));

    this.teamPressurePlayer = AI_GetClosestPlayer(this.team, opponentPos.Add(new Vector3(this.team.GetSide() * 1.0, 0, 0)), true, this.team.GetGoalie());

    if (this.teamPressurePlayer) {
      // switch man marking
      this.teamPressurePlayer.SetManMarkingID(opp.GetID());
    }
  }

  ApplyKeeperRush(): void {
    this.endApplyKeeperRush_ms = this.match.GetActualTime_ms() + 300;
  }

  CalculateSituation(): void {
    const team = this.team;
    const oppTeam = this.match.GetTeam(Math.abs(team.GetID() - 1));
    this.teamHasPossession = team.HasPossession();
    this.teamHasUniquePossession = team.HasUniquePossession();
    this.oppTeamHasPossession = oppTeam.HasPossession();
    this.oppTeamHasUniquePossession = oppTeam.HasUniquePossession();
    this.teamHasBestPossession = this.match.GetBestPossessionTeamID() === team.GetID();
    this.teamPossessionAmount = team.GetTeamPossessionAmount();
    this.fadingTeamPossessionAmount = team.GetFadingTeamPossessionAmount();
    this.timeNeededToGetToBall = team.GetTimeNeededToGetToBall_ms();
    this.oppTimeNeededToGetToBall = oppTeam.GetTimeNeededToGetToBall_ms();
  }

  UpdateTactics(): void {
    const team = this.team;
    const match = this.match;
    const teamTactics = team.GetTeamData().GetTactics();

    const userTacticsModifiers = teamTactics.userProperties;

    const goals = match.GetMatchData().GetGoalCount(team.GetID());
    const oppGoals = match.GetMatchData().GetGoalCount(Math.abs(team.GetID() - 1));

    this.liveTeamTactics = this.baseTeamTactics.Clone();

    // when trailing, we need goals. when leading, defend lead
    const goalFactor = clamp(0.5 + (oppGoals - goals) * 0.25, 0.0, 1.0);
    // time still to play matters - get more desperate towards the end
    const timeFactor = 0.5 + 0.5 * clamp(match.GetMatchTime_ms() / 6300000.0, 0.0, 1.0);

    const offenseBias = clamp(0.5 + (goalFactor - 0.5) * (timeFactor * 1.0), 0.0, 1.0);
    // todo: add skills/opp skills and difficulty as factors
    // todo: add off/def slider/tactics

    const possessionFactor = match.GetMatchData().GetPossessionFactor_60seconds();
    const recentPossessionBias = 1.0 - Math.abs(possessionFactor - team.GetID());

    this.offensivenessBias = offenseBias * 0.5 + recentPossessionBias * 0.5;

    const userMods = userTacticsModifiers.GetProperties(); // sorted by key, like the original std::map
    for (const [name, value] of userMods) {
      const multiplier = this.teamTacticsModMultipliers.GetReal(name, 0.0);

      const userOffset = atof(value);
      let offset = userOffset;

      offset = (offset - 0.5) * 2.0 * multiplier;

      const baseValue = this.baseTeamTactics.GetReal(name, -1.0);
      if (baseValue >= 0.0) {
        // not all user mods from teamdata are used in this class (for example, individual settings like dribble stuff), ignore them
        this.liveTeamTactics.Set(name, clamp(baseValue + offset, 0.0, 1.0));
      }
    }

    // PORT: refresh the numeric cache read by GetAdaptedFormationPosition (same values as liveTeamTactics.GetReal)
    this.liveTacticsValues = TACTICS_NAMES.map((n) => this.liveTeamTactics.GetReal(n));
  }

  GetEndApplyAttackingRun_ms(): number {
    return this.endApplyAttackingRun_ms;
  }

  GetAttackingRunPlayer(): Player | null {
    return this.attackingRunPlayer;
  }

  GetEndApplyTeamPressure_ms(): number {
    return this.endApplyTeamPressure_ms;
  }

  GetTeamPressurePlayer(): Player | null {
    return this.teamPressurePlayer;
  }

  GetForwardSupportPlayer(): Player | null {
    return this.forwardSupportPlayer;
  }

  GetEndApplyKeeperRush_ms(): number {
    return this.endApplyKeeperRush_ms;
  }

  GetTacticalOpponentInfo(): readonly TacticalOpponentInfo[] {
    return this.tacticalOpponentInfo;
  }

  Reset(): void {
    this.taker = null;

    this.setPieceType = e_SetPiece.e_SetPiece_None;

    this.offsideTrapX = 0;

    this.endApplyAttackingRun_ms = 0;
    this.attackingRunPlayer = null;
    this.endApplyTeamPressure_ms = 0;
    this.teamPressurePlayer = null;
    this.endApplyKeeperRush_ms = 0;

    this.teamHasPossession = false;
    this.teamHasUniquePossession = false;
    this.oppTeamHasPossession = false;
    this.oppTeamHasUniquePossession = false;
    this.teamHasBestPossession = false;
    this.teamPossessionAmount = 1.0;
    this.fadingTeamPossessionAmount = 1.0;
    this.timeNeededToGetToBall = 100;
    this.oppTimeNeededToGetToBall = 100;
  }
}
