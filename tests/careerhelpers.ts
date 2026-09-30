// Shared fixtures for the career tests: the shipped database tables and a default character.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseTables } from '../src/game/data/database';
import type { CreatorInput } from '../src/career/core/footballer';

export function loadTables(): DatabaseTables {
  return JSON.parse(readFileSync(join(__dirname, '..', 'public', 'data', 'databases', 'default', 'database.json'), 'utf-8')) as DatabaseTables;
}

export function defaultInput(overrides: Partial<CreatorInput> = {}): CreatorInput {
  return {
    first: 'Alex',
    last: 'Morgan',
    nat: 'ENG',
    age: 15,
    birthMonth: 3,
    birthDay: 12,
    pos: 'CF',
    foot: 'R',
    height: 1.8,
    weight: 74,
    skin: 1,
    hair: 'short01',
    hairColor: 'black',
    traits: ['professional'],
    talent: 'promising',
    clubId: 20,
    romance: true,
    difficulty: 'normal',
    shirt: 9,
    ...overrides,
  };
}
