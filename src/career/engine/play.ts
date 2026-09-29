// PLAY: the user's match in the 3D engine ("be a pro": he controls only himself).
//
// Flow: register both sides in GetDB() (bridge.ts) -> paint + register generated kits/logos
// (kits.ts) -> StartMatchSession with lockedPlayerDatabaseID = the user's engine id -> convert
// the MatchResult and apply it through the same path as a simulated match. If the engine is not
// available (or the match is abandoned) the match is simulated instead, so the career never
// gets stuck. The registration is always removed afterwards.

import { HasMatchSessionRunner, StartMatchSession, type MatchResult } from '../../app/matchsession';
import type { SideSelection } from '../../game/menu/menutask';
import { GetControllers, GetDB } from '../../game/globals';
import { finishPendingMatch, pendingMatchContext, simulatePendingMatch } from '../core/career';
import { comp } from '../core/index';
import { teamName } from '../core/competitions';
import type { CareerState, KitPattern, MatchReport } from '../core/types';
import { kitNumbers, registerMatch, resultToOutcome, sideIdentity, unregisterCareer, type Registration } from './bridge';
import { prepareKits } from './kits';

export interface PlayResult {
  report: MatchReport | null;
  /** true when the match had to be simulated instead */
  simulated: boolean;
  note?: string;
}

export function canPlay3D(state: CareerState): { ok: boolean; reason?: string } {
  const ctx = pendingMatchContext(state);
  if (!ctx) return { ok: false, reason: 'No match today' };
  if (ctx.role !== 'start') return { ok: false, reason: ctx.role === 'bench' ? 'You start on the bench — only starters can play the match in 3D' : 'You are not in the squad' };
  if (!HasMatchSessionRunner()) return { ok: false, reason: 'The 3D match engine is not available in this build' };
  return { ok: true };
}

function userSides(userSide: -1 | 1): SideSelection[] {
  let controllers: unknown[] = [];
  try {
    controllers = GetControllers();
  } catch {
    controllers = [];
  }
  if (controllers.length < 2) return [{ controllerID: 0, side: userSide }];
  // like the quick match default: with several controllers the first gamepad plays
  return controllers.map((_, i) => ({ controllerID: i, side: i === 1 ? userSide : 0 }));
}

export interface PlayHooks {
  /** loading progress 0..1 (to drive a loading screen) */
  onLoadProgress?: (fraction: number) => void;
  /** called right before StartMatchSession with the registration (for loading screens) */
  onRegistered?: (reg: Registration) => void;
}

export async function playPendingMatch3D(state: CareerState, hooks: PlayHooks = {}): Promise<PlayResult> {
  const ctx = pendingMatchContext(state);
  if (!ctx) return { report: null, simulated: false };
  const can = canPlay3D(state);
  if (!can.ok) return { report: simulatePendingMatch(state), simulated: true, note: can.reason };
  let db;
  try {
    db = GetDB();
  } catch {
    return { report: simulatePendingMatch(state), simulated: true, note: 'Match database not loaded' };
  }
  const f = ctx.fixture;
  const reg = registerMatch(state, ctx, db);
  let result: MatchResult | null = null;
  let note: string | undefined;
  try {
    const clubPattern = (id: number): KitPattern => state.world.clubs[id]?.kitPattern ?? 'plain';
    const clubSponsor = (id: number): string => state.world.clubs[id]?.sponsor ?? '';
    await prepareKits(reg, [f.national ? 'plain' : clubPattern(f.home), f.national ? 'plain' : clubPattern(f.away)], [f.national ? '' : clubSponsor(f.home), f.national ? '' : clubSponsor(f.away)], [sideIdentity(state, f.home, !!f.youth).short, sideIdentity(state, f.away, !!f.youth).short]);
    hooks.onRegistered?.(reg);
    const [homeKit, awayKit] = kitNumbers(reg);
    const c = comp(state, f.compId);
    result = await StartMatchSession({
      homeTeamDatabaseID: reg.teamIds[0],
      awayTeamDatabaseID: reg.teamIds[1],
      homeKit,
      awayKit,
      sides: userSides(ctx.side === 0 ? -1 : 1),
      lockedPlayerDatabaseID: reg.userEngineId ?? undefined,
      matchDuration: state.settings.matchDuration ?? undefined,
      title: `${c?.name ?? 'Match'} · ${teamName(state, f.home, f.youth)} vs ${teamName(state, f.away, f.youth)}`,
      onLoadProgress: hooks.onLoadProgress,
    });
  } catch (e) {
    note = e instanceof Error && /not available/.test(e.message) ? 'The 3D match engine is not available — the match was simulated.' : `The 3D match failed (${e instanceof Error ? e.message : String(e)}) — the match was simulated.`;
  } finally {
    unregisterCareer(db);
  }
  if (!result) return { report: simulatePendingMatch(state), simulated: true, note };
  if (result.abandoned) return { report: simulatePendingMatch(state), simulated: true, note: 'You left the match early — the result was simulated.' };
  const out = resultToOutcome(state, ctx, reg, result);
  return { report: finishPendingMatch(state, out, true), simulated: false };
}
