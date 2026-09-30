// Tests for the team AI port: libhungarian, pure AIfunctions helpers, MentalImage and the career player lock.
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../src/blunted/base/math/vector3';
import { Properties } from '../src/blunted/base/properties';
import { Node } from '../src/blunted/scene/node';
import {
  HUNGARIAN_ASSIGNED,
  HUNGARIAN_MODE_MINIMIZE_COST,
  array_to_matrix,
  hungarian_init,
  hungarian_problem_t,
  hungarian_solve,
} from '../src/game/misc/hungarian';
import {
  AI_CalculatePassingOdds,
  AI_GetAutoPass,
  AI_GetClosestPlayers,
  AI_GetForceFieldMovement,
  AI_GetMindSet,
  AI_GetTimeNeededForDistance_ms,
} from '../src/game/onthepitch/AIsupport/AIfunctions';
import { MentalImage } from '../src/game/onthepitch/AIsupport/mentalimage';
import { Team } from '../src/game/onthepitch/team';
import {
  FormationEntry,
  ForceSpot,
  PlayerImage,
  ballPredictionSize_ms,
  e_DecayType,
  e_FunctionType,
  e_MagnetType,
  e_MatchPhase,
  e_PlayerRole,
  sprintVelocity,
} from '../src/game/gamedefines';
import type { Match } from '../src/game/onthepitch/match';
import type { Player } from '../src/game/onthepitch/player/player';
import type { TeamData } from '../src/game/data/teamdata';

// deterministic pseudo random numbers for the tests
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function bruteForceMinCost(cost: number[][]): number {
  const n = cost.length;
  let best = Infinity;
  const used = new Array(n).fill(false);
  const rec = (row: number, sum: number) => {
    if (sum >= best) return;
    if (row === n) {
      best = sum;
      return;
    }
    for (let c = 0; c < n; c++) {
      if (!used[c]) {
        used[c] = true;
        rec(row + 1, sum + cost[row][c]);
        used[c] = false;
      }
    }
  };
  rec(0, 0);
  return best;
}

describe('hungarian', () => {
  it('solves a known 3x3 assignment', () => {
    const p = new hungarian_problem_t();
    const m = array_to_matrix([4, 1, 3, 2, 0, 5, 3, 2, 2], 3, 3);
    hungarian_init(p, m, 3, 3, HUNGARIAN_MODE_MINIMIZE_COST);
    expect(hungarian_solve(p)).toBe(5); // 1 + 2 + 2
    expect(p.assignment[0][1]).toBe(HUNGARIAN_ASSIGNED);
    expect(p.assignment[1][0]).toBe(HUNGARIAN_ASSIGNED);
    expect(p.assignment[2][2]).toBe(HUNGARIAN_ASSIGNED);
  });

  it('matches brute force on random matrices (incl. the 50000 "forbidden" cost used by the team AI)', () => {
    const rnd = lcg(12345);
    for (let trial = 0; trial < 60; trial++) {
      const n = 1 + (trial % 6);
      const flat: number[] = [];
      for (let i = 0; i < n * n; i++) flat.push(rnd() < 0.2 ? 50000 : Math.floor(rnd() * 400));
      const cost = array_to_matrix(flat, n, n);
      const p = new hungarian_problem_t();
      hungarian_init(p, cost, n, n, HUNGARIAN_MODE_MINIMIZE_COST);
      const total = hungarian_solve(p);
      expect(total).toBe(bruteForceMinCost(cost));
      // a valid permutation whose cost is the total
      let sum = 0;
      for (let r = 0; r < n; r++) {
        let count = 0;
        for (let c = 0; c < n; c++) {
          if (p.assignment[r][c] === HUNGARIAN_ASSIGNED) {
            count++;
            sum += cost[r][c];
          }
        }
        expect(count).toBe(1);
      }
      expect(sum).toBe(total);
    }
  });
});

describe('AIfunctions', () => {
  it('maps roles to mindsets', () => {
    expect(AI_GetMindSet(e_PlayerRole.e_PlayerRole_GK)).toBe(0.0);
    expect(AI_GetMindSet(e_PlayerRole.e_PlayerRole_LB)).toBe(0.25);
    expect(AI_GetMindSet(e_PlayerRole.e_PlayerRole_CM)).toBe(0.5);
    expect(AI_GetMindSet(e_PlayerRole.e_PlayerRole_AM)).toBe(0.75);
    expect(AI_GetMindSet(e_PlayerRole.e_PlayerRole_CF)).toBe(1.0);
  });

  it('estimates time needed for far targets with the optimized formula', () => {
    const t = AI_GetTimeNeededForDistance_ms(new Vector3(0), new Vector3(0), new Vector3(30, 0, 0), sprintVelocity);
    expect(t.usual_ms).toBe(Math.round((30 / (sprintVelocity * 0.75)) * 1000));
    expect(t.optimistic_ms).toBe(t.usual_ms - 200);
  });

  it('estimates time needed for near targets by simulation', () => {
    const near = AI_GetTimeNeededForDistance_ms(new Vector3(0), new Vector3(0), new Vector3(0.1, 0, 0), sprintVelocity, true);
    expect(near.usual_ms).toBeLessThanOrEqual(10);
    let previous = -1;
    for (let d = 1; d < 40; d += 3) {
      const t = AI_GetTimeNeededForDistance_ms(new Vector3(0), new Vector3(0), new Vector3(d, 0, 0), sprintVelocity, true);
      expect(t.usual_ms).toBeGreaterThanOrEqual(previous);
      expect(t.optimistic_ms).toBeLessThanOrEqual(t.usual_ms);
      previous = t.usual_ms;
    }
    // running towards the target helps
    const still = AI_GetTimeNeededForDistance_ms(new Vector3(0), new Vector3(0), new Vector3(10, 0, 0), sprintVelocity, true);
    const running = AI_GetTimeNeededForDistance_ms(new Vector3(0), new Vector3(sprintVelocity, 0, 0), new Vector3(10, 0, 0), sprintVelocity, true);
    expect(running.usual_ms).toBeLessThan(still.usual_ms);
    // maxTime_ms cuts the simulation short
    const capped = AI_GetTimeNeededForDistance_ms(new Vector3(0), new Vector3(0), new Vector3(10, 0, 0), sprintVelocity, true, 100);
    expect(capped.usual_ms).toBeGreaterThan(100);
  });

  it('sums force fields', () => {
    const attract = new ForceSpot();
    attract.origin = new Vector3(20, 0, 0);
    attract.magnetType = e_MagnetType.e_MagnetType_Attract;
    attract.decayType = e_DecayType.e_DecayType_Constant;
    attract.power = 1.0;
    const m = AI_GetForceFieldMovement([attract], new Vector3(0));
    expect(m.coords[0]).toBeCloseTo(sprintVelocity);
    expect(m.coords[1]).toBeCloseTo(0);

    const repel = new ForceSpot();
    repel.origin = new Vector3(0, 2, 0);
    repel.magnetType = e_MagnetType.e_MagnetType_Repel;
    repel.decayType = e_DecayType.e_DecayType_Variable;
    repel.power = 1.0;
    repel.scale = 10.0;
    const r = AI_GetForceFieldMovement([repel], new Vector3(0));
    expect(r.coords[1]).toBeCloseTo(-sprintVelocity);
    expect(AI_GetForceFieldMovement([], new Vector3(0)).Equals(new Vector3(0))).toBe(true);
  });

  it('computes auto passes', () => {
    const { resultingDirection, resultingPower } = AI_GetAutoPass(e_FunctionType.e_FunctionType_ShortPass, new Vector3(30, 0, 0));
    expect(resultingDirection.GetLength()).toBeCloseTo(1);
    expect(resultingDirection.coords[2]).toBeGreaterThan(0);
    expect(resultingPower).toBeCloseTo(Math.pow(0.5, 1.4) * 1.8);
  });

  it('rates passing odds', () => {
    const match = {} as Match;
    expect(AI_CalculatePassingOdds(match, new Vector3(0), new Vector3(20, 0, 0), [])).toBe(1);
    const opp = new PlayerImage();
    opp.position = new Vector3(10, 0, 0);
    expect(AI_CalculatePassingOdds(match, new Vector3(0), new Vector3(20, 0, 0), [opp])).toBeCloseTo(0, 1);
    opp.position = new Vector3(10, 30, 0);
    expect(AI_CalculatePassingOdds(match, new Vector3(0), new Vector3(20, 0, 0), [opp])).toBe(1);
  });
});

// ----- fakes

class FakePlayer {
  formationEntry = new FormationEntry();
  dynamicFormationEntry = new FormationEntry();
  active = true;
  constructor(
    public id: number,
    public teamID: number,
    public position: Vector3,
    public movement: Vector3 = new Vector3(0),
  ) {}
  GetID(): number { return this.id; }
  GetTeamID(): number { return this.teamID; }
  GetTeam(): { GetSide(): number } { return { GetSide: () => (this.teamID === 0 ? -1 : 1) }; }
  IsActive(): boolean { return this.active; }
  GetPosition(): Vector3 { return this.position; }
  GetMovement(): Vector3 { return this.movement; }
  GetDirectionVec(): Vector3 { return new Vector3(1, 0, 0); }
  GetBodyDirectionVec(): Vector3 { return new Vector3(1, 0, 0); }
  GetFloatVelocity(): number { return 0; }
  GetFormationEntry(): FormationEntry { return this.formationEntry; }
  GetDynamicFormationEntry(): FormationEntry { return this.dynamicFormationEntry; }
}

class FakeBall {
  predictions: Vector3[] = [];
  constructor() {
    for (let i = 0; i < ballPredictionSize_ms / 10; i++) this.predictions.push(new Vector3(i * 0.1, 0, 0));
  }
  Predict(t: number): Vector3 {
    let index = Math.trunc(t);
    if (index < 0 || index >= ballPredictionSize_ms) index = ballPredictionSize_ms - 10;
    return this.predictions[Math.trunc(index / 10)];
  }
  GetPredictionArray(target: Vector3[]): void {
    for (let i = 0; i < this.predictions.length; i++) target[i] = this.predictions[i];
  }
}

describe('MentalImage', () => {
  const players = [
    new FakePlayer(0, 0, new Vector3(-10, 0, 0), new Vector3(2, 0, 0)),
    new FakePlayer(1, 0, new Vector3(-5, 5, 0)),
    new FakePlayer(2, 1, new Vector3(10, 0, 0)),
  ];
  const ball = new FakeBall();
  const teams = [0, 1].map((t) => ({
    GetActivePlayers: (out: FakePlayer[]) => {
      for (const p of players) if (p.teamID === t && p.IsActive()) out.push(p);
      return out;
    },
  }));
  const match = { GetTeam: (id: number) => teams[id], GetBall: () => ball } as unknown as Match;

  it('snapshots players and returns extrapolated fresh copies', () => {
    const image = new MentalImage(match);
    image.TakeSnapshot();
    image.SetTimeStampNeg_ms(500);
    const img = image.GetPlayerImage(0);
    expect(img.position.coords[0]).toBeCloseTo(-9); // -10 + 2 m/s * 0.5 s
    img.position = new Vector3(100, 100, 0);
    img.formationEntry.role = e_PlayerRole.e_PlayerRole_CF;
    const again = image.GetPlayerImage(0);
    expect(again.position.coords[0]).toBeCloseTo(-9);
    expect(again.formationEntry.role).toBe(e_PlayerRole.e_PlayerRole_CM);

    // reality moved away: the image stays within maxDistanceDeviation (2.5m) of the real position
    players[0].position = new Vector3(-20, 0, 0);
    expect(image.GetPlayerImage(0).position.coords[0]).toBeCloseTo(-17.5);
    players[0].position = new Vector3(-10, 0, 0);
  });

  it('filters team images', () => {
    const image = new MentalImage(match);
    image.TakeSnapshot();
    const out: PlayerImage[] = [];
    image.GetTeamPlayerImages(0, 1, out);
    expect(out.map((i) => i.playerID)).toEqual([0]);
    players[2].active = false;
    const opp: PlayerImage[] = [];
    image.GetTeamPlayerImages(1, -1, opp);
    expect(opp.length).toBe(0);
    players[2].active = true;
  });

  it('reads ball predictions with the reaction time offset', () => {
    const image = new MentalImage(match);
    image.TakeSnapshot();
    image.SetTimeStampNeg_ms(100);
    expect(image.GetBallPrediction(200).coords[0]).toBeCloseTo(3.0); // index (200 + 100) / 10
    expect(image.GetBallPrediction(5000).coords[0]).toBeCloseTo(29.9); // clamped to the last prediction
  });
});

// ----- team (career lock) with fake players and gamers

class FakeGamer {
  selected: FakePlayer | null = null;
  constructor(protected team: Team) {}
  GetSelectedPlayerID(): number { return this.selected ? this.selected.GetID() : -1; }
  SetSelectedPlayerID(id: number): void {
    this.selected = id === -1 ? null : (this.team.GetPlayer(id) as unknown as FakePlayer);
  }
}

function MakeTeam(): { team: Team; players: FakePlayer[]; gamers: FakeGamer[]; state: { inPlay: boolean } } {
  const state = { inPlay: true };
  const ball = new FakeBall();
  const match = {
    GetDynamicNode: () => new Node('dynamic'),
    GetMatchData: () => ({ GetGoalCount: () => 0, GetPossessionFactor_60seconds: () => 0.5 }),
    GetMatchTime_ms: () => 0,
    GetMatchPhase: () => e_MatchPhase.e_MatchPhase_1stHalf,
    IsInPlay: () => state.inPlay,
    GetBall: () => ball,
  } as unknown as Match;
  const teamData = {
    GetPlayerNum: () => 11,
    GetTactics: () => ({ userProperties: new Properties(), factoryProperties: new Properties() }),
  } as unknown as TeamData;
  const team = new Team(0, match, teamData);
  const players: FakePlayer[] = [];
  for (let i = 0; i < 11; i++) players.push(new FakePlayer(100 + i, 0, new Vector3(i * 3, 0, 0)));
  const internals = team as unknown as { players: Player[]; humanGamers: FakeGamer[]; switchPriority: number[]; designatedTeamPossessionPlayer: Player };
  internals.players = players as unknown as Player[];
  internals.designatedTeamPossessionPlayer = players[0] as unknown as Player;
  const gamers = [new FakeGamer(team)];
  internals.humanGamers = gamers;
  internals.switchPriority = [0];
  return { team, players, gamers, state };
}

describe('Team career lock', () => {
  it('behaves as the original without a lock', () => {
    const { team, players, gamers } = MakeTeam();
    expect(team.GetLockedHumanPlayer()).toBe(-1);
    team.HumanGamersSelectAnyone();
    expect(gamers[0].GetSelectedPlayerID()).toBe(100); // closest to the ball at the origin
    team.SelectPlayer(players[5] as unknown as Player);
    expect(gamers[0].GetSelectedPlayerID()).toBe(105);
    const closest: Player[] = [];
    AI_GetClosestPlayers(team, new Vector3(0), true, closest, 2);
    expect(closest.map((p) => p.GetID())).toEqual([100, 101]); // 105 is human controlled
  });

  it('keeps the gamer on the locked player', () => {
    const { team, players, gamers, state } = MakeTeam();
    team.SetLockedHumanPlayer(107);
    expect(team.GetLockedHumanPlayer()).toBe(107);
    team.HumanGamersSelectAnyone();
    expect(gamers[0].GetSelectedPlayerID()).toBe(107);
    // automatic switching (pass receiver / possession player) skips the locked gamer
    team.SelectPlayer(players[2] as unknown as Player);
    expect(gamers[0].GetSelectedPlayerID()).toBe(107);
    expect(team.GetDesignatedTeamPossessionPlayer()).toBe(players[2] as unknown as Player);
    // out of play nobody is selected, back in play he is attached again
    gamers[0].SetSelectedPlayerID(-1);
    state.inPlay = true;
    team.HumanGamersSelectAnyone();
    expect(gamers[0].GetSelectedPlayerID()).toBe(107);
  });

  it('falls back to normal behaviour when the locked player is not active', () => {
    const { team, players, gamers } = MakeTeam();
    team.SetLockedHumanPlayer(107);
    team.HumanGamersSelectAnyone();
    team.DeselectPlayer(players[7] as unknown as Player);
    players[7].active = false;
    expect(gamers[0].GetSelectedPlayerID()).not.toBe(107);
    team.SelectPlayer(players[3] as unknown as Player);
    expect(gamers[0].GetSelectedPlayerID()).toBe(103);
    // active again (e.g. brought back on): locked again
    players[7].active = true;
    team.HumanGamersSelectAnyone();
    expect(gamers[0].GetSelectedPlayerID()).toBe(107);
  });
});
