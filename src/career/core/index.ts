// Runtime lookup indexes over a CareerState (never serialised). Built lazily and invalidated
// whenever players move between clubs or are created/removed.

import type { CareerState, Club, Coach, Competition, Fixture, Id, NPC, City, League, Country } from './types';

export interface WorldIndex {
  npcs: Map<Id, NPC>;
  squads: Map<Id, NPC[]>;
  youth: Map<Id, NPC[]>;
  coaches: Map<Id, Coach>;
  comps: Map<string, Competition>;
  fixtures: Map<Id, Fixture>;
  fixturesByDay: Map<number, Fixture[]>;
  fixturesByComp: Map<string, Fixture[]>;
  npcCount: number;
  coachCount: number;
  fixtureCount: number;
  compCount: number;
}

const cache = new WeakMap<CareerState, WorldIndex>();

export function invalidateIndex(state: CareerState): void {
  cache.delete(state);
}

/** squads changed (transfer, retirement, youth intake) */
export function invalidateSquads(state: CareerState): void {
  const idx = cache.get(state);
  if (!idx) return;
  buildSquads(state, idx);
}

function buildSquads(state: CareerState, idx: WorldIndex): void {
  idx.npcs.clear();
  idx.squads.clear();
  idx.youth.clear();
  for (const n of state.world.npcs) {
    idx.npcs.set(n.id, n);
    if (n.clubId < 0) continue;
    const map = n.squad === 'youth' ? idx.youth : idx.squads;
    let list = map.get(n.clubId);
    if (!list) map.set(n.clubId, (list = []));
    list.push(n);
  }
  idx.npcCount = state.world.npcs.length;
}

function buildFixtures(state: CareerState, idx: WorldIndex): void {
  idx.fixtures.clear();
  idx.fixturesByDay.clear();
  idx.fixturesByComp.clear();
  for (const f of state.fixtures) {
    idx.fixtures.set(f.id, f);
    let d = idx.fixturesByDay.get(f.day);
    if (!d) idx.fixturesByDay.set(f.day, (d = []));
    d.push(f);
    let c = idx.fixturesByComp.get(f.compId);
    if (!c) idx.fixturesByComp.set(f.compId, (c = []));
    c.push(f);
  }
  idx.fixtureCount = state.fixtures.length;
}

export function getIndex(state: CareerState): WorldIndex {
  let idx = cache.get(state);
  if (!idx) {
    idx = {
      npcs: new Map(),
      squads: new Map(),
      youth: new Map(),
      coaches: new Map(),
      comps: new Map(),
      fixtures: new Map(),
      fixturesByDay: new Map(),
      fixturesByComp: new Map(),
      npcCount: -1,
      coachCount: -1,
      fixtureCount: -1,
      compCount: -1,
    };
    cache.set(state, idx);
  }
  if (idx.npcCount !== state.world.npcs.length) buildSquads(state, idx);
  if (idx.coachCount !== state.world.coaches.length) {
    idx.coaches.clear();
    for (const c of state.world.coaches) idx.coaches.set(c.id, c);
    idx.coachCount = state.world.coaches.length;
  }
  if (idx.fixtureCount !== state.fixtures.length) buildFixtures(state, idx);
  if (idx.compCount !== state.comps.length) {
    idx.comps.clear();
    for (const c of state.comps) idx.comps.set(c.id, c);
    idx.compCount = state.comps.length;
  }
  return idx;
}

export function club(state: CareerState, id: Id): Club {
  return state.world.clubs[id];
}

export function city(state: CareerState, id: Id): City {
  return state.world.cities[id];
}

export function league(state: CareerState, id: Id): League {
  return state.world.leagues[id];
}

export function country(state: CareerState, key: string): Country {
  return state.world.countries.find((c) => c.key === key)!;
}

export function npc(state: CareerState, id: Id): NPC | undefined {
  return getIndex(state).npcs.get(id);
}

export function coachOf(state: CareerState, clubId: Id): Coach | undefined {
  const c = state.world.clubs[clubId];
  return c ? getIndex(state).coaches.get(c.coachId) : undefined;
}

export function squadOf(state: CareerState, clubId: Id): NPC[] {
  return getIndex(state).squads.get(clubId) ?? [];
}

export function youthOf(state: CareerState, clubId: Id): NPC[] {
  return getIndex(state).youth.get(clubId) ?? [];
}

export function comp(state: CareerState, id: string): Competition | undefined {
  return getIndex(state).comps.get(id);
}

export function fixture(state: CareerState, id: Id): Fixture | undefined {
  return getIndex(state).fixtures.get(id);
}

export function fixturesOn(state: CareerState, day: number): Fixture[] {
  return getIndex(state).fixturesByDay.get(day) ?? [];
}

export function fixturesOf(state: CareerState, compId: string): Fixture[] {
  return getIndex(state).fixturesByComp.get(compId) ?? [];
}

/** call after pushing fixtures in bulk */
export function invalidateFixtures(state: CareerState): void {
  const idx = cache.get(state);
  if (idx) buildFixtures(state, idx);
}
