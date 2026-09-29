// Persistent game configuration (C++: football.config next to the executable, read with
// Properties::LoadFile / written with SaveFile). In the browser the configuration lives in
// localStorage under "football.config", in the same `"name" "value"` per line format.

import { Properties } from '../blunted/base/properties';
import { GetConfiguration } from '../game/globals';

export const CONFIG_STORAGE_KEY = 'football.config';

/**
 * Builds the configuration: the shipped defaults (public/data/football.config, if preloaded and
 * passed in) overridden by what the player saved in this browser.
 */
export function LoadConfiguration(defaults = ''): Properties {
  const config = new Properties();
  if (defaults) config.LoadFromString(defaults);
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) config.LoadFromString(stored);
  } catch {
    // storage unavailable (private mode, blocked site data): run with defaults
  }
  return config;
}

/** writes GetConfiguration() to localStorage (C++ GetConfiguration()->SaveFile(GetConfigFilename())) */
export function SaveConfiguration(): boolean {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, GetConfiguration().SaveToString());
    return true;
  } catch {
    return false;
  }
}

/** real value in 0..1 from the configuration, clamped */
export function GetConfigUnit(name: string, defaultValue: number): number {
  const v = GetConfiguration().GetReal(name, defaultValue);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : defaultValue;
}
