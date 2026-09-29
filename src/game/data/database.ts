// Replacement for utils/database (SQLite). The original game queried SQL; the port keeps the same
// tables as plain in-memory records loaded from databases/default/database.json (generated from the
// original database.sqlite by scripts/convert-database.py).
//
// The database is mutable: career mode registers generated clubs and players here so the match
// engine can load them through the regular TeamData/PlayerData path.

import { FileSystem } from '../../blunted/managers/filesystem';

export interface RegionRecord {
  id: number;
  name: string;
}

export interface CountryRecord {
  id: number;
  region_id: number;
  name: string;
}

export interface LeagueRecord {
  id: number;
  country_id: number;
  name: string;
  logo_url: string;
}

export interface TeamRecord {
  id: number;
  league_id: number;
  name: string;
  logo_url: string;
  /** base path of the kit textures: `${kit_url}_kit_01.png` etc (relative to databases/default/) */
  kit_url: string;
  formation_xml: string;
  formation_factory_xml: string;
  tactics_xml: string;
  tactics_factory_xml: string;
  shortname: string;
  /** "r, g, b" */
  color1: string;
  color2: string;
  national?: number;
}

export interface PlayerRecord {
  id: number;
  team_id: number;
  nationalteam_id: number;
  firstname: string;
  lastname: string;
  /** Football-Manager style position string, e.g. "D/WB L, DM" */
  role: string;
  age: number;
  base_stat: number;
  /** <physical_balance>0.66</physical_balance>... relative skill distribution (averages ~0.5) */
  profile_xml: string;
  skincolor: number;
  hairstyle: string;
  haircolor: string;
  height: number;
  weight: number;
  formationorder: number;
  nationalteamformationorder: number;
}

export interface DatabaseTables {
  regions: RegionRecord[];
  countries: CountryRecord[];
  leagues: LeagueRecord[];
  teams: TeamRecord[];
  players: PlayerRecord[];
}

export class Database {
  regions: RegionRecord[] = [];
  countries: CountryRecord[] = [];
  leagues: LeagueRecord[] = [];
  teams: TeamRecord[] = [];
  players: PlayerRecord[] = [];

  static FromTables(tables: DatabaseTables): Database {
    const db = new Database();
    db.regions = tables.regions.map((r) => ({ ...r }));
    db.countries = tables.countries.map((r) => ({ ...r }));
    db.leagues = tables.leagues.map((r) => ({ ...r }));
    db.teams = tables.teams.map((r) => ({ ...r }));
    db.players = tables.players.map((r) => ({ ...r }));
    return db;
  }

  /** loads databases/default/database.json (must be preloaded or readable through FileSystem) */
  static LoadDefault(): Database {
    const json = JSON.parse(FileSystem.GetText('databases/default/database.json')) as DatabaseTables;
    return Database.FromTables(json);
  }

  GetTeam(id: number): TeamRecord {
    const team = this.teams.find((t) => t.id === id);
    if (!team) throw new Error(`team ${id} not in database`);
    return team;
  }

  GetPlayer(id: number): PlayerRecord {
    const player = this.players.find((p) => p.id === id);
    if (!player) throw new Error(`player ${id} not in database`);
    return player;
  }

  /** C++: select id from players where team_id = X or nationalteam_id = X order by formationorder */
  GetTeamPlayerIDs(teamID: number, national = false): number[] {
    const order = national ? 'nationalteamformationorder' : 'formationorder';
    return this.players
      .filter((p) => p.team_id === teamID || p.nationalteam_id === teamID)
      .sort((a, b) => a[order] - b[order])
      .map((p) => p.id);
  }

  NextTeamID(): number {
    return this.teams.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  }

  NextPlayerID(): number {
    return this.players.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  }

  UpsertTeam(team: TeamRecord): void {
    const i = this.teams.findIndex((t) => t.id === team.id);
    if (i >= 0) this.teams[i] = team;
    else this.teams.push(team);
  }

  UpsertPlayer(player: PlayerRecord): void {
    const i = this.players.findIndex((p) => p.id === player.id);
    if (i >= 0) this.players[i] = player;
    else this.players.push(player);
  }

  RemovePlayer(id: number): void {
    this.players = this.players.filter((p) => p.id !== id);
  }

  /** C++ TeamData::SaveTactics: update teams set tactics_xml = ... */
  SetTeamTactics(teamID: number, tactics_xml: string): void {
    this.GetTeam(teamID).tactics_xml = tactics_xml;
  }
}
