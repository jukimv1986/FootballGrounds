// Port of legacy/src/data/matchdata.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { TeamData } from './teamdata';

export class MatchData {
  protected teamData: [TeamData, TeamData];

  protected goalCount: [number, number] = [0, 0];

  protected possessionTime_ms: [number, number] = [0, 0];
  /** -600 to 600 for possession of team 1 / 2 respectively */
  protected possession60seconds = 0.0;
  protected shots: [number, number] = [0, 0];

  constructor(team1DatabaseID: number, team2DatabaseID: number) {
    this.teamData = [new TeamData(team1DatabaseID), new TeamData(team2DatabaseID)];

    this.goalCount[0] = 0;
    this.goalCount[1] = 0;

    this.possessionTime_ms[0] = 0;
    this.possessionTime_ms[1] = 0;

    this.shots[0] = 0;
    this.shots[1] = 0;

    this.possession60seconds = 0.0;
  }

  GetTeamData(id: number): TeamData {
    return this.teamData[id];
  }

  GetGoalCount(id: number): number {
    return this.goalCount[id];
  }

  SetGoalCount(id: number, amount: number): void {
    this.goalCount[id] = amount;
  }

  AddPossessionTime_10ms(teamID: number): void {
    this.possessionTime_ms[teamID] += 10;
    if (teamID === 0) this.possession60seconds = Math.max(this.possession60seconds - 0.01, -60.0);
    else if (teamID === 1) this.possession60seconds = Math.min(this.possession60seconds + 0.01, 60.0);
  }

  GetPossessionTime_ms(teamID: number): number {
    return this.possessionTime_ms[teamID];
  }

  /** REMEMBER THESE ARE IRL INGAME SECONDS (because, I guess the tactics should be based on irl possession time instead of gametime? not sure yet, think about this) */
  GetPossessionFactor_60seconds(): number {
    return (this.possession60seconds / 60.0) * 0.5 + 0.5;
  }

  AddShot(teamID: number): void {
    this.shots[teamID] += 1;
  }

  GetShots(teamID: number): number {
    return this.shots[teamID];
  }
}
