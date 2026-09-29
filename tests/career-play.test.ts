// PLAY (3D) result conversion: a fake engine MatchResult goes through the same path the real
// 3D match uses (registration -> MatchResult -> MatchOutcome -> career state).
import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../src/app/matchsession';
import { Database } from '../src/game/data/database';
import { newCareer, pendingMatchContext } from '../src/career/core/career';
import { needsWinner, tieWinner } from '../src/career/core/competitions';
import { fixture } from '../src/career/core/index';
import { DEBUG_FORCE_START, USER_ID } from '../src/career/core/selection';
import { registerMatch, resultToOutcome, unregisterCareer, type Registration } from '../src/career/engine/bridge';
import { applyEngineResult } from '../src/career/engine/play';
import type { CareerState, Fixture } from '../src/career/core/types';
import { defaultInput, loadTables } from './careerhelpers';

const tables = loadTables();

/** a career whose user starts the given fixture of his club (first team or cup) */
function setup(pick: (s: CareerState) => Fixture | undefined, clubId = 10): { state: CareerState; reg: Registration; db: Database; f: Fixture } {
  const state = newCareer(defaultInput({ clubId, talent: 'wonderkid' }), { seed: 99, db: tables });
  state.events.flags[DEBUG_FORCE_START] = 1;
  const f = pick(state)!;
  expect(f).toBeDefined();
  state.day = f.day;
  state.slot = f.slot;
  state.pendingMatch = { fixtureId: f.id, role: 'start', lineupPos: state.user.pos };
  const ctx = pendingMatchContext(state)!;
  expect(ctx.role).toBe('start');
  const db = Database.FromTables(tables);
  const reg = registerMatch(state, ctx, db);
  expect(reg.userEngineId).not.toBeNull();
  return { state, reg, db, f };
}

function fakeResult(reg: Registration, hg: number, ag: number, opts: { abandoned?: boolean; minutes?: number; userGoals?: number } = {}): MatchResult {
  const minutes = opts.minutes ?? 90;
  const userSide = reg.players.find((p) => p.engineId === reg.userEngineId)!.side;
  const scorers = (side: 0 | 1, n: number) => {
    const pool = reg.players.filter((p) => p.side === side && p.starter && p.pos !== 'GK' && p.engineId !== reg.userEngineId);
    return Array.from({ length: n }, (_, i) => pool[i % pool.length].engineId);
  };
  const userGoals = Math.min(opts.userGoals ?? 0, userSide === 0 ? hg : ag);
  const events: MatchResult['events'] = [];
  for (const side of [0, 1] as const) {
    const total = side === 0 ? hg : ag;
    const mine = side === userSide ? userGoals : 0;
    for (let i = 0; i < mine; i++) events.push({ type: 'goal', minute: 10 + i * 7, teamID: side, playerDatabaseID: reg.userEngineId! });
    for (const id of scorers(side, total - mine)) events.push({ type: 'goal', minute: 30 + events.length, teamID: side, playerDatabaseID: id });
  }
  const goalsOf = (id: number) => events.filter((e) => e.playerDatabaseID === id).length;
  return {
    homeGoals: hg,
    awayGoals: ag,
    abandoned: !!opts.abandoned,
    events,
    playerStats: reg.players
      .filter((p) => p.starter)
      .map((p) => ({ playerDatabaseID: p.engineId, teamID: p.side, minutesPlayed: minutes, goals: goalsOf(p.engineId), assists: 0, shots: 2, shotsOnTarget: 1, passes: 30, passesCompleted: 24, tackles: 2, fouls: 1, yellowCards: 0, redCards: 0, touches: 45, rating: p.engineId === reg.userEngineId ? 7.9 : 6.6 })),
  };
}

const friendly = (s: CareerState) => s.fixtures.find((f) => f.compId.startsWith('F-') && (f.home === s.user.clubId || f.away === s.user.clubId));

describe('PLAY: engine result -> career', () => {
  it('applies a full 3D match: score, report, appearances, rating, form, reputation', () => {
    const { state, reg, db, f } = setup(friendly);
    const before = { form: state.user.form, rep: state.user.rep.local, followers: state.user.followers, ratings: state.user.ratings.length };
    const userHome = f.home === state.user.clubId;
    const res = applyEngineResult(state, reg, fakeResult(reg, userHome ? 2 : 0, userHome ? 0 : 2, { userGoals: 2 }));
    unregisterCareer(db);
    expect(res.simulated).toBe(false);
    const r = res.report!;
    expect(r.played3D).toBe(true);
    expect([r.hg, r.ag]).toEqual(userHome ? [2, 0] : [0, 2]);
    expect(r.user!.goals).toBe(2);
    expect(r.user!.minutes).toBe(90);
    expect(r.user!.rating).toBeCloseTo(7.9, 5);
    expect(r.events.filter((e) => e.type === 'goal' && e.user).length).toBe(2);
    expect(r.headline).toMatch(/Brace/);
    expect(fixture(state, f.id)!.played).toBe(true);
    expect(state.pendingMatch).toBeNull();
    expect(state.user.ratings.length).toBe(before.ratings + 1);
    expect(state.user.form).toBeGreaterThan(before.form);
    expect(state.user.rep.local).toBeGreaterThan(before.rep);
    expect(state.user.followers).toBeGreaterThan(before.followers);
    expect(state.reports[0]).toBe(r);
  });

  it('counts league appearances and goals like a simulated match', () => {
    const league = (s: CareerState) => s.fixtures.find((f) => f.compId.startsWith('L') && (f.home === s.user.clubId || f.away === s.user.clubId));
    const { state, reg, db } = setup(league);
    applyEngineResult(state, reg, fakeResult(reg, 1, 1, { userGoals: 1 }));
    unregisterCareer(db);
    expect(state.user.season.league.apps).toBe(1);
    expect(state.user.season.league.starts).toBe(1);
    expect(state.user.season.league.goals).toBe(1);
    expect(state.user.totals.apps).toBe(1);
  });

  it('settles a drawn knockout tie with extra time and penalties', () => {
    // a low club plays the cup's preliminary round
    const cup = (s: CareerState) => s.fixtures.find((f) => f.compId.startsWith('C') && (f.home === s.user.clubId || f.away === s.user.clubId));
    const { state, reg, db, f } = setup(cup, 33);
    expect(needsWinner(state, f).needed).toBe(true);
    const ctx = pendingMatchContext(state)!;
    const out = resultToOutcome(state, ctx, reg, fakeResult(reg, 1, 1));
    expect(out.aet).toBe(true);
    if (out.hg === out.ag) expect(out.pens).toBeDefined();
    else expect(out.events.some((e) => e.text === 'extra time')).toBe(true);
    const res = applyEngineResult(state, reg, fakeResult(reg, 1, 1));
    unregisterCareer(db);
    const r = res.report!;
    expect(r.aet).toBe(true);
    const played = fixture(state, f.id)!;
    expect(played.played).toBe(true);
    const winner = tieWinner(state, played);
    expect([f.home, f.away]).toContain(winner);
    if (played.hg === played.ag) {
      expect(played.pens).toBeDefined();
      expect(r.headline).toMatch(/on penalties/);
    } else expect(r.headline).toMatch(/after extra time/);
    // the user played extra time too
    expect(r.user!.minutes).toBe(120);
  });

  it('continues an abandoned match from where the user left', () => {
    const { state, reg, db } = setup(friendly);
    const res = applyEngineResult(state, reg, fakeResult(reg, 1, 0, { abandoned: true, minutes: 55 }));
    unregisterCareer(db);
    expect(res.simulated).toBe(false);
    expect(res.note).toMatch(/55'/);
    const r = res.report!;
    expect(r.user!.minutes).toBe(55);
    expect(r.hg).toBeGreaterThanOrEqual(1);
    expect(r.events.some((e) => e.type === 'sub_off' && e.user)).toBe(true);
    for (const e of r.events.filter((x) => x.type === 'goal' && x.minute > 55)) expect(e.user).toBeFalsy();
  });

  it('simulates a match quit right after kick-off instead', () => {
    const { state, reg, db } = setup(friendly);
    const res = applyEngineResult(state, reg, fakeResult(reg, 0, 0, { abandoned: true, minutes: 3 }));
    unregisterCareer(db);
    expect(res.simulated).toBe(true);
    expect(res.report!.played3D).toBe(false);
    expect(res.note).toMatch(/simulated/);
    expect(state.pendingMatch).toBeNull();
  });

  it('keeps the user out of NPC lines and credits NPC scorers', () => {
    const { state, reg, db } = setup(friendly);
    const out = resultToOutcome(state, pendingMatchContext(state)!, reg, fakeResult(reg, 3, 2));
    unregisterCareer(db);
    expect(out.lines.some((l) => l.id === USER_ID)).toBe(false);
    expect(out.lines.reduce((a, l) => a + l.goals, 0)).toBe(5);
    expect(out.user).not.toBeNull();
  });
});
