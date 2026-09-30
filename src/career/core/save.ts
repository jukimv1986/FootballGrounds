// Save / load: multiple slots in localStorage (or any key-value store, e.g. an in-memory one in
// tests). A save is the versioned CareerState as JSON, LZW-compressed; a small metadata record
// per slot lets the menu list slots without decompressing them. Exports are plain JSON files.
// Old versions are upgraded through MIGRATIONS (version n -> n+1).

import { SAVE_VERSION, syncRng } from './career';
import { compress, decompress } from './compress';
import { formatDate } from './dates';
import { fullName, userAge, userOvr } from './footballer';
import { invalidateIndex } from './index';
import type { HallOfFameEntry } from './retirement';
import type { CareerState } from './types';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStorage(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** window.localStorage when usable (private mode / blocked storage returns null) */
export function browserStorage(): KV | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__fg_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const PREFIX = 'fg.career.';
export const SLOT_COUNT = 5;

export interface SlotMeta {
  slot: number;
  version: number;
  id: string;
  name: string;
  club: string;
  age: number;
  ovr: number;
  date: string;
  savedAt: number;
  retired: boolean;
  bytes: number;
}

/** version n -> n+1 upgrade functions (raw JSON objects) */
export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (raw) => ({ ...raw, version: 2, newField: default }),
};

/** floats are stored with 4 decimals: plenty for 0..1 stats and much smaller saves */
function roundFloats(_key: string, v: unknown): unknown {
  return typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v;
}

export function serialize(state: CareerState): string {
  syncRng(state);
  state.savedAt = Date.now();
  return JSON.stringify(state, roundFloats);
}

export function deserialize(json: string): CareerState {
  let raw = JSON.parse(json) as Record<string, unknown>;
  let v = (raw.version as number) ?? 0;
  if (v > SAVE_VERSION) throw new Error(`save version ${v} is newer than this game (${SAVE_VERSION})`);
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`no migration from save version ${v}`);
    raw = m(raw);
    v = (raw.version as number) ?? v + 1;
  }
  const state = raw as unknown as CareerState;
  if (!state.world || !state.user || !state.life) throw new Error('not a career save');
  invalidateIndex(state);
  return state;
}

export function metaOf(state: CareerState, slot: number, bytes: number): SlotMeta {
  return {
    slot,
    version: state.version,
    id: state.id,
    name: fullName(state.user),
    club: state.world.clubs[state.user.clubId]?.name ?? 'Free agent',
    age: Math.floor(userAge(state)),
    ovr: Math.round(userOvr(state.user)),
    date: formatDate(state.day),
    savedAt: state.savedAt,
    retired: !!state.retired,
    bytes,
  };
}

export function saveToSlot(kv: KV, slot: number, state: CareerState): SlotMeta {
  const json = serialize(state);
  const packed = compress(json);
  kv.setItem(`${PREFIX}slot.${slot}`, packed);
  const meta = metaOf(state, slot, packed.length * 2);
  kv.setItem(`${PREFIX}meta.${slot}`, JSON.stringify(meta));
  kv.setItem(`${PREFIX}last`, String(slot));
  return meta;
}

export function loadFromSlot(kv: KV, slot: number): CareerState | null {
  const packed = kv.getItem(`${PREFIX}slot.${slot}`);
  if (!packed) return null;
  return deserialize(decompress(packed));
}

export function deleteSlot(kv: KV, slot: number): void {
  kv.removeItem(`${PREFIX}slot.${slot}`);
  kv.removeItem(`${PREFIX}meta.${slot}`);
}

export function listSlots(kv: KV): (SlotMeta | null)[] {
  const out: (SlotMeta | null)[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const m = kv.getItem(`${PREFIX}meta.${i}`);
    try {
      out.push(m ? (JSON.parse(m) as SlotMeta) : null);
    } catch {
      out.push(null);
    }
  }
  return out;
}

export function lastSlot(kv: KV): number | null {
  const v = kv.getItem(`${PREFIX}last`);
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function firstFreeSlot(kv: KV): number {
  const slots = listSlots(kv);
  const i = slots.findIndex((s) => s === null);
  return i >= 0 ? i : 0;
}

// ----- export / import (files)

export function exportSave(state: CareerState): string {
  return serialize(state);
}

export function importSave(text: string): CareerState {
  const t = text.trim();
  return deserialize(t.startsWith('L1:') ? decompress(t) : t);
}

// ----- hall of fame (across careers)

export function loadHallOfFame(kv: KV): HallOfFameEntry[] {
  try {
    return JSON.parse(kv.getItem(`${PREFIX}halloffame`) ?? '[]') as HallOfFameEntry[];
  } catch {
    return [];
  }
}

export function addToHallOfFame(kv: KV, e: HallOfFameEntry): HallOfFameEntry[] {
  const list = loadHallOfFame(kv).filter((x) => x.id !== e.id);
  list.push(e);
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, 50);
  kv.setItem(`${PREFIX}halloffame`, JSON.stringify(trimmed));
  return trimmed;
}
