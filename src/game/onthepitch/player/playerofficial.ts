// Port of legacy/src/onthepitch/player/playerofficial.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../../blunted/base/math/vector3';
import type { Node } from '../../../blunted/scene/node';
import type { Resource } from '../../../blunted/scene/resources/resource';
import type { Surface } from '../../../blunted/scene/resources/surface';
import type { PlayerData } from '../../data/playerdata';
import type { Match } from '../match';
import { PlayerBase } from './playerbase';
import { HumanoidBase } from './humanoid/humanoidbase';
import type { AnimCollection } from './humanoid/animcollection';
import { RefereeController } from './controller/refereecontroller';

export enum e_OfficialType {
  e_OfficialType_Referee,
  e_OfficialType_Linesman,
}

export class PlayerOfficial extends PlayerBase {
  protected officialType: e_OfficialType;

  constructor(officialType: e_OfficialType, match: Match, playerData: PlayerData) {
    super(match, playerData);
    this.officialType = officialType;
  }

  CastHumanoid(): HumanoidBase {
    return this.humanoid!;
  }

  CastController(): RefereeController {
    return this.controller as RefereeController;
  }

  GetOfficialType(): e_OfficialType {
    return this.officialType;
  }

  override Activate(humanoidSourceNode: Node, fullbodySourceNode: Node, colorCoords: Map<string, Vector3>, kit: Resource<Surface>, animCollection: AnimCollection): void {
    this.isActive = true;
    this.humanoid = new HumanoidBase(this, this.match, humanoidSourceNode, fullbodySourceNode, colorCoords, animCollection, this.match.GetDynamicNode(), kit, 0);

    this.CastHumanoid().ResetPosition(new Vector3(0), new Vector3(0));

    this.controller = new RefereeController(this.match);
    this.CastController().SetPlayer(this);
  }

  override Deactivate(): void {
    super.Deactivate();
  }

  override Process(): void {
    this.CastController().Process();
    this.CastHumanoid().Process();
  }

  override PreparePutBuffers(snapshotTime_ms: number): void {
    super.PreparePutBuffers(snapshotTime_ms);
  }

  override FetchPutBuffers(putTime_ms: number): void {
    super.FetchPutBuffers(putTime_ms);
  }
}
