import { describe, expect, it } from 'vitest';
import { STAT_COUNT, calculateStat, engineAgeMultiplier, engineRecordFor, engineStatsFromRecord, ovrFromStatArray, parseProfileXml, positionFromRoleString, statsToArray } from '../src/career/core/attributes';
import { Rng } from '../src/career/core/rng';
import { newCareer, advanceToNextMatch, pendingMatchContext } from '../src/career/core/career';
import { Database } from '../src/game/data/database';
import { CAREER_PLAYER_BASE, CAREER_TEAM_IDS, registerMatch, resultToOutcome, unregisterCareer } from '../src/career/engine/bridge';
import { USER_ID } from '../src/career/core/selection';
import { npcStats } from '../src/career/core/players';
import { npc } from '../src/career/core/index';
import { autoResolveStop } from '../src/career/core/autoplay';
import { defaultInput, loadTables } from './careerhelpers';

const tables = loadTables();

describe('CalculateStat and its inverse', () => {
  it('matches the original formula', () => {
    // legacy/src/utils.cpp: at the ideal age (27) the multiplier is 1.2
    expect(engineAgeMultiplier(27)).toBeCloseTo(1.2, 6);
    expect(calculateStat(0.6, 0.5, 27)).toBeCloseTo(0.72, 6);
    expect(calculateStat(0.9, 0.9, 27)).toBe(1);
    expect(calculateStat(0.1, 0.01, 27)).toBe(0.01);
    expect(engineAgeMultiplier(15)).toBeLessThan(engineAgeMultiplier(21));
    expect(engineAgeMultiplier(40)).toBeCloseTo(engineAgeMultiplier(14), 6);
  });

  it('reproduces arbitrary attributes at any age', () => {
    const rng = new Rng(9);
    for (const age of [15, 17.5, 22, 27, 31, 34, 39]) {
      for (let k = 0; k < 20; k++) {
        const stats = Array.from({ length: STAT_COUNT }, () => rng.range(0.02, 1));
        const rec = engineRecordFor(stats, age);
        const back = engineStatsFromRecord(rec.base_stat, parseProfileXml(rec.profile_xml), age);
        for (let i = 0; i < STAT_COUNT; i++) expect(Math.abs(back[i] - stats[i])).toBeLessThan(2e-5);
      }
    }
  });

  it('rates the shipped database players on a familiar scale', () => {
    const ratings = tables.players.map((p) => ovrFromStatArray(engineStatsFromRecord(p.base_stat, parseProfileXml(p.profile_xml), 27), positionFromRoleString(p.role)));
    expect(Math.min(...ratings)).toBeGreaterThan(60);
    expect(Math.max(...ratings)).toBeLessThan(95);
  });
});

describe('3D match registration', () => {
  const state = newCareer(defaultInput({ age: 16 }), { seed: 4242, db: tables });
  // play until the user has a match day (auto-resolving anything else)
  let guard = 0;
  while (!state.pendingMatch && guard++ < 200) {
    const r = advanceToNextMatch(state, 30);
    if (r !== 'match' && r !== 'none') autoResolveStop(state, r);
  }

  it('registers both sides with the user in his XI slot and exact stats', () => {
    const ctx = pendingMatchContext(state)!;
    expect(ctx).not.toBeNull();
    const db = Database.FromTables(tables);
    const before = db.players.length;
    const reg = registerMatch(state, ctx, db);
    for (const side of [0, 1] as const) {
      const team = db.GetTeam(CAREER_TEAM_IDS[side]);
      expect(team.formation_xml).toContain('<p11>');
      const ids = db.GetTeamPlayerIDs(CAREER_TEAM_IDS[side]);
      expect(ids.length).toBe(ctx.lineups[side].starters.length + ctx.lineups[side].bench.length);
    }
    for (const p of reg.players) {
      const rec = db.GetPlayer(p.engineId);
      const engine = engineStatsFromRecord(rec.base_stat, parseProfileXml(rec.profile_xml), rec.age);
      // the engine truncates the age and the record is built for that integer age: exact reproduction
      const want = p.careerId === USER_ID ? statsToArray(state.user.stats) : p.careerId >= 0 ? npcStats(npc(state, p.careerId)!) : null;
      if (!want) continue;
      for (let i = 0; i < STAT_COUNT; i++) expect(Math.abs(engine[i] - Math.max(0.01, want[i]))).toBeLessThan(2e-5);
    }
    if (ctx.role === 'start') {
      expect(reg.userEngineId).not.toBeNull();
      const userRec = db.GetPlayer(reg.userEngineId!);
      const slot = ctx.lineups[ctx.side].starters.findIndex((e) => e.npcId === USER_ID);
      expect(userRec.formationorder).toBe(slot);
      expect(userRec.team_id).toBe(CAREER_TEAM_IDS[ctx.side]);
    }
    // a fake engine result converts back into an outcome
    const out = resultToOutcome(state, ctx, reg, {
      homeGoals: 2,
      awayGoals: 1,
      abandoned: false,
      events: [{ type: 'goal', minute: 12, teamID: 0, playerDatabaseID: reg.players.find((p) => p.side === 0)!.engineId }],
      playerStats: reg.players.map((p) => ({ playerDatabaseID: p.engineId, teamID: p.side, minutesPlayed: 90, goals: 0, assists: 0, shots: 1, shotsOnTarget: 1, passes: 30, passesCompleted: 25, tackles: 2, fouls: 1, yellowCards: 0, redCards: 0, touches: 50, rating: 6.8 })),
    });
    expect(out.hg).toBe(2);
    expect(out.events[0].type).toBe('goal');
    expect(out.lines.length).toBeGreaterThan(15);
    unregisterCareer(db);
    expect(db.players.length).toBe(before);
    expect(db.players.every((p) => p.id < CAREER_PLAYER_BASE)).toBe(true);
    expect(db.teams.some((t) => CAREER_TEAM_IDS.includes(t.id))).toBe(false);
  });
});
