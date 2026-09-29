import { describe, expect, it } from 'vitest';
import { advanceDay, newCareer } from '../src/career/core/career';
import { autoPlay } from '../src/career/core/autoplay';
import { compress, decompress } from '../src/career/core/compress';
import { dayOf } from '../src/career/core/dates';
import { addToHallOfFame, deleteSlot, deserialize, exportSave, importSave, listSlots, loadFromSlot, loadHallOfFame, memoryStorage, saveToSlot, serialize } from '../src/career/core/save';
import { Rng } from '../src/career/core/rng';
import { defaultInput, loadTables } from './careerhelpers';

const tables = loadTables();

describe('compression', () => {
  it('round-trips text, unicode and edge cases', () => {
    const rng = new Rng(3);
    const samples = ['', 'a', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Álvaro Muñoz — Düsseldorf ⚽ 🏆', JSON.stringify({ x: [1, 2, 3], y: 'hello'.repeat(500) })];
    let random = '';
    for (let i = 0; i < 20000; i++) random += String.fromCharCode(32 + rng.int(0, 90));
    samples.push(random);
    for (const s of samples) expect(decompress(compress(s))).toBe(s);
  });
});

describe('save / load', () => {
  const state = newCareer(defaultInput(), { seed: 555, db: tables });
  autoPlay(state, dayOf(2026, 9, 20));

  it('serialise -> deserialise -> serialise is stable', () => {
    const a = serialize(state);
    const b = serialize(deserialize(a));
    expect(JSON.parse(b).savedAt).toBeGreaterThan(0);
    const strip = (s: string) => {
      const o = JSON.parse(s);
      delete o.savedAt;
      return JSON.stringify(o);
    };
    expect(strip(b)).toBe(strip(a));
  });

  it('uses slots with metadata, and deletes them', () => {
    const kv = memoryStorage();
    const meta = saveToSlot(kv, 2, state);
    expect(meta.name).toBe('Alex Morgan');
    const slots = listSlots(kv);
    expect(slots[2]?.id).toBe(state.id);
    expect(slots[0]).toBeNull();
    const loaded = loadFromSlot(kv, 2)!;
    expect(loaded.day).toBe(state.day);
    expect(loaded.user.stats).toEqual(JSON.parse(serialize(state)).user.stats);
    expect(loaded.world.npcs.length).toBe(state.world.npcs.length);
    deleteSlot(kv, 2);
    expect(listSlots(kv)[2]).toBeNull();
  });

  it('a loaded career keeps running deterministically like the original', () => {
    const a = deserialize(serialize(state));
    const b = deserialize(serialize(state));
    for (let i = 0; i < 20; i++) {
      advanceDay(a);
      advanceDay(b);
      if (a.pendingMatch || a.events.pending) break;
    }
    expect(a.day).toBe(b.day);
    expect(JSON.stringify(a.user.stats)).toBe(JSON.stringify(b.user.stats));
  });

  it('exports and imports a save file', () => {
    const text = exportSave(state);
    const back = importSave(text);
    expect(back.id).toBe(state.id);
    expect(() => importSave('{"version": 99}')).toThrow();
    expect(() => importSave('{"hello": 1}')).toThrow();
  });

  it('keeps a hall of fame across careers', () => {
    const kv = memoryStorage();
    addToHallOfFame(kv, { id: 'a', name: 'A', nat: 'England', pos: 'CF', seasons: 20, apps: 600, goals: 250, assists: 90, caps: 60, trophies: 12, awards: 5, peakOvr: 88, score: 3000, next: 'Pundit', retiredAge: 36, clubs: ['X'], finishedAt: 1 });
    addToHallOfFame(kv, { id: 'b', name: 'B', nat: 'Spain', pos: 'CB', seasons: 15, apps: 400, goals: 20, assists: 10, caps: 10, trophies: 2, awards: 0, peakOvr: 79, score: 900, next: 'Coach', retiredAge: 34, clubs: ['Y'], finishedAt: 2 });
    const list = loadHallOfFame(kv);
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
