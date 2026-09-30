// Port of legacy/src/onthepitch/player/playerbase.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import type { Vector3 } from '../../../blunted/base/math/vector3';
import { clamp, type radian } from '../../../blunted/base/math/bluntmath';
import { real_to_str } from '../../../blunted/base/utils';
import { Log, e_LogType } from '../../../blunted/base/log';
import type { Node } from '../../../blunted/scene/node';
import type { Resource } from '../../../blunted/scene/resources/resource';
import type { Surface } from '../../../blunted/scene/resources/surface';
import {
  e_TouchType,
  sprintVelocity,
  type PlayerCommandQueue,
  type e_Velocity,
  type e_FunctionType,
} from '../../gamedefines';
import { IsReleaseVersion } from '../../globals';
import type { PlayerData } from '../../data/playerdata';
import type { Match } from '../match';
import type { IController } from './controller/icontroller';
import type { HumanoidBase } from './humanoid/humanoidbase';
import { EnumToFloatVelocity, type AnimCollection } from './humanoid/animcollection';

export abstract class PlayerBase {
  protected match: Match;

  protected playerData: PlayerData;
  protected readonly id: number;

  protected debug = false;

  protected humanoid: HumanoidBase | null = null;
  protected controller: IController | null = null;
  protected externalController: IController | null = null;

  protected isActive = false;

  protected lastTouchTime_ms = 0;
  protected lastTouchType = e_TouchType.e_TouchType_None;

  protected static playerCount = 0;

  protected fatigueFactorInv = 1.0;
  protected confidenceFactor = 1.0;

  protected averageStat = 0;

  /** resets too (on ResetSituation() calls) */
  protected positionHistoryPerSecond: Vector3[] = [];

  constructor(match: Match, playerData: PlayerData) {
    this.match = match;
    this.playerData = playerData;
    this.id = PlayerBase.playerCount++;

    // PORT: C++ calls the virtual GetStat() from the base constructor, which resolves to PlayerBase::GetStat
    // (the subclass is not constructed yet), so read the raw player data directly.
    const stat = (name: string): number => this.playerData.GetStat(name);
    this.averageStat =
      stat('physical_balance') +
      stat('physical_reaction') +
      stat('physical_acceleration') +
      stat('physical_velocity') +
      stat('physical_stamina') +
      stat('physical_agility') +
      stat('physical_shotpower') +
      stat('technical_standingtackle') +
      stat('technical_slidingtackle') +
      stat('technical_ballcontrol') +
      stat('technical_dribble') +
      stat('technical_shortpass') +
      stat('technical_highpass') +
      stat('technical_header') +
      stat('technical_shot') +
      stat('technical_volley') +
      stat('mental_calmness') +
      stat('mental_workrate') +
      stat('mental_resilience') +
      stat('mental_defensivepositioning') +
      stat('mental_offensivepositioning') +
      stat('mental_vision');
    this.averageStat /= 22.0;

    Log(e_LogType.e_Notice, 'PlayerBase', 'PlayerBase', "player '" + playerData.GetLastName() + "' has an average stat of " + real_to_str(this.averageStat));
  }

  /** C++ destructor (~PlayerBase) */
  Exit(): void {
    // PORT: in the C++ destructor the virtual Deactivate() call resolves to PlayerBase::Deactivate
    if (this.isActive) PlayerBase.prototype.Deactivate.call(this);
    if (this.humanoid) this.humanoid.Exit();
    this.humanoid = null;
  }

  GetID(): number {
    return this.id;
  }

  GetPlayerData(): PlayerData {
    return this.playerData;
  }

  IsActive(): boolean {
    return this.isActive;
  }

  /** get ready for some action */
  abstract Activate(humanoidSourceNode: Node, fullbodySourceNode: Node, colorCoords: Map<string, Vector3>, kit: Resource<Surface>, animCollection: AnimCollection): void;

  /** go back to bench/take a shower */
  Deactivate(): void {
    this.ResetSituation(this.GetPosition());

    this.isActive = false;

    if (this.humanoid) this.humanoid.Hide();

    if (this.externalController) this.externalController = null;
    this.controller = null; // C++: delete controller
  }

  SetKit(newKit: Resource<Surface>): void {
    this.humanoid!.SetKit(newKit);
  }

  ResetPosition(newPos: Vector3, focusPos: Vector3): void {
    this.humanoid!.ResetPosition(newPos, focusPos);
  }

  OffsetPosition(offset: Vector3): void {
    this.humanoid!.OffsetPosition(offset);
  }

  GetFrameNum(): number {
    return this.humanoid!.GetFrameNum();
  }

  GetFrameCount(): number {
    return this.humanoid!.GetFrameCount();
  }

  GetPosition(): Vector3 {
    return this.humanoid!.GetPosition();
  }

  GetGeomPosition(): Vector3 {
    return this.humanoid!.GetGeomPosition();
  }

  GetDirectionVec(): Vector3 {
    return this.humanoid!.GetDirectionVec();
  }

  GetBodyDirectionVec(): Vector3 {
    return this.humanoid!.GetBodyDirectionVec();
  }

  GetMovement(): Vector3 {
    return this.humanoid!.GetMovement();
  }

  GetAngle(): radian {
    return this.humanoid!.GetAngle();
  }

  GetRelBodyAngle(): radian {
    return this.humanoid!.GetRelBodyAngle();
  }

  GetEnumVelocity(): e_Velocity {
    return this.humanoid!.GetEnumVelocity();
  }

  GetFloatVelocity(): number {
    return EnumToFloatVelocity(this.humanoid!.GetEnumVelocity());
  }

  GetCurrentFunctionType(): e_FunctionType {
    return this.humanoid!.GetCurrentFunctionType();
  }

  GetPreviousFunctionType(): e_FunctionType {
    return this.humanoid!.GetPreviousFunctionType();
  }

  TripMe(tripVector: Vector3, tripType: number): void {
    this.humanoid!.TripMe(tripVector, tripType);
  }

  RequestCommand(commandQueue: PlayerCommandQueue): void {
    if (this.externalController) this.externalController.RequestCommand(commandQueue);
    else this.controller!.RequestCommand(commandQueue);
  }

  /** returns the external (human) controller if set, else the AI controller */
  GetController(): IController {
    if (this.externalController) return this.externalController;
    return this.controller!;
  }

  SetExternalController(externalController: IController | null): void {
    this.externalController = externalController;
    if (this.externalController) {
      this.externalController.Reset();
      this.externalController.SetPlayer(this);
      this.externalController.SetFallbackController(this.controller);
    } else {
      this.controller!.Reset();
    }
  }

  GetExternalController(): IController | null {
    return this.externalController;
  }

  SetDebug(state: boolean): void {
    this.debug = state;
  }

  GetDebug(): boolean {
    if (IsReleaseVersion()) return false;
    return this.debug;
  }

  GetHumanoidNode(): Node {
    return this.humanoid!.GetHumanoidNode();
  }

  GetFullbodyNode(): Node {
    return this.humanoid!.GetFullbodyNode();
  }

  GetDecayingPositionOffsetLength(): number {
    return this.humanoid!.GetDecayingPositionOffsetLength();
  }

  Process(): void {
    if (this.isActive) {
      if (this.externalController) this.externalController.Process();
      else this.controller!.Process();
      this.humanoid!.Process();
    } else {
      if (this.humanoid) this.humanoid.Hide();
    }
  }

  PreparePutBuffers(snapshotTime_ms: number): void {
    this.humanoid!.PreparePutBuffers(snapshotTime_ms);
  }

  FetchPutBuffers(putTime_ms: number): void {
    this.humanoid!.FetchPutBuffers(putTime_ms);
  }

  Put(): void {
    this.humanoid!.Put();
  }

  UpdateFullbodyNodes(): void {
    this.humanoid!.UpdateFullbodyNodes();
  }

  NeedsModelUpdate(): boolean {
    return this.humanoid!.NeedsModelUpdate();
  }

  UpdateFullbodyModel(): void {
    this.humanoid!.UpdateFullbodyModel();
  }

  GetStat(name: string): number {
    return this.playerData.GetStat(name);
  }

  GetVelocityMultiplier(): number {
    // see humanoid_utils' physics function
    return 0.9 + this.GetStat('physical_velocity') * 0.1;
  }

  GetMaxVelocity(): number {
    // see humanoidbase's physics function
    return sprintVelocity * this.GetVelocityMultiplier();
  }

  GetCurrentAnim(): ReturnType<HumanoidBase['GetCurrentAnim']> {
    return this.humanoid!.GetCurrentAnim();
  }

  GetPreviousAnim(): ReturnType<HumanoidBase['GetPreviousAnim']> {
    return this.humanoid!.GetPreviousAnim();
  }

  SetLastTouchTime_ms(touchTime_ms: number): void {
    this.lastTouchTime_ms = touchTime_ms;
  }

  GetLastTouchTime_ms(): number {
    return this.lastTouchTime_ms;
  }

  SetLastTouchType(touchType: e_TouchType): void {
    this.lastTouchType = touchType;
  }

  GetLastTouchType(): e_TouchType {
    return this.lastTouchType;
  }

  GetLastTouchBias(decay_ms: number, time_ms = 0): number {
    let adaptedTime_ms = time_ms;
    if (time_ms === 0) adaptedTime_ms = this.match.GetActualTime_ms();
    if (decay_ms > 0) {
      const elapsed_ms = adaptedTime_ms - this.GetLastTouchTime_ms();
      // C++ subtracts unsigned longs: a negative difference wraps to a huge value (clamped to 1 below)
      if (elapsed_ms < 0) return 0.0;
      return 1.0 - clamp(elapsed_ms / decay_ms, 0.0, 1.0);
    }
    return 0.0;
  }

  GetNodeMap(): ReturnType<HumanoidBase['GetNodeMap']> {
    return this.humanoid!.GetNodeMap();
  }

  GetFatigueFactorInv(): number {
    return this.fatigueFactorInv;
  }

  RelaxFatigue(howMuch: number): void {
    this.fatigueFactorInv += howMuch;
    this.fatigueFactorInv = clamp(this.fatigueFactorInv, 0.01, 1.0);
  }

  GetConfidenceFactor(): number {
    return this.confidenceFactor;
  }

  GetAverageStat(): number {
    return this.averageStat;
  }

  ResetSituation(focusPos: Vector3): void {
    this.positionHistoryPerSecond = [];
    this.lastTouchTime_ms = 0;
    this.lastTouchType = e_TouchType.e_TouchType_None;
    if (this.IsActive()) this.humanoid!.ResetSituation(focusPos);
    const controller = this.externalController ?? this.controller;
    if (controller) controller.Reset();
  }
}
