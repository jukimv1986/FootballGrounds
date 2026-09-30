// Port of legacy/src/onthepitch/officials.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../blunted/base/math/vector3';
import { ResourceManagerPool } from '../../blunted/managers/resourcemanagerpool';
import type { Node } from '../../blunted/scene/node';
import { Geometry } from '../../blunted/scene/objects/geometry';
import type { Resource } from '../../blunted/scene/resources/resource';
import type { Surface } from '../../blunted/scene/resources/surface';
import { e_LocalMode } from '../../blunted/scene/spatial';
import { ObjectLoader } from '../../blunted/utils/objectloader';
import { PlayerData } from '../data/playerdata';
import { e_FunctionType } from '../gamedefines';
import type { Match } from './match';
import type { AnimCollection } from './player/humanoid/animcollection';
import type { PlayerBase } from './player/playerbase';
import { PlayerOfficial, e_OfficialType } from './player/playerofficial';

const CARD_OFFSET = new Vector3(0.04, 0, -0.25);

export class Officials {
  protected match: Match;

  protected referee: PlayerOfficial;
  protected linesmen: [PlayerOfficial, PlayerOfficial];
  protected playerData: PlayerData;

  protected yellowCard: Geometry;
  protected redCard: Geometry;

  /** PORT: animCollection is unused, like in the C++ (it used match->GetAnimCollection()) */
  constructor(match: Match, fullbodySourceNode: Node, colorCoords: Map<string, Vector3>, kit: Resource<Surface>, _animCollection: AnimCollection) {
    this.match = match;

    const loader = new ObjectLoader();
    const playerNode = loader.LoadObject('media/objects/players/player.object');
    playerNode.SetName('player');
    playerNode.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);

    this.playerData = new PlayerData();
    this.referee = new PlayerOfficial(e_OfficialType.e_OfficialType_Referee, match, this.playerData);
    this.linesmen = [
      new PlayerOfficial(e_OfficialType.e_OfficialType_Linesman, match, this.playerData),
      new PlayerOfficial(e_OfficialType.e_OfficialType_Linesman, match, this.playerData),
    ];

    this.referee.Activate(playerNode, fullbodySourceNode, colorCoords, kit, match.GetAnimCollection());
    this.linesmen[0].Activate(playerNode, fullbodySourceNode, colorCoords, kit, match.GetAnimCollection());
    this.linesmen[1].Activate(playerNode, fullbodySourceNode, colorCoords, kit, match.GetAnimCollection());
    playerNode.Exit();

    this.referee.CastHumanoid().ResetPosition(new Vector3(10, -10, 0), new Vector3(0));
    this.linesmen[0].CastHumanoid().ResetPosition(new Vector3(25, -36.5, 0), new Vector3(0));
    this.linesmen[1].CastHumanoid().ResetPosition(new Vector3(-25, 36.5, 0), new Vector3(0));

    let geometry = ResourceManagerPool.GetInstance().FetchGeometryData('media/objects/officials/yellowcard.ase', true);
    this.yellowCard = new Geometry('yellowcard');
    this.yellowCard.SetGeometryData(geometry);
    this.yellowCard.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
    this.yellowCard.SetPosition(new Vector3(0, 0, -10));

    geometry = ResourceManagerPool.GetInstance().FetchGeometryData('media/objects/officials/redcard.ase', true);
    this.redCard = new Geometry('redcard');
    this.redCard.SetGeometryData(geometry);
    this.redCard.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
    this.redCard.SetPosition(new Vector3(0, 0, -10));
  }

  /** C++ destructor */
  Exit(): void {
    this.referee.Exit();
    this.linesmen[0].Exit();
    this.linesmen[1].Exit();
  }

  GetPlayers(players: PlayerBase[]): PlayerBase[] {
    players.push(this.referee);
    players.push(this.linesmen[0]);
    players.push(this.linesmen[1]);
    return players;
  }

  GetReferee(): PlayerOfficial {
    return this.referee;
  }

  GetLinesmanNorth(): PlayerOfficial {
    return this.linesmen[0];
  }

  GetLinesmanSouth(): PlayerOfficial {
    return this.linesmen[1];
  }

  Process(): void {
    this.referee.Process();
    this.linesmen[0].Process();
    this.linesmen[1].Process();
  }

  PreparePutBuffers(snapshotTime_ms: number): void {
    this.referee.PreparePutBuffers(snapshotTime_ms);
    this.linesmen[0].PreparePutBuffers(snapshotTime_ms);
    this.linesmen[1].PreparePutBuffers(snapshotTime_ms);
  }

  FetchPutBuffers(putTime_ms: number): void {
    this.referee.FetchPutBuffers(putTime_ms);
    this.linesmen[0].FetchPutBuffers(putTime_ms);
    this.linesmen[1].FetchPutBuffers(putTime_ms);
  }

  Put(): void {
    this.referee.Put();
    this.linesmen[0].Put();
    this.linesmen[1].Put();

    const foulType = this.match.GetReferee().GetCurrentFoulType();
    if (this.referee.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Special && (foulType === 2 || foulType === 3)) {
      let bodyPartName = 'right_elbow';
      if (this.referee.GetCurrentAnim()!.anim!.GetName().includes('mirror')) bodyPartName = 'left_elbow';

      const nodeMap = this.referee.GetNodeMap();
      const bodyPart = nodeMap.get(bodyPartName);
      if (bodyPart) {
        const position = bodyPart.GetDerivedPosition().Add(bodyPart.GetDerivedRotation().MulVec(CARD_OFFSET)); // -0.4
        if (foulType === 2) {
          this.yellowCard.SetPosition(position);
          this.yellowCard.SetRotation(bodyPart.GetDerivedRotation());
        } else {
          this.redCard.SetPosition(position);
          this.redCard.SetRotation(bodyPart.GetDerivedRotation());
        }
      }
    } else if (this.referee.GetPreviousFunctionType() === e_FunctionType.e_FunctionType_Special) {
      this.yellowCard.SetPosition(new Vector3(0, 0, -10));
      this.redCard.SetPosition(new Vector3(0, 0, -10));
    }
  }

  GetYellowCardGeom(): Geometry {
    return this.yellowCard;
  }

  GetRedCardGeom(): Geometry {
    return this.redCard;
  }
}
