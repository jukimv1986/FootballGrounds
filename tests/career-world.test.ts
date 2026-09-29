import { describe, expect, it } from 'vitest';
import { generateWorld, TOP_TIER_SIZE, SECOND_TIER_SIZE } from '../src/career/core/world';
import { roundRobin, seasonCalendar, leagueDates } from '../src/career/core/competitions';
import { newCareer } from '../src/career/core/career';
import { Rng } from '../src/career/core/rng';
import { EVENT_DEFS } from '../src/career/core/eventdefs';
import { resolveEvent, pendingEvent } from '../src/career/core/events';
import { deserialize, serialize } from '../src/career/core/save';
import { defaultInput, loadTables } from './careerhelpers';

const tables = loadTables();

describe('career world generation', () => {
  const world = generateWorld({ seed: 1234, startSeason: 2026, db: tables });

  it('has countries, two tiers each, full leagues', () => {
    expect(world.countries.length).toBeGreaterThanOrEqual(6);
    for (const c of world.countries) {
      expect(c.leagueIds.length).toBe(2);
      expect(world.leagues[c.leagueIds[0]].clubIds.length).toBe(TOP_TIER_SIZE);
      expect(world.leagues[c.leagueIds[1]].clubIds.length).toBe(SECOND_TIER_SIZE);
    }
  });

  it('imports the shipped database clubs and players into their top tiers', () => {
    for (const t of tables.teams) {
      const club = world.clubs.find((c) => c.dbTeamId === t.id);
      expect(club, t.name).toBeDefined();
      expect(club!.name).toBe(t.name);
      expect(world.leagues[club!.leagueId].tier).toBe(1);
      const imported = world.npcs.filter((n) => n.clubId === club!.id && n.profile);
      expect(imported.length).toBe(tables.players.filter((p) => p.team_id === t.id).length);
    }
  });

  it('gives every club a sane squad, coach, city and identity', () => {
    const names = new Set<string>();
    for (const c of world.clubs) {
      expect(names.has(c.name), c.name).toBe(false);
      names.add(c.name);
      expect(c.shortName.length).toBeGreaterThanOrEqual(2);
      expect(world.cities[c.cityId].countryKey).toBe(c.countryKey);
      expect(world.coaches.some((x) => x.id === c.coachId && x.clubId === c.id)).toBe(true);
      const squad = world.npcs.filter((n) => n.clubId === c.id && n.squad === 'first');
      expect(squad.length).toBeGreaterThanOrEqual(22);
      expect(squad.filter((n) => n.pos === 'GK').length).toBeGreaterThanOrEqual(2);
      for (const n of squad) {
        expect(n.ovr).toBeGreaterThan(25);
        expect(n.ovr).toBeLessThanOrEqual(99);
        expect(n.ability).toBeGreaterThan(0.2);
      }
    }
  });

  it('makes top-tier clubs stronger than second-tier ones', () => {
    const avg = (tier: number) => {
      const clubs = world.clubs.filter((c) => world.leagues[c.leagueId].tier === tier);
      return clubs.reduce((a, c) => a + world.npcs.filter((n) => n.clubId === c.id).sort((x, y) => y.ovr - x.ovr).slice(0, 11).reduce((s, n) => s + n.ovr, 0) / 11, 0) / clubs.length;
    };
    expect(avg(1)).toBeGreaterThan(avg(2) + 4);
  });

  it('is deterministic for a seed', () => {
    const again = generateWorld({ seed: 1234, startSeason: 2026, db: tables });
    expect(JSON.stringify(again)).toBe(JSON.stringify(world));
    const other = generateWorld({ seed: 999, startSeason: 2026, db: tables });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(world));
  });

  it('builds double round robins where every pair meets home and away', () => {
    const teams = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const rounds = roundRobin(teams, new Rng(5));
    expect(rounds.length).toBe(34);
    const pairs = new Map<string, number>();
    for (const r of rounds) {
      const seen = new Set<number>();
      for (const [h, a] of r) {
        expect(seen.has(h) || seen.has(a)).toBe(false);
        seen.add(h);
        seen.add(a);
        pairs.set(`${h}-${a}`, (pairs.get(`${h}-${a}`) ?? 0) + 1);
      }
      expect(r.length).toBe(9);
    }
    for (const a of teams) for (const b of teams) if (a !== b) expect(pairs.get(`${a}-${b}`)).toBe(1);
    const dates = leagueDates(seasonCalendar(2026), 34, false);
    expect(dates.length).toBe(34);
    expect(new Set(dates.map((d) => d.day)).size).toBe(34);
  });
});

describe('career events', () => {
  it('has at least 30 unique events', () => {
    const ids = EVENT_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(30);
  });

  it('every choice of every event applies without errors', () => {
    const base = newCareer(defaultInput({ age: 16 }), { seed: 77, db: tables });
    base.user.born -= 365 * 8; // an adult, so age-gated events have context
    base.life.money = 500000;
    const json = serialize(base);
    for (const def of EVENT_DEFS) {
      def.choices.forEach((_c, i) => {
        const s = deserialize(json);
        const rng = new Rng(i + 1);
        const ctx = def.prepare ? def.prepare(s, rng) : {};
        if (!ctx) return;
        s.events.pending = { defId: def.id, day: s.day, ctx: { days: 20, injury: 'Calf strain', ...ctx } };
        expect(pendingEvent(s)?.def.id).toBe(def.id);
        expect(def.title(s, s.events.pending.ctx).length).toBeGreaterThan(2);
        expect(def.text(s, s.events.pending.ctx).length).toBeGreaterThan(10);
        const text = resolveEvent(s, i, rng);
        expect(typeof text).toBe('string');
        expect(s.events.pending).toBeNull();
      });
    }
  });
});
