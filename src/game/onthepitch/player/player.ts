// Port of legacy/src/onthepitch/player/player.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../../blunted/base/math/vector3';
import { NormalizedClamp, clamp, cround, random } from '../../../blunted/base/math/bluntmath';
import { int_to_str } from '../../../blunted/base/utils';
import { assert } from '../../../blunted/base/assert';
import type { Node } from '../../../blunted/scene/node';
import type { Resource } from '../../../blunted/scene/resources/resource';
import type { Surface } from '../../../blunted/scene/resources/surface';
import {
  GetRoleName,
  ballPredictionSize_ms,
  defaultTouchOffset_ms,
  e_FunctionType,
  e_PlayerRole,
  pitchHalfW,
  sprintVelocity,
  FormationEntry,
} from '../../gamedefines';
import { GetDebugMode, GetMenuTask, e_DebugMode } from '../../globals';
import { GetProjectedCoord } from '../../footballutils';
import { Gui2Caption } from '../../ui/gui2';
import type { MenuTask } from '../../menu/menutask';
import type { PlayerData } from '../../data/playerdata';
import type { Team } from '../team';
import { e_PlayerColor } from '../humangamer';
import { AI_CalculateFreeSpace, AI_GetClosestPlayer, AI_GetTimeNeededForDistance_ms, AI_HasPossession } from '../AIsupport/AIfunctions';
import { PlayerBase } from './playerbase';
import { Humanoid } from './humanoid/humanoid';
import type { AnimCollection } from './humanoid/animcollection';
import { ElizaController } from './controller/elizacontroller';
import type { HumanController } from './controller/humancontroller';
import type { PlayerController } from './controller/playercontroller';

export class TacticalPlayerSituation {
  forwardSpaceRating = 0;
  toGoalSpaceRating = 0;
  spaceRating = 0;
  forwardRating = 0;

  Clone(): TacticalPlayerSituation {
    return Object.assign(new TacticalPlayerSituation(), this);
  }
}

export class Player extends PlayerBase {
  protected team: Team;

  protected manMarkingID = -1;

  protected dynamicFormationEntry = new FormationEntry();

  protected hasPossession = false;
  protected hasBestPossession = false;
  protected hasUniquePossession = false;
  protected possessionDuration_ms = 0;
  protected timeNeededToGetToBall_ms = 1000;
  protected timeNeededToGetToBall_optimistic_ms = 1000;
  protected timeNeededToGetToBall_previous_ms = 1000;

  protected triggerControlledBallCollision = false;

  protected tacticalSituation = new TacticalPlayerSituation();

  protected buf_nameCaptionShowCondition = false;
  protected buf_debugCaptionShowCondition = false;
  protected buf_nameCaption = '...';
  protected buf_debugCaption = 'debug';
  protected buf_nameCaptionPos = new Vector3(0);
  protected buf_debugCaptionPos = new Vector3(0);
  protected buf_playerColor = new Vector3(0);
  protected buf_debugCaptionColor = new Vector3(0);

  protected fetchedbuf_nameCaptionShowCondition = false;
  protected fetchedbuf_debugCaptionShowCondition = false;
  protected fetchedbuf_nameCaption = '';
  protected fetchedbuf_debugCaption = '';
  protected fetchedbuf_nameCaptionPos = new Vector3(0);
  protected fetchedbuf_debugCaptionPos = new Vector3(0);
  protected fetchedbuf_playerColor = new Vector3(0);
  protected fetchedbuf_debugCaptionColor = new Vector3(0);

  protected nameCaption: Gui2Caption | null = null;
  protected debugCaption: Gui2Caption | null = null;

  protected menuTask: MenuTask | null;

  protected desiredTimeToBall_ms = 0;
  protected idealMovement = new Vector3(0);

  /** 1 == 1 yellow; 2 == 2 yellow; 3 == 1 red; 4 == 1 yellow, 1 red */
  protected cards = 0;

  protected cardEffectiveTime_ms = 0;

  constructor(team: Team, playerData: PlayerData) {
    super(team.GetMatch(), playerData);
    this.team = team;
    this.menuTask = GetMenuTask();
    this.SetDesiredTimeToBall_ms(0);
  }

  /** C++ destructor (~Player) */
  override Exit(): void {
    // C++: menuTask->GetWindowManager()->MarkForDeletion(caption)
    if (this.nameCaption) this.nameCaption.Exit();
    if (this.debugCaption) this.debugCaption.Exit();
    this.nameCaption = null;
    this.debugCaption = null;
    this.menuTask = null;
    super.Exit();
  }

  CastHumanoid(): Humanoid {
    return this.humanoid as Humanoid;
  }

  CastController(): ElizaController {
    return this.controller as ElizaController;
  }

  GetTeamID(): number {
    return this.team.GetID();
  }

  GetTeam(): Team {
    return this.team;
  }

  /** get ready for some action */
  override Activate(humanoidSourceNode: Node, fullbodySourceNode: Node, colorCoords: Map<string, Vector3>, kit: Resource<Surface>, animCollection: AnimCollection): void {
    assert(!this.isActive);

    this.isActive = true;

    this.humanoid = new Humanoid(this, humanoidSourceNode, fullbodySourceNode, colorCoords, animCollection, this.GetTeam().GetSceneNode(), kit, this.GetTeam().GetID());

    this.controller = new ElizaController(this.match);
    this.CastController().SetPlayer(this);
    this.CastController().LoadStrategies();

    this.buf_nameCaptionShowCondition = false;
    this.buf_debugCaptionShowCondition = false;
    if (GetDebugMode() !== e_DebugMode.e_DebugMode_Off) this.buf_nameCaptionShowCondition = true;
    if (GetDebugMode() !== e_DebugMode.e_DebugMode_Off) this.buf_debugCaptionShowCondition = true;

    const windowManager = GetMenuTask().GetWindowManager();
    this.nameCaption = new Gui2Caption(windowManager, 'game_player_name_' + int_to_str(this.id), 0, 0, 1, 2.0, this.playerData.GetLastName());
    this.nameCaption.SetTransparency(0.3);
    windowManager.GetRoot().AddView(this.nameCaption);
    this.debugCaption = new Gui2Caption(windowManager, 'game_player_debug_' + int_to_str(this.id), 0, 0, 1, 1.6, 'debug');
    windowManager.GetRoot().AddView(this.debugCaption);

    const side = this.team.GetSide();
    this.CastHumanoid().ResetPosition(this.GetFormationEntry().position.Mul(25).Mul(new Vector3(-side, -side, 0)), new Vector3(0));

    this.SetDynamicFormationEntry(this.GetFormationEntry());
  }

  /** go back to bench/take a shower */
  override Deactivate(): void {
    this.ResetSituation(this.GetPosition());

    // C++: menuTask->GetWindowManager()->MarkForDeletion(caption)
    if (this.nameCaption) this.nameCaption.Exit();
    if (this.debugCaption) this.debugCaption.Exit();
    this.nameCaption = null;
    this.debugCaption = null;

    if (this.team.IsHumanControlled(this.GetID())) {
      this.team.DeselectPlayer(this); // don't want any humangamer to have control of this player anymore
    }

    super.Deactivate();
  }

  TouchPending(): boolean {
    return this.CastHumanoid().TouchPending();
  }

  TouchAnim(): boolean {
    return this.CastHumanoid().TouchAnim();
  }

  GetTouchPos(): Vector3 {
    return this.CastHumanoid().GetTouchPos();
  }

  GetTouchFrame(): number {
    return this.CastHumanoid().GetTouchFrame();
  }

  GetCurrentFrame(): number {
    return this.CastHumanoid().GetCurrentFrame();
  }

  SelectRetainAnim(): void {
    this.CastHumanoid().SelectRetainAnim();
  }

  override GetCurrentFunctionType(): e_FunctionType {
    return this.CastHumanoid().GetCurrentFunctionType();
  }

  GetFormationEntry(): FormationEntry {
    return this.team.GetFormationEntry(this.id);
  }

  /** C++ passes the entry by value: a copy is stored */
  SetDynamicFormationEntry(entry: FormationEntry): void {
    this.dynamicFormationEntry = entry.Clone();
  }

  /** C++ returns a copy: clone before modifying the result */
  GetDynamicFormationEntry(): FormationEntry {
    return this.dynamicFormationEntry;
  }

  SetManMarkingID(id: number): void {
    this.manMarkingID = id;
  }

  GetManMarkingID(): number {
    return this.manMarkingID;
  }

  HasPossession(): boolean {
    return this.hasPossession;
  }

  HasBestPossession(): boolean {
    return this.hasBestPossession;
  }

  HasUniquePossession(): boolean {
    return this.hasUniquePossession;
  }

  GetPossessionDuration_ms(): number {
    return this.possessionDuration_ms;
  }

  GetTimeNeededToGetToBall_ms(): number {
    return this.timeNeededToGetToBall_ms;
  }

  GetTimeNeededToGetToBall_optimistic_ms(): number {
    return this.timeNeededToGetToBall_optimistic_ms;
  }

  GetTimeNeededToGetToBall_previous_ms(): number {
    return this.timeNeededToGetToBall_previous_ms;
  }

  SetDesiredTimeToBall_ms(ms: number): void {
    this.desiredTimeToBall_ms = ms;
  }

  GetDesiredTimeToBall_ms(): number {
    return Math.trunc(clamp(this.desiredTimeToBall_ms, this.timeNeededToGetToBall_ms, 1000000.0));
  }

  AllowLastDitch(includingPossessionAmount = true): boolean {
    if (includingPossessionAmount && this.team.GetTeamPossessionAmount() < 1.0) return true; // why team possession amount and not player's? answer: because we don't have that info here (todo: fix that)
    return this.GetTimeNeededToGetToBall_optimistic_ms() * 1.7 + 800 < this.GetTimeNeededToGetToBall_ms();
  }

  TriggerControlledBallCollision(): void {
    this.triggerControlledBallCollision = true;
  }

  IsControlledBallCollisionTriggered(): boolean {
    return this.triggerControlledBallCollision;
  }

  ResetControlledBallCollisionTrigger(): void {
    this.triggerControlledBallCollision = false;
  }

  /** is reset on ResetSituation() calls */
  GetAverageVelocity(timePeriod_sec: number): number {
    assert(Math.trunc(timePeriod_sec) > 0);
    const logSize = this.positionHistoryPerSecond.length;
    if (logSize === 0) return 0;
    let prevPos = new Vector3(0);
    let totalDistance = 0;
    let count = 0;
    const maxCount = Math.trunc(timePeriod_sec);
    while (count <= maxCount) {
      const pos = this.positionHistoryPerSecond[logSize - 1 - count];
      if (count > 0) totalDistance += pos.Sub(prevPos).GetLength();
      count++;
      if (logSize - count === 0) break;
      prevPos = pos;
    }
    return totalDistance / timePeriod_sec; // don't divide by count, since lack of entries should not influence average
  }

  UpdatePossessionStats(onInterval = true): void {
    if (!onInterval) return;

    this.timeNeededToGetToBall_previous_ms = this.timeNeededToGetToBall_ms; // todo: this will fail to function as intended when this function is ran multiple times consecutively

    const ball = this.match.GetBall();
    const position = this.GetPosition();
    const movement = this.GetMovement();
    const maxVelocity = this.GetMaxVelocity();

    // default
    this.timeNeededToGetToBall_ms = Math.max(
      ballPredictionSize_ms,
      Math.trunc(cround((ball.Predict(ballPredictionSize_ms - 10).Get2D().Sub(position.Add(movement.Mul(0.2))).GetLength() / (maxVelocity * 0.75)) * 1000)),
    );
    this.timeNeededToGetToBall_optimistic_ms = this.timeNeededToGetToBall_ms;

    const functionType = this.CastHumanoid().GetCurrentFunctionType();
    const isPassOrShot =
      functionType === e_FunctionType.e_FunctionType_ShortPass ||
      functionType === e_FunctionType.e_FunctionType_LongPass ||
      functionType === e_FunctionType.e_FunctionType_HighPass ||
      functionType === e_FunctionType.e_FunctionType_Shot;

    let startTime_ms = 0;
    if (isPassOrShot && !this.TouchPending()) {
      startTime_ms = 500;
    }

    let refine = false;
    let timeStep_ms = 10;
    let previous_ms = 0;
    const precise = this.team.GetDesignatedTeamPossessionPlayer() === this;
    const debug = this.GetDebug();
    for (let ms = startTime_ms; ms < ballPredictionSize_ms; ms += timeStep_ms) {
      const ballPos = ball.Predict(ms);
      if (ballPos.coords[2] < 1.5) {
        const result = AI_GetTimeNeededForDistance_ms(position, movement, ballPos.Get2D(), maxVelocity, precise, ms, debug);
        const timeNeeded = result.usual_ms;
        const timeNeeded_optimistic = result.optimistic_ms;

        if (timeNeeded_optimistic <= ms) {
          if (ms < this.timeNeededToGetToBall_optimistic_ms) this.timeNeededToGetToBall_optimistic_ms = ms;
        }

        if (timeNeeded <= ms) {
          // refinement round!
          if (!refine) {
            ms = previous_ms;
            timeStep_ms = 10;
            refine = true;

            // found!
          } else {
            this.timeNeededToGetToBall_ms = ms;
            break;
          }
        }
      }

      // refine timestep (optimisation)
      if (!refine) {
        // (ms is unchanged in this iteration when not refining, so ballPos == ball.Predict(ms))
        const balldist = position.Sub(ballPos.Get2D()).GetLength() + 0.2; // add a little buffer
        const maxBallVelo = 50;
        // how long does it take for the ball at max velo to travel balldist?
        const timeToGo_ms = Math.trunc(cround((balldist / maxBallVelo) * 1000.0));
        timeStep_ms = Math.trunc(clamp(timeToGo_ms, 10, 500));
        // round to 10s
        timeStep_ms = Math.floor(timeStep_ms / 10.0) * 10;
      } else timeStep_ms = 10;

      previous_ms = ms;
    }

    if (this.TouchAnim() && this.TouchPending()) {
      const animTimeToBall_ms = (this.CastHumanoid().GetTouchFrame() - this.GetCurrentFrame()) * 10;
      this.timeNeededToGetToBall_ms = Math.min(this.timeNeededToGetToBall_ms, animTimeToBall_ms);
      this.timeNeededToGetToBall_optimistic_ms = this.timeNeededToGetToBall_ms;
    }

    if (this.timeNeededToGetToBall_ms < defaultTouchOffset_ms) {
      // apply quantum mechanics on the scale of the very small ;)
      this.timeNeededToGetToBall_ms = Math.trunc(
        NormalizedClamp(position.Add(movement.Mul(defaultTouchOffset_ms * 0.001)).Sub(ball.Predict(defaultTouchOffset_ms).Get2D()).GetLength(), 0.0, 0.6) * defaultTouchOffset_ms,
      );
      this.timeNeededToGetToBall_optimistic_ms = this.timeNeededToGetToBall_ms;
    }

    const functionTypeNow = this.CastHumanoid().GetCurrentFunctionType();
    if (
      (functionTypeNow === e_FunctionType.e_FunctionType_ShortPass ||
        functionTypeNow === e_FunctionType.e_FunctionType_LongPass ||
        functionTypeNow === e_FunctionType.e_FunctionType_HighPass ||
        functionTypeNow === e_FunctionType.e_FunctionType_Shot) &&
      !this.TouchPending()
    ) {
      this.hasPossession = false;
    } else {
      // todo: shouldn't this be somewhere else?
      this.hasPossession = AI_HasPossession(ball, this);
    }

    const oppTeam = this.match.GetTeam(Math.abs(this.team.GetID() - 1));
    this.hasBestPossession = this.hasPossession && oppTeam.GetTimeNeededToGetToBall_ms() > this.GetTimeNeededToGetToBall_ms();
    this.hasUniquePossession = this.hasPossession && !oppTeam.HasPossession(); // todo: this should be in a seperate function, to be called after the other team's timetoball function already ran.

    const ballRetainer = this.match.GetBallRetainer();
    if (ballRetainer === this) {
      this.timeNeededToGetToBall_ms = 1;
      this.timeNeededToGetToBall_optimistic_ms = 1;
      this.SetDesiredTimeToBall_ms(this.timeNeededToGetToBall_ms);
      this.hasPossession = true;
      this.hasBestPossession = true;
      this.hasUniquePossession = true;
    } else if (ballRetainer !== null) {
      this.hasPossession = false;
      this.hasBestPossession = false;
      this.hasUniquePossession = false;
    }
  }

  GetClosestOpponentDistance(): number {
    const opp = AI_GetClosestPlayer(this.match.GetTeam(Math.abs(this.team.GetID() - 1)), this.GetPosition(), false);
    return opp!.GetPosition().GetDistance(this.GetPosition());
  }

  GetTacticalSituation(): TacticalPlayerSituation {
    return this.tacticalSituation;
  }

  override Process(): void {
    if (this.isActive) {
      this.desiredTimeToBall_ms = Math.max(this.desiredTimeToBall_ms - 10, 0);

      if (this.externalController) this.externalController.Process();
      else this.CastController().Process();

      if (this.match.IsInPlay()) {
        if (this.match.GetActualTime_ms() % 1000 === 0) {
          this.positionHistoryPerSecond.push(this.GetPosition());
        }
        if (this.hasPossession) this.possessionDuration_ms += 10;
        else this.possessionDuration_ms = 0;
        if ((this.match.GetActualTime_ms() + this.GetID() * 10) % 100 === 0) {
          this._CalculateTacticalSituation();
        }
      }

      const posBefore = this.CastHumanoid().GetPosition();

      this.CastHumanoid().Process();

      const posAfter = this.CastHumanoid().GetPosition();

      const distance = posAfter.Sub(posBefore).GetLength();
      this.fatigueFactorInv -= distance * 0.00003 * (2.0 - this.GetStaminaStat()) * (1.0 / this.match.GetMatchDurationFactor());
      this.fatigueFactorInv = clamp(this.fatigueFactorInv, 0.01, 1.0);

      if (this.cards > 1 && this.cardEffectiveTime_ms <= this.match.GetActualTime_ms()) {
        this.SendOff();
      }
    }
  }

  override PreparePutBuffers(snapshotTime_ms: number): void {
    super.PreparePutBuffers(snapshotTime_ms);

    if (GetDebugMode() === e_DebugMode.e_DebugMode_Off) {
      this.buf_nameCaptionShowCondition = this.team.IsHumanControlled(this.id);
      if (this.team.GetHumanGamerCount() === 0) this.buf_nameCaptionShowCondition = this.team.GetDesignatedTeamPossessionPlayer() === this;
    }
    const playerColor = this.team.GetPlayerColor(this.id);
    switch (playerColor) {
      case e_PlayerColor.e_PlayerColor_Green:
        this.buf_playerColor = new Vector3(100, 255, 140);
        break;
      case e_PlayerColor.e_PlayerColor_Red:
        this.buf_playerColor = new Vector3(255, 110, 110);
        break;
      case e_PlayerColor.e_PlayerColor_Blue:
        this.buf_playerColor = new Vector3(100, 140, 255);
        break;
      case e_PlayerColor.e_PlayerColor_Yellow:
        this.buf_playerColor = new Vector3(255, 255, 60);
        break;
      case e_PlayerColor.e_PlayerColor_Purple:
        this.buf_playerColor = new Vector3(200, 80, 200);
        break;
      case e_PlayerColor.e_PlayerColor_Default:
        this.buf_playerColor = new Vector3(200, 200, 200);
        break;
    }

    const name = this.playerData.GetLastName();
    if (this.buf_debugCaptionShowCondition) {
      this.buf_debugCaption = GetRoleName(this.GetDynamicFormationEntry().role);
    }

    this.buf_nameCaption = name;

    const externalController = this.GetExternalController();
    if (externalController) {
      const actionMode = (externalController as HumanController).GetActionMode();
      if (actionMode === 2) {
        this.buf_playerColor = this.buf_playerColor.Mul(Math.sin(this.match.GetActualTime_ms() * 0.02) * 0.3 + 0.7);
      }
    }
  }

  override FetchPutBuffers(putTime_ms: number): void {
    super.FetchPutBuffers(putTime_ms);

    this.fetchedbuf_nameCaptionShowCondition = this.buf_nameCaptionShowCondition;
    this.fetchedbuf_debugCaptionShowCondition = this.buf_debugCaptionShowCondition;
    this.fetchedbuf_nameCaption = this.buf_nameCaption;
    this.fetchedbuf_debugCaption = this.buf_debugCaption;
    this.fetchedbuf_nameCaptionPos = this.buf_nameCaptionPos;
    this.fetchedbuf_debugCaptionPos = this.buf_debugCaptionPos;
    this.fetchedbuf_playerColor = this.buf_playerColor;
    this.fetchedbuf_debugCaptionColor = this.buf_debugCaptionColor;
  }

  Put2D(): void {
    // PORT: the e_DebugMode_AI man marking line (drawn on the debug overlay image) is not ported: debug drawing only

    const nameCaption = this.nameCaption!;
    const debugCaption = this.debugCaption!;

    if (this.fetchedbuf_nameCaptionShowCondition) {
      // geom pos because in Put2D, we cannot access normal class vars (because multithreading)
      const captionPos3D = GetProjectedCoord(this.GetGeomPosition().Add(new Vector3(0, 0.5, 2.4)), this.match.GetCamera()!);
      const { width_percent: w, height_percent: h } = nameCaption.GetSize();
      nameCaption.SetColor(this.fetchedbuf_playerColor);
      nameCaption.SetOutlineColor(this.fetchedbuf_playerColor.Mul(0.4));
      nameCaption.SetPosition(captionPos3D.coords[0] - w * 0.5, captionPos3D.coords[1] - h);

      nameCaption.SetCaption(this.fetchedbuf_nameCaption);
      nameCaption.Show();
    } else {
      nameCaption.Hide();
    }

    if (this.fetchedbuf_debugCaptionShowCondition) {
      const captionPos3D = GetProjectedCoord(this.GetGeomPosition().Add(new Vector3(0, 0.3, 2.0)), this.match.GetCamera()!);
      const { width_percent: w, height_percent: h } = debugCaption.GetSize();
      debugCaption.SetPosition(captionPos3D.coords[0] - w * 0.5, captionPos3D.coords[1] - h);
      debugCaption.SetCaption(this.fetchedbuf_debugCaption);
      debugCaption.SetColor(this.fetchedbuf_debugCaptionColor);
      debugCaption.Show();
    } else {
      debugCaption.Hide();
    }
  }

  Hide2D(): void {
    if (this.fetchedbuf_nameCaptionShowCondition) {
      assert(this.nameCaption);
      this.nameCaption?.Hide();
    }
    if (this.fetchedbuf_debugCaptionShowCondition) {
      assert(this.debugCaption);
      this.debugCaption?.Hide();
    }
  }

  GiveYellowCard(giveTime_ms: number): void {
    this.cards++;
    this.cardEffectiveTime_ms = giveTime_ms;
  }

  GiveRedCard(giveTime_ms: number): void {
    this.cards += 3;
    this.cardEffectiveTime_ms = giveTime_ms;
  }

  GetCards(): number {
    return this.cards;
  }

  SendOff(): void {
    const x = random(0, 3);
    let message: string;
    if (x < 1.0) {
      message = 'an early shower for ' + this.playerData.GetLastName() + '!';
    } else if (x < 2.0) {
      message = this.playerData.GetLastName() + ' is sent off!';
    } else {
      message = "it's all over for " + this.playerData.GetLastName() + '!';
    }
    this.match.SpamMessage(message);

    this.Deactivate();

    if (this.GetFormationEntry().role === e_PlayerRole.e_PlayerRole_GK) {
      const entry = this.GetFormationEntry().Clone();
      const activePlayers: Player[] = [];
      this.team.GetActivePlayers(activePlayers);
      assert(activePlayers.length > 0);
      const newGoalieID = activePlayers[0].GetID();
      this.team.SetFormationEntry(newGoalieID, entry);
    }

    const activePlayers: Player[] = [];
    this.team.GetActivePlayers(activePlayers);
    const remainingPlayers = activePlayers.length;
    if (remainingPlayers <= 6) {
      // too many red cards - forfeit
      // todo: referee should do this. also, make sure the forfeiting team will actually lose :P
      this.match.GameOver();
    }
  }

  GetStaminaStat(): number {
    return this.playerData.GetStat('physical_stamina');
  }

  override GetStat(name: string): number {
    let multiplier = 1.0;
    if (this.team.GetHumanGamerCount() === 0) multiplier = 0.3 + 0.7 * this.team.GetMatch().GetMatchDifficulty();
    multiplier *= 0.7 + 0.3 * this.GetFatigueFactorInv(); // todo: some stats are more affected by fatigue than others
    return this.playerData.GetStat(name) * multiplier;
  }

  override ResetSituation(focusPos: Vector3): void {
    super.ResetSituation(focusPos);

    this.hasPossession = false;
    this.hasBestPossession = false;
    this.hasUniquePossession = false;
    this.possessionDuration_ms = 0;
    this.timeNeededToGetToBall_ms = 1000;
    this.timeNeededToGetToBall_optimistic_ms = 1000;
    this.SetDesiredTimeToBall_ms(0);
    this.manMarkingID = -1;

    this.triggerControlledBallCollision = false;

    this.tacticalSituation.forwardSpaceRating = 0;
    this.tacticalSituation.toGoalSpaceRating = 0;
    this.tacticalSituation.spaceRating = 0;
  }

  protected _CalculateTacticalSituation(): void {
    const mentalImage = (this.GetController() as PlayerController).GetMentalImage();
    assert(mentalImage);
    assert(this.IsActive());

    const side = this.team.GetSide();

    // calculate how free the path forward is
    let time_sec = 0.5;
    let checkPos = this.GetPosition().Add(new Vector3(-side, 0, 0).Mul(sprintVelocity * time_sec));
    this.tacticalSituation.forwardSpaceRating = AI_CalculateFreeSpace(this.match, mentalImage!, this.team.GetID(), checkPos, 5.0, time_sec, true); // FREESPACE :D :D

    // calculate the amount of space this player has
    time_sec = 0.1;
    checkPos = this.GetPosition().Add(this.GetMovement().Mul(time_sec));
    this.tacticalSituation.spaceRating = AI_CalculateFreeSpace(this.match, mentalImage!, this.team.GetID(), checkPos, 5.0, time_sec, true); // FREESPACE :D :D

    // distance to opponent goal 0 .. 1 == farthest .. closest
    this.tacticalSituation.forwardRating = 1.0 - clamp(new Vector3(pitchHalfW * -side, 0, 0).Sub(this.GetPosition()).GetLength() / (pitchHalfW * 2.0), 0.0, 1.0);
    this.tacticalSituation.forwardRating = Math.pow(this.tacticalSituation.forwardRating, 1.5); // more important when close to goal
  }
}
