import { describe, expect, it } from 'vitest';
import { newCareer } from '../src/career/core/career';
import { autoPlay } from '../src/career/core/autoplay';
import { dayOf } from '../src/career/core/dates';
import { standings, leagueCompId } from '../src/career/core/competitions';
import { clubStrength } from '../src/career/core/selection';
import { defaultInput, loadTables } from './careerhelpers';

const tables = loadTables();

describe('a full season simulated headlessly', () => {
  const state = newCareer(defaultInput(), { seed: 2024, db: tables });
  const startSeason = state.season;
  // snapshot the tables of the first season just before the rollover
  let tables2026: { league: string; rows: ReturnType<typeof standings>; strength: Map<number, number> }[] = [];
  const t0 = Date.now();
  autoPlay(state, dayOf(startSeason + 1, 6, 30));
  tables2026 = state.world.leagues.map((l) => ({ league: l.name, rows: standings(state, leagueCompId(l.id, startSeason)), strength: new Map(l.clubIds.map((id) => [id, clubStrength(state, id)])) }));
  const comps = state.comps.map((c) => ({ ...c }));
  autoPlay(state, dayOf(startSeason + 1, 7, 2));
  const elapsed = Date.now() - t0;

  it('runs in reasonable time', () => {
    expect(elapsed).toBeLessThan(60000);
  });

  it('plays every league fixture with sane standings', () => {
    let goals = 0;
    let games = 0;
    for (const t of tables2026) {
      const n = t.rows.length;
      expect(n).toBeGreaterThanOrEqual(16);
      for (const r of t.rows) {
        expect(r.p).toBe(2 * (n - 1));
        expect(r.w + r.d + r.l).toBe(r.p);
        expect(r.pts).toBe(3 * r.w + r.d);
        goals += r.gf;
        games += r.p;
      }
      const totalGf = t.rows.reduce((a, r) => a + r.gf, 0);
      const totalGa = t.rows.reduce((a, r) => a + r.ga, 0);
      expect(totalGf).toBe(totalGa);
    }
    const perGame = (goals / games) * 2;
    expect(perGame).toBeGreaterThan(2.0);
    expect(perGame).toBeLessThan(3.6);
  });

  it('rewards stronger squads with better finishes', () => {
    let topStronger = 0;
    for (const t of tables2026) {
      const s = (ids: number[]) => ids.reduce((a, id) => a + (t.strength.get(id) ?? 0), 0) / ids.length;
      if (s(t.rows.slice(0, 4).map((r) => r.clubId)) > s(t.rows.slice(-4).map((r) => r.clubId))) topStronger++;
    }
    expect(topStronger).toBeGreaterThanOrEqual(Math.ceil(tables2026.length * 0.75));
  });

  it('finishes the cups and the continental cup', () => {
    const knockouts = comps.filter((c) => (c.type === 'cup' || c.type === 'continental') && c.season === startSeason);
    expect(knockouts.length).toBeGreaterThanOrEqual(8);
    for (const c of knockouts) {
      expect(c.finished, c.name).toBe(true);
      expect(c.winnerId).not.toBeNull();
    }
  });

  it('rolls over into the next season with history and a new fixture list', () => {
    expect(state.season).toBe(startSeason + 1);
    expect(state.history[0].season).toBe(startSeason);
    expect(state.history[0].champions.length).toBeGreaterThan(10);
    expect(state.user.history.length).toBe(1);
    expect(state.fixtures.filter((f) => !f.played).length).toBeGreaterThan(3000);
    // promotion / relegation keeps the league sizes
    for (const l of state.world.leagues) expect(l.clubIds.length).toBe(l.tier === 1 ? 18 : 16);
  });

  it('develops the youngster and keeps his life ticking', () => {
    const h = state.user.history[0];
    expect(h.ovrEnd).toBeGreaterThan(h.ovrStart + 3);
    expect(state.user.season.youth.apps + h.youth.apps + h.league.apps).toBeGreaterThan(0);
    expect(state.life.ledger.length).toBeGreaterThan(10);
    expect(state.timeline.length).toBeGreaterThan(5);
  });
});
