// Port of blunted/base/utils.

import { Vector3, Quaternion } from './math/vector3';
import { pi } from './math/bluntmath';

// ----- generic tree structure (used by the .ase loader)

export interface s_treeentry {
  name: string;
  values: string[];
  subtree: s_tree | null;
}

export interface s_tree {
  entries: s_treeentry[];
}

/** C++ tree_load(file): parses .ase text into a tree */
export function tree_load_from_string(source: string): s_tree {
  const lines = source.split('\n');
  const pos = { line: 0 };
  return tree_readblock(lines, pos);
}

function tree_readblock(lines: string[], pos: { line: number }): s_tree {
  const content: s_tree = { entries: [] };
  while (pos.line < lines.length) {
    let line = lines[pos.line++];
    if (line.endsWith('\r')) line = line.substring(0, line.length - 1);
    const tokens: string[] = [];
    tokenize(line, tokens, ' \t');
    if (tokens.length > 0) {
      if (tokens[0] === '}') {
        return content;
      }
      const entry: s_treeentry = {
        name: tokens[0].startsWith('*') ? tokens[0].substring(1) : tokens[0],
        values: tokens.slice(1),
        subtree: null,
      };
      if (tokens[tokens.length - 1] === '{') {
        entry.values.pop();
        entry.subtree = tree_readblock(lines, pos);
      }
      content.entries.push(entry);
    }
  }
  return content;
}

export function treeentry_find(tree: s_tree, needle: string): s_treeentry | null {
  for (const entry of tree.entries) if (entry.name === needle) return entry;
  return null;
}

export function tree_find(tree: s_tree, needle: string): s_tree | null {
  for (const entry of tree.entries) if (entry.name === needle) return entry.subtree;
  return null;
}

// ----- string functions

export function stringchomp(input: string, chomp: string): string {
  let i = 0;
  while (i < input.length && input[i] === chomp) i++;
  return input.substring(i);
}

/** splits on any of the delimiter characters, skipping empty tokens (C++ tokenize) */
export function tokenize(str: string, tokens: string[], delimiters = ' '): string[] {
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (delimiters.includes(ch)) {
      if (current.length > 0) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** strips non-alphanumeric characters */
export function StripString(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '');
}

export function get_file_name(filename: string): string {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  return filename.substring(slash + 1);
}

export function get_file_extension(filename: string): string {
  return filename.substring(filename.lastIndexOf('.') + 1);
}

export function int_to_str(i: number): string {
  return String(Math.trunc(i));
}

export function real_to_str(r: number): string {
  return r.toFixed(6);
}

/** C atof: parses a leading float, returns 0 when there is none */
export function atof(s: string | undefined): number {
  if (s === undefined) return 0;
  const v = parseFloat(s);
  return Number.isNaN(v) ? 0 : v;
}

/** C atoi */
export function atoi(s: string | undefined): number {
  if (s === undefined) return 0;
  const v = parseInt(s, 10);
  return Number.isNaN(v) ? 0 : v;
}

export function GetStringFromVector(vec: Vector3): string {
  return `${vec.coords[0].toFixed(6)}, ${vec.coords[1].toFixed(6)}, ${vec.coords[2].toFixed(6)}`;
}

export function GetVectorFromString(vecString: string): Vector3 {
  if (vecString === '') return new Vector3(0);
  const t: string[] = [];
  tokenize(vecString, t, ',');
  return new Vector3(atof(t[0]), t.length > 1 ? atof(t[1]) : 0, t.length > 2 ? atof(t[2]) : 0);
}

/** "angle(deg), x, y, z" -> quaternion */
export function GetQuaternionFromString(quatString: string): Quaternion {
  const t: string[] = [];
  tokenize(quatString, t, ',');
  const angle = (atof(t[0]) / 360.0) * 2.0 * pi;
  const vector = new Vector3(atof(t[1]), atof(t[2]), atof(t[3]));
  return Quaternion.FromAngleAxis(angle, vector);
}

export function GetHashFromCharString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash;
}

/** assumes 10ms input timestep */
export class ValueHistory {
  protected values: number[] = [];
  constructor(protected maxTime_ms = 10000) {}

  Insert(value: number): void {
    this.values.push(value);
    if (this.values.length > this.maxTime_ms / 10) this.values.shift();
  }

  GetAverage(time_ms: number): number {
    let total = 0;
    let count = 0;
    if (this.values.length > 0) {
      let i = this.values.length - 1;
      while (count <= time_ms / 10) {
        total += this.values[i];
        count++;
        if (i === 0) break;
        i--;
      }
    }
    if (count > 0) total /= count;
    return total;
  }

  Clear(): void {
    this.values = [];
  }
}

/** ValueHistory for Vector3 values */
export class VectorValueHistory {
  protected values: Vector3[] = [];
  constructor(protected maxTime_ms = 10000) {}

  Insert(value: Vector3): void {
    this.values.push(value);
    if (this.values.length > this.maxTime_ms / 10) this.values.shift();
  }

  GetAverage(time_ms: number): Vector3 {
    let total = new Vector3(0);
    let count = 0;
    if (this.values.length > 0) {
      let i = this.values.length - 1;
      while (count <= time_ms / 10) {
        total = total.Add(this.values[i]);
        count++;
        if (i === 0) break;
        i--;
      }
    }
    if (count > 0) total = total.Div(count);
    return total;
  }

  Clear(): void {
    this.values = [];
  }
}
