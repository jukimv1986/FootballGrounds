import { describe, expect, it } from 'vitest';
import { newCareer } from '../src/career/core/career';
import { autoPlay } from '../src/career/core/autoplay';
import { ageAt, dayOf } from '../src/career/core/dates';
import { userOvr } from '../src/career/core/footballer';
import { hallOfFameEntry } from '../src/career/core/retirement';
import { defaultInput, loadTables } from './careerhelpers';

const tables = loadTables();

describe('a whole career, 15 to retirement', () => {
  const state = newCareer(defaultInput({ pos: 'CM', talent: 'promising', traits: ['professional', 'leader'] }), { seed: 31337, db: tables });
  const byAge = new Map<number, number>();
  const t0 = Date.now();
  byAge.set(15, userOvr(state.user));
  let season = state.season;
  autoPlay(state, dayOf(2060, 1, 1), {
    onStop: (_r, s) => {
      if (s.season !== season) {
        season = s.season;
        byAge.set(Math.floor(ageAt(s.user.born, s.day)), userOvr(s.user));
      }
    },
  });
  const elapsed = Date.now() - t0;

  it('ends in retirement at a plausible age', () => {
    expect(state.retired).not.toBeNull();
    expect(state.retired!.age).toBeGreaterThanOrEqual(32);
    expect(state.retired!.age).toBeLessThanOrEqual(40);
    expect(state.user.history.length).toBeGreaterThanOrEqual(15);
    expect(elapsed).toBeLessThan(120000);
  });

  it('peaks in his late twenties and declines afterwards', () => {
    const entries = [...byAge.entries()].sort((a, b) => a[0] - b[0]);
    const peak = entries.reduce((m, e) => (e[1] > m[1] ? e : m));
    expect(peak[0]).toBeGreaterThanOrEqual(24);
    expect(peak[0]).toBeLessThanOrEqual(31);
    expect(peak[1]).toBeGreaterThan(entries[0][1] + 25);
    const at = (age: number) => entries.filter((e) => e[0] >= age)[0]?.[1] ?? 0;
    expect(at(20)).toBeGreaterThan(at(16) + 8);
    const last = entries[entries.length - 1];
    expect(last[1]).toBeLessThan(peak[1] - 2);
  });

  it('builds a career worth remembering', () => {
    const totals = state.user.history.reduce((a, h) => a + h.league.apps + h.cup.apps + h.continental.apps, 0);
    expect(totals).toBeGreaterThan(250);
    expect(state.life.money).toBeGreaterThan(100000);
    const hof = hallOfFameEntry(state);
    expect(hof.score).toBeGreaterThan(0);
    expect(hof.clubs.length).toBeGreaterThanOrEqual(1);
    expect(state.retired!.next.length).toBeGreaterThan(3);
    expect(Object.keys(state.events.counts).length).toBeGreaterThan(12);
  });
});
