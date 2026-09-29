import { describe, expect, it } from 'vitest';
import { advanceSlot, newCareer, pendingMatchContext } from '../src/career/core/career';
import { autoResolveStop } from '../src/career/core/autoplay';
import { ageYears, dayOf } from '../src/career/core/dates';
import { birthDayFor, type Talent } from '../src/career/core/footballer';
import { YOUTH_BENCH_RUN, YOUTH_START_RUN, youthDevelopmentBonus } from '../src/career/core/selection';
import { coachOf } from '../src/career/core/index';
import { defaultInput, loadTables } from './careerhelpers';

const tables = loadTables();

describe('age at the start of the career', () => {
  it('is the chosen age on 1 July whatever the birthday', () => {
    for (const age of [15, 16] as const) {
      for (const [m, d] of [[1, 1], [3, 12], [6, 30], [7, 1], [7, 2], [10, 5], [12, 28]]) {
        const born = birthDayFor(age, m, d, 2026);
        expect(ageYears(born, dayOf(2026, 7, 1))).toBe(age);
      }
    }
  });

  it('starts an October-born 15-year-old aged 15', () => {
    const state = newCareer(defaultInput({ age: 15, birthMonth: 10, birthDay: 5 }), { seed: 77, db: tables });
    expect(ageYears(state.user.born, state.day)).toBe(15);
    const t = new Date(state.user.born * 86400000);
    expect(t.getUTCMonth() + 1).toBe(10);
    expect(t.getUTCDate()).toBe(5);
  });
});

describe('academy selection', () => {
  it('owes minutes to a kid left out and rotates a regular', () => {
    const state = newCareer(defaultInput(), { seed: 5, db: tables });
    const coach = coachOf(state, state.user.clubId);
    const base = youthDevelopmentBonus(state, coach);
    state.events.flags[YOUTH_BENCH_RUN] = 3;
    expect(youthDevelopmentBonus(state, coach)).toBeGreaterThan(base + 5);
    state.events.flags[YOUTH_BENCH_RUN] = 0;
    state.events.flags[YOUTH_START_RUN] = 8;
    expect(youthDevelopmentBonus(state, coach)).toBeLessThan(base - 3);
  });

  // a casual player (default weekly plan, every event auto-resolved) for one academy season
  function startRate(talent: Talent, seed: number, clubId: number): { rate: number; matches: number } {
    const state = newCareer(defaultInput({ talent, clubId, pos: (['CF', 'CM', 'CB', 'LM'] as const)[seed % 4], traits: ['ambitious'] }), { seed, db: tables });
    const until = dayOf(state.season + 1, 3, 31);
    let starts = 0;
    let matches = 0;
    let guard = 0;
    while (state.day < until && guard++ < 60000) {
      const r = advanceSlot(state);
      if (r === 'none') continue;
      if (r === 'match') {
        const ctx = pendingMatchContext(state)!;
        if (ctx.fixture.youth) {
          matches++;
          if (ctx.role === 'start') starts++;
        }
      }
      autoResolveStop(state, r);
    }
    return { rate: starts / Math.max(1, matches), matches };
  }

  it('gives prospects regular development-squad football, more for bigger talents', () => {
    const avg = (talent: Talent) => {
      const runs = [
        [3, 10],
        [4, 14],
        [5, 6],
        [6, 20],
      ].map(([seed, clubId]) => startRate(talent, seed, clubId));
      for (const r of runs) expect(r.matches).toBeGreaterThanOrEqual(10);
      return runs.reduce((a, r) => a + r.rate, 0) / runs.length;
    };
    const grafter = avg('grafter');
    const promising = avg('promising');
    const wonderkid = avg('wonderkid');
    expect(promising).toBeGreaterThan(0.45);
    expect(promising).toBeLessThan(0.92);
    expect(wonderkid).toBeGreaterThanOrEqual(promising);
    expect(wonderkid).toBeGreaterThan(0.65);
    expect(grafter).toBeLessThanOrEqual(promising);
    expect(grafter).toBeGreaterThan(0.2);
  }, 120000);
});
