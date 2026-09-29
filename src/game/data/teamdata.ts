// Port of legacy/src/data/teamdata.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../blunted/base/math/vector3';
import { clamp } from '../../blunted/base/math/bluntmath';
import { Properties } from '../../blunted/base/properties';
import { assert } from '../../blunted/base/assert';
import { GetVectorFromString, atof, int_to_str, real_to_str } from '../../blunted/base/utils';
import { XMLLoader } from '../../blunted/utils/xmlloader';
import { FormationEntry, GetRoleFromString, e_PlayerRole, playerNum } from '../gamedefines';
import { GetDB } from '../globals';
import { PlayerData } from './playerdata';

/** C++ struct TeamTactics (copied by value in C++: use Clone()) */
export class TeamTactics {
  factoryProperties = new Properties();
  userProperties = new Properties();

  humanReadableNames = new Properties();
  descriptions = new Properties();

  Clone(): TeamTactics {
    const t = new TeamTactics();
    t.factoryProperties = this.factoryProperties.Clone();
    t.userProperties = this.userProperties.Clone();
    t.humanReadableNames = this.humanReadableNames.Clone();
    t.descriptions = this.descriptions.Clone();
    return t;
  }
}

export function GetDefaultRolePosition(role: e_PlayerRole): Vector3 {
  switch (role) {
    case e_PlayerRole.e_PlayerRole_GK:
      return new Vector3(-1.0, 0.0, 0);

    case e_PlayerRole.e_PlayerRole_CB:
      return new Vector3(-1.0, 0.0, 0);
    case e_PlayerRole.e_PlayerRole_LB:
      return new Vector3(-0.8, 0.8, 0);
    case e_PlayerRole.e_PlayerRole_RB:
      return new Vector3(-0.8, -0.8, 0);

    case e_PlayerRole.e_PlayerRole_DM:
      return new Vector3(-0.5, 0.0, 0);
    case e_PlayerRole.e_PlayerRole_CM:
      return new Vector3(0.0, 0.0, 0);
    case e_PlayerRole.e_PlayerRole_LM:
      return new Vector3(0.0, 1.0, 0);
    case e_PlayerRole.e_PlayerRole_RM:
      return new Vector3(0.0, -1.0, 0);
    case e_PlayerRole.e_PlayerRole_AM:
      return new Vector3(0.5, 0.0, 0);

    case e_PlayerRole.e_PlayerRole_CF:
      return new Vector3(1.0, 0.0, 0);

    default:
      return new Vector3(0.0, 0.0, 0);
  }
}

const tacticNames: Record<string, [string, string]> = {
  position_offense_depth_factor: ['attacking: team depth', 'how much vertical space the team takes up, during possession'],
  position_defense_depth_factor: ['defending: team depth', 'how much vertical space the team takes up, while defending'],
  position_offense_width_factor: ['attacking: team width', 'horizontal team width during possession'],
  position_defense_width_factor: ['defending: team width', 'horizontal team width while defending'],
  position_offense_midfieldfocus: ['attacking: midfield joins attack', 'lower values: midfield stays back. higher values: midfield joins attack'],
  position_defense_midfieldfocus: ['defending: midfield stays high up', 'lower values: midfield stays back. higher values: midfield stays higher up'],
  position_offense_sidefocus_strength: ['attacking: forward drive', ''],
  position_defense_sidefocus_strength: ['defending: backward drive', ''],
  position_offense_microfocus_strength: ['attacking: compactness around ball', ''],
  position_defense_microfocus_strength: ['defending: compactness around ball', ''],
  dribble_offensiveness: ['CPU player on the ball: offensiveness', 'higher values mean more forward drive for the CPU player in possession.'],
  dribble_centermagnet: ['CPU player on the ball: prefer center', 'lower values: hug the sidelines more often. higher values: prefer dribbling through the middle of the pitch'],
};

export class TeamData {
  protected databaseID: number;

  protected name = '';
  protected shortName = '';
  protected logo_url = '';
  protected kit_url = '';
  protected color1: Vector3 = new Vector3(0);
  protected color2: Vector3 = new Vector3(0);

  protected tactics = new TeamTactics();

  protected formation: FormationEntry[] = [];

  protected playerData: PlayerData[] = [];

  constructor(teamDatabaseID: number) {
    this.databaseID = teamDatabaseID;
    for (let i = 0; i < playerNum; i++) this.formation.push(new FormationEntry());

    // C++: select teams.name, teams.logo_url, teams.kit_url, teams.formation_xml, teams.formation_factory_xml, teams.tactics_xml,
    //      teams.tactics_factory_xml, teams.shortname, teams.color1, teams.color2 from teams, leagues where teams.id = X and leagues.id = teams.league_id limit 1
    const record = GetDB().GetTeam(this.databaseID);

    this.color1 = new Vector3(0, 0, 0);
    this.color2 = new Vector3(255, 255, 255);

    // PORT: the C++ read a "national" column that its query never selected, so national was always false
    const national = false;

    this.name = String(record.name ?? '');
    this.logo_url = String(record.logo_url ?? '');
    this.kit_url = String(record.kit_url ?? '');
    const formationString = String(record.formation_xml ?? '');
    const tacticsString = String(record.tactics_xml ?? '');
    const factoryTacticsString = String(record.tactics_factory_xml ?? '');
    this.shortName = String(record.shortname ?? '');
    this.color1 = GetVectorFromString(String(record.color1 ?? ''));
    this.color2 = GetVectorFromString(String(record.color2 ?? ''));

    if (this.shortName === '') {
      this.shortName = this.name.replace(/[ \t\n\v\f\r]/g, '');
      this.shortName = this.shortName.substring(0, 3).toUpperCase();
    }

    this.logo_url = 'databases/default/' + this.logo_url;
    this.kit_url = 'databases/default/' + this.kit_url;

    // team formation

    const loader = new XMLLoader();
    let tree = loader.Load(formationString);

    for (const [tag, child] of tree.children) {
      for (let num = 0; num < playerNum; num++) {
        if (tag === 'p' + int_to_str(num + 1)) {
          const entry = this.formation[num];
          entry.databasePosition = GetVectorFromString(child.Find('position')!.value);
          entry.role = GetRoleFromString(child.Find('role')!.value);

          // combine custom positions with hardcoded formation positions belonging to certain roles.
          // this way, more extreme user formation settings are 'normalized' somewhat.
          entry.position = entry.databasePosition.Mul(0.6).Add(GetDefaultRolePosition(entry.role).Mul(0.4));
        }
      }
    }

    // make sure players have some personal space, don't step in each other's aura ;)
    const minDistanceFraction = 0.5; // remember the range is 2 (-1 to 1)
    const maxIterations = 10;
    let iterations = 0;
    let changed = true;

    while (changed && iterations < maxIterations) {
      const offset: Vector3[] = [];
      for (let p = 0; p < playerNum; p++) offset.push(new Vector3(0));

      changed = false;
      for (let p1 = 0; p1 < playerNum - 1; p1++) {
        if (this.formation[p1].role === e_PlayerRole.e_PlayerRole_GK) continue;

        for (let p2 = p1 + 1; p2 < playerNum; p2++) {
          if (this.formation[p2].role === e_PlayerRole.e_PlayerRole_GK) continue;

          const diff = this.formation[p1].position.Sub(this.formation[p2].position);

          if (diff.GetLength() < minDistanceFraction) {
            changed = true;

            const distanceFactor = 1.0 - diff.GetLength() / minDistanceFraction;

            offset[p1] = offset[p1].Add(diff.GetNormalized(new Vector3(0, 1, 0)).Mul(minDistanceFraction * distanceFactor * 0.5));
            offset[p2] = offset[p2].Sub(diff.GetNormalized(new Vector3(0, 1, 0)).Mul(minDistanceFraction * distanceFactor * 0.5));
          }
        }
      }

      if (changed) {
        for (let p = 0; p < playerNum; p++) {
          let position = this.formation[p].position.Add(offset[p]);
          position = position.WithCoord(0, clamp(position.coords[0], -1, 1));
          position = position.WithCoord(1, clamp(position.coords[1], -1, 1));
          this.formation[p].position = position;
        }
      }

      iterations++;
    }

    // team tactics

    tree = loader.Load(tacticsString);

    for (const [tacticName, child] of tree.children) {
      this.tactics.userProperties.Set(tacticName, atof(child.value));

      const names = Object.prototype.hasOwnProperty.call(tacticNames, tacticName) ? tacticNames[tacticName] : undefined;
      if (names !== undefined) {
        this.tactics.humanReadableNames.Set(tacticName, names[0]);
        this.tactics.descriptions.Set(tacticName, names[1]);
      }
    }

    // factory tactics

    tree = loader.Load(factoryTacticsString);

    for (const [tacticName, child] of tree.children) {
      this.tactics.factoryProperties.Set(tacticName, atof(child.value));
    }

    // load players

    // C++: select id from players where team_id = X or nationalteam_id = X order by formationorder (or the national order)
    const playerIDs = GetDB().GetTeamPlayerIDs(teamDatabaseID, national);
    for (let r = 0; r < playerIDs.length; r++) {
      const onePlayerData = new PlayerData(playerIDs[r]);
      this.playerData.push(onePlayerData);
    }
  }

  GetName(): string {
    return this.name;
  }

  GetShortName(): string {
    return this.shortName;
  }

  GetLogoUrl(): string {
    return this.logo_url;
  }

  GetKitUrl(): string {
    return this.kit_url;
  }

  GetColor1(): Vector3 {
    return this.color1;
  }

  GetColor2(): Vector3 {
    return this.color2;
  }

  GetDatabaseID(): number {
    return this.databaseID;
  }

  /** C++ returns a const reference: do not modify */
  GetTactics(): TeamTactics {
    return this.tactics;
  }

  GetTacticsWritable(): TeamTactics {
    return this.tactics;
  }

  /** returns a copy (C++ returned the struct by value) */
  GetFormationEntry(num: number): FormationEntry {
    assert(num >= 0 && num < playerNum);
    return this.formation[num].Clone();
  }

  SetFormationEntry(num: number, entry: FormationEntry): void {
    this.formation[num] = entry.Clone();
  }

  SwitchPlayers(databaseID1: number, databaseID2: number): void {
    let index1 = -1;
    let index2 = -1;
    for (let i = 0; i < this.playerData.length; i++) {
      if (this.playerData[i].GetDatabaseID() === databaseID1) index1 = i;
      if (this.playerData[i].GetDatabaseID() === databaseID2) index2 = i;
    }
    assert(index1 !== -1);
    assert(index2 !== -1);
    const tmp = this.playerData[index1];
    this.playerData[index1] = this.playerData[index2];
    this.playerData[index2] = tmp;
  }

  /** vector index# is entry in formation[index#]. C++ overloads GetPlayerData() / GetPlayerData(int num) */
  GetPlayerData(): PlayerData[];
  GetPlayerData(num: number): PlayerData;
  GetPlayerData(num?: number): PlayerData[] | PlayerData {
    if (num === undefined) return this.playerData;
    return this.playerData[num];
  }

  GetPlayerNum(): number {
    return this.playerData.length;
  }

  GetPlayerDataByDatabaseID(id: number): PlayerData {
    let index = -1;
    for (let i = 0; i < this.playerData.length; i++) {
      if (this.playerData[i].GetDatabaseID() === id) {
        index = i;
        break;
      }
    }
    assert(index !== -1);
    return this.playerData[index];
  }

  SaveLineup(): void {}

  SaveTactics(): void {
    const userPropMap = this.tactics.userProperties.GetProperties();

    let tactics_xml = '';
    for (const tacticName of userPropMap.keys()) {
      tactics_xml += '<' + tacticName + '>' + real_to_str(this.tactics.userProperties.GetReal(tacticName)) + '</' + tacticName + '>\n';
    }

    // C++: update teams set tactics_xml = "..." where id = X;
    GetDB().SetTeamTactics(this.GetDatabaseID(), tactics_xml);
  }

  Save(): void {
    this.SaveLineup();
    this.SaveTactics();
  }
}
