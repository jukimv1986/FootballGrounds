// Port of blunted/base/properties: a string -> string map with typed getters.

import { Vector3 } from './math/vector3';
import { GetVectorFromString, atof, int_to_str, real_to_str } from './utils';

export class Properties {
  protected properties = new Map<string, string>();

  Exists(name: string): boolean {
    return this.properties.has(name);
  }

  /** C++ Set(name, string) and Set(name, real) */
  Set(name: string, value: string | number): void {
    this.properties.set(name, typeof value === 'number' ? real_to_str(value) : value);
  }

  SetInt(name: string, value: number): void {
    this.properties.set(name, int_to_str(value));
  }

  SetBool(name: string, value: boolean): void {
    this.properties.set(name, value ? 'true' : 'false');
  }

  Get(name: string, defaultValue = ''): string {
    const v = this.properties.get(name);
    return v === undefined ? defaultValue : v;
  }

  GetBool(name: string, defaultValue = false): boolean {
    const v = this.properties.get(name);
    return v === undefined ? defaultValue : v === 'true';
  }

  GetReal(name: string, defaultValue = 0): number {
    const v = this.properties.get(name);
    return v === undefined ? defaultValue : atof(v);
  }

  GetInt(name: string, defaultValue = 0): number {
    const v = this.properties.get(name);
    return v === undefined ? defaultValue : Math.floor(atof(v));
  }

  GetVector3(name: string, defaultValue: Vector3 = new Vector3(0, 0, 0)): Vector3 {
    const v = this.properties.get(name);
    return v === undefined ? defaultValue : GetVectorFromString(v);
  }

  AddProperties(userprops: Properties | null | undefined): void {
    if (!userprops) return;
    for (const [k, v] of userprops.properties) this.properties.set(k, v);
  }

  /** returns the properties ordered by key, like the original std::map */
  GetProperties(): Map<string, string> {
    return new Map([...this.properties.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
  }

  /** parses the `"name" "value"` per line config format */
  LoadFromString(source: string): void {
    for (const line of source.split('\n')) {
      const m = /"([^"]*)"\s*"([^"]*)"/.exec(line);
      if (m && m[1].length > 0 && m[2].length > 0) this.Set(m[1], m[2]);
    }
  }

  SaveToString(): string {
    let s = '';
    for (const [k, v] of this.GetProperties()) s += `"${k}" "${v}"\n`;
    return s;
  }

  Clone(): Properties {
    const p = new Properties();
    p.AddProperties(this);
    return p;
  }

  Print(): void {
    console.log(this.SaveToString());
  }
}
