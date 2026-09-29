// Match simulation.
//
// quickSim: background fixtures. Expected goals from line strengths (attack vs defence, home
// advantage), Poisson scores, scorers/assists weighted by position and rating, cards, the odd
// injury, substitutes and a rating for everyone who played.
//
// detailedSim: the user's matches when he chooses SIMULATE (or when the 3D engine is not
// available). Same expected-goals backbone, but played minute by minute so the user's own
// actions (touches, passes, key passes, dribbles, shots, tackles, saves, fouls, fatigue) are
// simulated from his 22 attributes and condition and feed back into chances for both sides.

import { STAT_NAMES, type Position } from './attributes';
import { INJURIES } from './data/injuries';
import { Rng, clamp } from './rng';
import { USER_ID, lineupStrength, type Lineup, type LineupEntry, type TeamStrength } from './selection';
import type { ReportEvent, UserMatchStats } from './types';

export interface NpcMatchLine {
  id: number;
  side: 0 | 1;
  mins: number;
  started: boolean;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  rating: number;
  injuryDays: number;
}

export interface MatchOutcome {
  hg: number;
  ag: number;
  pens?: [number, number];
  events: ReportEvent[];
  lines: NpcMatchLine[];
  user: UserMatchStats | null;
  possession: number;
  shots: [number, number];
  motmId: number;
  /** the user picked up an injury (days) */
  userInjuryDays: number;
}

export interface KnockoutRule {
  needed: boolean;
  /** goals already scored in the first leg, from this fixture's home side point of view */
  aggregate?: [number, number];
}

const SCORER_W: Record<Position, number> = { GK: 0.005, CB: 0.55, LB: 0.4, RB: 0.4, DM: 0.7, CM: 1.3, AM: 2.6, LM: 2.4, RM: 2.4, CF: 5.2 };
const ASSIST_W: Record<Position, number> = { GK: 0.05, CB: 0.35, LB: 1.1, RB: 1.1, DM: 0.9, CM: 2.2, AM: 3.0, LM: 2.7, RM: 2.7, CF: 1.6 };
const CARD_W: Record<Position, number> = { GK: 0.03, CB: 0.14, LB: 0.12, RB: 0.12, DM: 0.16, CM: 0.11, AM: 0.07, LM: 0.07, RM: 0.07, CF: 0.08 };

export function expectedGoals(home: TeamStrength, away: TeamStrength, neutral = false): [number, number] {
  const attH = home.att * 0.5 + home.mid * 0.5;
  const attA = away.att * 0.5 + away.mid * 0.5;
  const defH = home.def * 0.6 + home.gk * 0.25 + home.mid * 0.15;
  const defA = away.def * 0.6 + away.gk * 0.25 + away.mid * 0.15;
  const k = 0.055;
  let lh = 1.36 * Math.exp(k * (attH - defA));
  let la = 1.36 * Math.exp(k * (attA - defH));
  if (!neutral) {
    lh *= 1.12;
    la /= 1.08;
  }
  return [clamp(lh, 0.12, 4.8), clamp(la, 0.12, 4.8)];
}

function pickWeighted(rng: Rng, entries: LineupEntry[], w: (e: LineupEntry) => number): LineupEntry | null {
  if (entries.length === 0) return null;
  return rng.weighted(entries, w);
}

function shootout(rng: Rng, strongerHome: number): [number, number] {
  let h = 0;
  let a = 0;
  for (let i = 0; i < 5; i++) {
    if (rng.chance(0.76 + strongerHome * 0.01)) h++;
    if (rng.chance(0.76 - strongerHome * 0.01)) a++;
  }
  let guard = 0;
  while (h === a && guard++ < 20) {
    const sh = rng.chance(0.72);
    const sa = rng.chance(0.72);
    if (sh) h++;
    if (sa) a++;
  }
  if (h === a) h++;
  return [h, a];
}

/** everyone's rating after the fact (quick sims and the NPCs of detailed sims) */
function rateLines(rng: Rng, lines: NpcMatchLine[], entries: Map<number, LineupEntry>, hg: number, ag: number): void {
  const avg = [0, 0];
  const cnt = [0, 0];
  for (const l of lines) {
    const e = entries.get(l.id);
    if (!e) continue;
    avg[l.side] += e.rating;
    cnt[l.side]++;
  }
  for (const s of [0, 1]) avg[s] = cnt[s] ? avg[s] / cnt[s] : 60;
  for (const l of lines) {
    const e = entries.get(l.id);
    const pos = e?.pos ?? 'CM';
    const gf = l.side === 0 ? hg : ag;
    const ga = l.side === 0 ? ag : hg;
    const defensive = pos === 'GK' || pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'DM';
    let r = 6.35 + (e ? (e.rating - avg[l.side]) / 22 : 0);
    r += l.goals * 0.95 + l.assists * 0.55;
    r += gf > ga ? 0.35 : gf < ga ? -0.3 : 0;
    if (defensive) r += ga === 0 ? 0.45 : -0.18 * ga;
    if (pos === 'GK') r += ga === 0 ? 0.3 : -0.1 * ga;
    r -= l.yellow * 0.2 + l.red * 1.5;
    r += rng.gauss(0, 0.45);
    if (l.mins < 30) r = 6.2 + (r - 6.2) * 0.5;
    l.rating = clamp(Math.round(r * 10) / 10, 3.5, 10);
  }
}

function minuteList(rng: Rng, n: number, maxMinute = 90): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.int(1, maxMinute + (rng.chance(0.1) ? 4 : 0)));
  return out.sort((a, b) => a - b);
}

function injuryDays(rng: Rng, minorOnly: boolean): number {
  const def = rng.weighted(INJURIES, (i) => (minorOnly && i.severity > 0.5 ? i.weight * 0.3 : i.weight));
  return rng.int(def.minDays, def.maxDays);
}

export interface SimSideInput {
  lineup: Lineup;
  name: (id: number) => string;
}

/** background fixture */
export function quickSim(rng: Rng, home: SimSideInput, away: SimSideInput, ko: KnockoutRule, neutral = false): MatchOutcome {
  const sh = lineupStrength(home.lineup);
  const sa = lineupStrength(away.lineup);
  let [lh, la] = expectedGoals(sh, sa, neutral);
  let hg = rng.poisson(lh);
  let ag = rng.poisson(la);
  return finishOutcome(rng, home, away, sh, sa, hg, ag, lh, la, ko);
}

function finishOutcome(rng: Rng, home: SimSideInput, away: SimSideInput, sh: TeamStrength, sa: TeamStrength, hg: number, ag: number, lh: number, la: number, ko: KnockoutRule, fixedEvents?: ReportEvent[], userLines?: Set<number>): MatchOutcome {
  const events: ReportEvent[] = fixedEvents ? [...fixedEvents] : [];
  const sides = [home, away];
  const lines: NpcMatchLine[] = [];
  const entries = new Map<number, LineupEntry>();
  const lineOf = new Map<number, NpcMatchLine>();
  // appearances: starters + up to 3 subs each
  for (const s of [0, 1] as const) {
    const lu = sides[s].lineup;
    for (const e of lu.starters) {
      if (e.npcId === USER_ID) continue;
      const l: NpcMatchLine = { id: e.npcId, side: s, mins: 90, started: true, goals: 0, assists: 0, yellow: 0, red: 0, rating: 6, injuryDays: 0 };
      lines.push(l);
      lineOf.set(e.npcId, l);
      entries.set(e.npcId, e);
    }
    const subs = rng.shuffle(lu.bench.filter((b) => b.npcId !== USER_ID && b.pos !== 'GK')).slice(0, rng.int(2, 3));
    for (const sub of subs) {
      const outs = lu.starters.filter((e) => e.npcId !== USER_ID && e.pos !== 'GK' && lineOf.get(e.npcId)!.mins === 90);
      if (outs.length === 0) break;
      const off = rng.pick(outs);
      const minute = rng.int(55, 85);
      lineOf.get(off.npcId)!.mins = minute;
      const l: NpcMatchLine = { id: sub.npcId, side: s, mins: 90 - minute, started: false, goals: 0, assists: 0, yellow: 0, red: 0, rating: 6, injuryDays: 0 };
      lines.push(l);
      lineOf.set(sub.npcId, l);
      entries.set(sub.npcId, sub);
      if (!fixedEvents) {
        events.push({ minute, type: 'sub_on', side: s, name: sides[s].name(sub.npcId), text: `replaces ${sides[s].name(off.npcId)}` });
      }
    }
  }
  // goals (only when not already produced by the detailed sim)
  if (!fixedEvents) {
    for (const s of [0, 1] as const) {
      const n = s === 0 ? hg : ag;
      const lu = sides[s].lineup;
      const onPitch = [...lu.starters, ...lu.bench].filter((e) => lineOf.has(e.npcId));
      for (const minute of minuteList(rng, n)) {
        if (rng.chance(0.03)) {
          events.push({ minute, type: 'owngoal', side: s, name: 'Own goal' });
          continue;
        }
        const scorer = pickWeighted(rng, onPitch, (e) => SCORER_W[e.pos] * Math.pow(e.rating / 70, 3));
        if (!scorer) continue;
        const sl = lineOf.get(scorer.npcId)!;
        sl.goals++;
        let assistName: string | undefined;
        if (rng.chance(0.72)) {
          const helper = pickWeighted(
            rng,
            onPitch.filter((e) => e.npcId !== scorer.npcId),
            (e) => ASSIST_W[e.pos] * Math.pow(e.rating / 70, 2),
          );
          if (helper) {
            lineOf.get(helper.npcId)!.assists++;
            assistName = sides[s].name(helper.npcId);
          }
        }
        events.push({ minute, type: 'goal', side: s, name: sides[s].name(scorer.npcId), assist: assistName });
      }
    }
  } else {
    // credit NPC goals/assists recorded by the detailed sim
    for (const ev of fixedEvents) {
      if (ev.type !== 'goal' || ev.user) continue;
      const id = (ev as ReportEvent & { npcId?: number }).npcId;
      if (id !== undefined && lineOf.has(id)) lineOf.get(id)!.goals++;
      const aid = (ev as ReportEvent & { assistId?: number }).assistId;
      if (aid !== undefined && lineOf.has(aid)) lineOf.get(aid)!.assists++;
    }
  }
  // cards and injuries
  for (const l of lines) {
    const e = entries.get(l.id)!;
    const exposure = l.mins / 90;
    if (rng.chance(CARD_W[e.pos] * exposure)) {
      l.yellow = 1;
      const ym = rng.int(5, 84);
      events.push({ minute: ym, type: 'yellow', side: l.side, name: sides[l.side].name(l.id) });
      if (rng.chance(0.04)) {
        l.red = 1;
        events.push({ minute: rng.int(ym + 1, 90), type: 'red', side: l.side, name: sides[l.side].name(l.id), text: 'second yellow' });
      }
    } else if (rng.chance(0.0035 * exposure)) {
      l.red = 1;
      events.push({ minute: rng.int(10, 90), type: 'red', side: l.side, name: sides[l.side].name(l.id) });
    }
    if (rng.chance(0.0045 * exposure)) {
      l.injuryDays = injuryDays(rng, true);
      events.push({ minute: rng.int(5, 88), type: 'injury', side: l.side, name: sides[l.side].name(l.id) });
    }
  }
  // knockouts: extra time and penalties
  let pens: [number, number] | undefined;
  if (ko.needed) {
    const aggH = hg + (ko.aggregate ? ko.aggregate[0] : 0);
    const aggA = ag + (ko.aggregate ? ko.aggregate[1] : 0);
    if (aggH === aggA) {
      const eh = rng.poisson(lh * 0.3);
      const ea = rng.poisson(la * 0.3);
      if (!fixedEvents) {
        for (let i = 0; i < eh; i++) events.push({ minute: rng.int(91, 120), type: 'goal', side: 0, name: sides[0].name(pickWeighted(rng, sides[0].lineup.starters.filter((e) => e.npcId !== USER_ID), (e) => SCORER_W[e.pos])?.npcId ?? 0) });
        for (let i = 0; i < ea; i++) events.push({ minute: rng.int(91, 120), type: 'goal', side: 1, name: sides[1].name(pickWeighted(rng, sides[1].lineup.starters.filter((e) => e.npcId !== USER_ID), (e) => SCORER_W[e.pos])?.npcId ?? 0) });
      }
      hg += eh;
      ag += ea;
      if (hg + (ko.aggregate?.[0] ?? 0) === ag + (ko.aggregate?.[1] ?? 0)) pens = shootout(rng, (sh.overall - sa.overall) / 5);
    }
  }
  rateLines(rng, lines, entries, hg, ag);
  events.sort((a, b) => a.minute - b.minute);
  const possession = clamp(0.5 + (sh.mid - sa.mid) * 0.011 + rng.gauss(0, 0.04), 0.28, 0.72);
  const shots: [number, number] = [Math.max(hg, Math.round(lh * 5.5 + rng.gauss(0, 2))), Math.max(ag, Math.round(la * 5.5 + rng.gauss(0, 2)))];
  let motmId = -2;
  let best = -1;
  for (const l of lines) {
    if (userLines?.has(l.id)) continue;
    if (l.rating > best) {
      best = l.rating;
      motmId = l.id;
    }
  }
  return { hg, ag, pens, events, lines, user: null, possession, shots, motmId, userInjuryDays: 0 };
}

// ----- detailed sim (user's matches)

export interface UserSimInput {
  side: 0 | 1;
  /** position he plays (starting slot, or natural position when subbed on) */
  pos: Position;
  /** starts, or on the bench (may come on) */
  role: 'start' | 'bench';
  /** stats array (STAT_NAMES order) */
  stats: number[];
  /** match condition multiplier (footballer.conditionFactor) */
  condition: number;
  fitness: number;
  energy: number;
  hothead: boolean;
  flair: boolean;
  /** coach inclination to bring him on (0..1) */
  subChance: number;
  name: string;
  /** chance per minute of picking up a knock (lifestyle, fatigue) */
  injuryRisk: number;
}

const S = Object.fromEntries(STAT_NAMES.map((n, i) => [n, i])) as Record<(typeof STAT_NAMES)[number], number>;

const TOUCH_RATE: Record<Position, number> = { GK: 0.32, CB: 0.55, LB: 0.6, RB: 0.6, DM: 0.72, CM: 0.78, AM: 0.66, LM: 0.55, RM: 0.55, CF: 0.4 };
const DRIBBLE_SHARE: Record<Position, number> = { GK: 0, CB: 0.02, LB: 0.06, RB: 0.06, DM: 0.04, CM: 0.07, AM: 0.14, LM: 0.18, RM: 0.18, CF: 0.14 };
const KEYPASS_RATE: Record<Position, number> = { GK: 0.001, CB: 0.004, LB: 0.016, RB: 0.016, DM: 0.011, CM: 0.022, AM: 0.036, LM: 0.031, RM: 0.031, CF: 0.02 };
const DEF_RATE: Record<Position, number> = { GK: 0, CB: 0.085, LB: 0.07, RB: 0.07, DM: 0.085, CM: 0.055, AM: 0.025, LM: 0.03, RM: 0.03, CF: 0.015 };
const CHANCE_INTERVENE: Record<Position, number> = { GK: 0, CB: 0.2, LB: 0.12, RB: 0.12, DM: 0.14, CM: 0.07, AM: 0.03, LM: 0.04, RM: 0.04, CF: 0.02 };

function avgOf(stats: number[], names: (keyof typeof S)[]): number {
  let s = 0;
  for (const n of names) s += stats[S[n]];
  return s / names.length;
}

export function detailedSim(rng: Rng, home: SimSideInput, away: SimSideInput, ko: KnockoutRule, u: UserSimInput, neutral = false): MatchOutcome {
  const sh = lineupStrength(home.lineup);
  const sa = lineupStrength(away.lineup);
  const [lh, la] = expectedGoals(sh, sa, neutral);
  const sides = [home, away];
  const strength = [sh, sa];
  const lam = [lh, la];
  const us = u.side;
  const them = (1 - us) as 0 | 1;
  const line = u.pos === 'GK' ? 'GK' : ['CB', 'LB', 'RB'].includes(u.pos) ? 'DEF' : ['DM', 'CM', 'AM'].includes(u.pos) ? 'MID' : 'ATT';

  // base chance rates; the user's own creativity/defending supplies part of his team's output
  const CONV = 0.26;
  const baseRate = [lh / CONV / 92, la / CONV / 92];
  const attacker = line === 'ATT' || u.pos === 'AM';
  baseRate[us] *= attacker ? 0.86 : line === 'MID' ? 0.9 : 0.97;
  if (line === 'DEF' || u.pos === 'DM') baseRate[them] *= 1.1;

  const st = u.stats;
  const passSkill = avgOf(st, ['technical_shortpass', 'technical_shortpass', 'mental_vision', 'technical_ballcontrol', 'mental_calmness']);
  const visionSkill = avgOf(st, ['mental_vision', 'technical_highpass', 'mental_offensivepositioning']);
  const dribbleSkill = avgOf(st, ['technical_dribble', 'technical_dribble', 'physical_agility', 'physical_acceleration', 'technical_ballcontrol']);
  const finishSkill = avgOf(st, ['technical_shot', 'technical_shot', 'mental_calmness', 'mental_offensivepositioning', 'physical_shotpower', 'technical_volley']);
  const headerSkill = avgOf(st, ['technical_header', 'physical_balance', 'mental_offensivepositioning']);
  const tackleSkill = avgOf(st, ['technical_standingtackle', 'technical_slidingtackle', 'mental_defensivepositioning', 'physical_reaction', 'physical_balance']);
  const gkSkill = avgOf(st, ['physical_reaction', 'physical_reaction', 'physical_agility', 'mental_defensivepositioning', 'physical_balance', 'mental_calmness']);
  const stamina = avgOf(st, ['physical_stamina', 'mental_workrate']);
  const calm = st[S.mental_calmness];
  const userEntry = [...sides[us].lineup.starters, ...sides[us].lineup.bench].find((e) => e.npcId === USER_ID);
  const userRating = userEntry ? userEntry.rating : 60;
  const oppMid = strength[them].mid / 100;
  const oppDef = strength[them].def / 100;
  const oppAtt = strength[them].att / 100;

  const stats: UserMatchStats = { minutes: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, passes: 0, passesCompleted: 0, keyPasses: 0, dribbles: 0, tackles: 0, interceptions: 0, saves: 0, fouls: 0, yellow: 0, red: 0, rating: 6.0, motm: false };
  let rating = 6.0;
  const events: (ReportEvent & { npcId?: number; assistId?: number })[] = [];
  const goals = [0, 0];
  const shots = [0, 0];
  let onPitch = u.role === 'start';
  let subOnMinute = -1;
  let subOffMinute = 99;
  if (u.role === 'bench' && rng.chance(u.subChance)) subOnMinute = rng.int(56, 82);
  const stoppage = rng.int(1, 5);
  const endMinute = 90 + stoppage;
  let fatigue = 0;
  let userInjuryDays = 0;
  const possession = clamp(0.5 + (strength[0].mid - strength[1].mid) * 0.011 + rng.gauss(0, 0.04), 0.28, 0.72);
  const usPoss = us === 0 ? possession : 1 - possession;
  const condition = u.condition;

  const npcEntries = (s: 0 | 1) => sides[s].lineup.starters.filter((e) => e.npcId !== USER_ID);
  const gkRating = (s: 0 | 1) => sides[s].lineup.starters.find((e) => e.pos === 'GK')?.rating ?? 55;

  const scoreGoal = (s: 0 | 1, minute: number, scorerId: number | null, assistId: number | null, how: string) => {
    goals[s]++;
    const ev: ReportEvent & { npcId?: number; assistId?: number } = {
      minute,
      type: 'goal',
      side: s,
      name: scorerId === null ? u.name : sides[s].name(scorerId),
      assist: assistId === null ? (scorerId === null ? undefined : u.name) : assistId === -99 ? undefined : sides[s].name(assistId),
      user: scorerId === null,
      text: how === 'finish' ? undefined : how,
    };
    if (scorerId !== null) ev.npcId = scorerId;
    if (assistId !== null && assistId !== -99) ev.assistId = assistId;
    events.push(ev);
    if (onPitch) {
      if (s === us) rating += line === 'ATT' ? 0.08 : 0.1;
      else rating -= line === 'DEF' ? 0.28 : line === 'GK' ? 0.35 : line === 'MID' ? 0.1 : 0.04;
    }
  };

  const chance = (s: 0 | 1, minute: number, creator: 'user' | 'team', quality = 1) => {
    shots[s]++;
    const entries = npcEntries(s);
    let userShoots = false;
    let shooterId: number | null = null;
    let assistId: number | null = -99;
    if (s === us && onPitch && creator === 'team') {
      const w = SCORER_W[u.pos];
      const total = entries.reduce((a, e) => a + SCORER_W[e.pos], 0) + w;
      userShoots = rng.chance((w / total) * (0.78 + fatigueFree() * 0.17));
    }
    if (creator === 'user') {
      // the user created it: a teammate finishes
      const scorer = pickWeighted(rng, entries, (e) => SCORER_W[e.pos] * Math.pow(e.rating / 70, 3));
      shooterId = scorer?.npcId ?? null;
      assistId = null; // user
    } else if (!userShoots) {
      const scorer = pickWeighted(rng, entries, (e) => SCORER_W[e.pos] * Math.pow(e.rating / 70, 3));
      shooterId = scorer?.npcId ?? null;
      if (rng.chance(0.72)) {
        const withUser = s === us && onPitch;
        const wUser = withUser ? ASSIST_W[u.pos] * (0.3 + visionSkill * 0.55) : 0;
        const others = entries.filter((e) => e.npcId !== shooterId);
        const total = others.reduce((a, e) => a + ASSIST_W[e.pos], 0) + wUser;
        if (withUser && rng.chance(wUser / Math.max(0.01, total))) assistId = null;
        else assistId = pickWeighted(rng, others, (e) => ASSIST_W[e.pos])?.npcId ?? -99;
      }
    }
    // defending user can block or intercept before the shot
    if (s === them && onPitch && line !== 'GK' && rng.chance(CHANCE_INTERVENE[u.pos] * (0.6 + tackleSkill) * condition * fatigueFree())) {
      stats.interceptions++;
      rating += 0.2;
      return;
    }
    let finishing: number;
    if (userShoots) {
      // on the same scale as NPC ratings: his slot rating, tilted by how good a finisher he is
      const skill = (u.pos === 'CB' || u.pos === 'GK' ? headerSkill : finishSkill) * 100;
      finishing = (userRating + (skill - userRating) * 0.3) * fatigueFree();
    } else {
      const e = entries.find((x) => x.npcId === shooterId);
      finishing = e ? e.rating : 60;
    }
    // the keeper facing the shot: the opponents' keeper, or the user himself when he is in goal
    const gkRate = s === us ? gkRating(them) : line === 'GK' && onPitch ? gkSkill * 100 * condition : gkRating(us);
    const pOnTarget = clamp(0.42 + (finishing - 60) * 0.006, 0.25, 0.78);
    const pGoal = Math.min(pOnTarget * 0.92, clamp(CONV * quality * Math.exp(0.024 * (finishing - gkRate)), 0.04, 0.6));
    const onTarget = rng.chance(pOnTarget);
    if (userShoots) {
      stats.shots++;
      if (onTarget) stats.shotsOnTarget++;
    }
    const scored = onTarget && rng.chance(pGoal / pOnTarget);
    if (scored) {
      if (userShoots) {
        stats.goals++;
        rating += 0.85;
        scoreGoal(s, minute, null, assistId, 'finish');
        return;
      }
      if (assistId === null) {
        stats.assists++;
        rating += 0.55;
      }
      scoreGoal(s, minute, shooterId, assistId, 'finish');
    } else if (onTarget) {
      if (s === them && line === 'GK' && onPitch) {
        stats.saves++;
        rating += 0.28;
        events.push({ minute, type: 'save', side: us, name: u.name, user: true });
      } else if (userShoots) {
        rating += 0.08;
        events.push({ minute, type: 'chance', side: s, name: u.name, user: true, text: 'saved' });
      }
    } else if (userShoots) {
      rating -= 0.05;
      if (quality > 1.2) events.push({ minute, type: 'chance', side: s, name: u.name, user: true, text: 'missed a big chance' });
    }
  };

  function fatigueFree(): number {
    return clamp(1 - fatigue, 0.7, 1);
  }

  for (let minute = 1; minute <= endMinute; minute++) {
    if (!onPitch && subOnMinute === minute) {
      onPitch = true;
      events.push({ minute, type: 'sub_on', side: us, name: u.name, user: true });
    }
    if (onPitch && minute === subOffMinute) {
      onPitch = false;
      events.push({ minute, type: 'sub_off', side: us, name: u.name, user: true });
    }
    if (onPitch) {
      stats.minutes++;
      // fatigue builds up from ~55 minutes, faster with low stamina/fitness/energy
      if (minute > 55) fatigue += (0.0035 * (1.3 - stamina)) * (1.4 - u.fitness / 100) * (1.3 - u.energy / 160);
      // touches and passing
      const touches = TOUCH_RATE[u.pos] * (0.75 + usPoss * 0.5);
      if (rng.chance(clamp(touches, 0, 0.95))) {
        const dribbleShare = DRIBBLE_SHARE[u.pos] * (u.flair ? 1.5 : 1);
        if (rng.chance(dribbleShare)) {
          const p = clamp(0.4 + (dribbleSkill * condition * fatigueFree() - oppDef) * 1.3, 0.12, 0.85);
          if (rng.chance(p)) {
            stats.dribbles++;
            rating += 0.06;
            if (rng.chance(0.14)) {
              if (rng.chance(0.55)) chance(us, minute, 'team', 1.15);
              else chance(us, minute, 'user', 0.8);
            }
          } else rating -= 0.04;
        } else {
          stats.passes++;
          const pComp = clamp(0.66 + (passSkill * condition * fatigueFree() - oppMid) * 0.9 + (u.pos === 'CB' || u.pos === 'GK' ? 0.06 : 0) - (u.pos === 'CF' ? 0.06 : 0), 0.5, 0.96);
          if (rng.chance(pComp)) {
            stats.passesCompleted++;
            rating += 0.006;
            if (rng.chance(KEYPASS_RATE[u.pos] * (0.4 + visionSkill * 1.3))) {
              stats.keyPasses++;
              rating += 0.07;
              // most key passes lead to a half-chance; vision makes them clearer
              chance(us, minute, 'user', 0.55 + visionSkill * 0.35);
            }
          } else {
            rating -= 0.028;
            if (rng.chance(0.012)) {
              // a sloppy pass in a dangerous area
              events.push({ minute, type: 'chance', side: them, name: u.name, user: true, text: 'lost the ball in a dangerous area' });
              rating -= 0.2;
              chance(them, minute, 'team', 1.2);
            }
          }
        }
      }
      // defending
      if (line !== 'GK' && rng.chance(DEF_RATE[u.pos] * (1.25 - usPoss * 0.5))) {
        const p = clamp(0.5 + (tackleSkill * condition * fatigueFree() - oppAtt) * 1.2, 0.2, 0.9);
        if (rng.chance(p)) {
          stats.tackles++;
          rating += 0.1;
        } else if (rng.chance(clamp(0.3 - calm * 0.2 + (u.hothead ? 0.1 : 0), 0.05, 0.4))) {
          stats.fouls++;
          rating -= 0.05;
          if (rng.chance(0.14 + (u.hothead ? 0.1 : 0))) {
            stats.yellow++;
            rating -= 0.25;
            events.push({ minute, type: stats.yellow >= 2 ? 'red' : 'yellow', side: us, name: u.name, user: true, text: stats.yellow >= 2 ? 'second yellow' : undefined });
            if (stats.yellow >= 2) {
              stats.red = 1;
              rating -= 1.5;
              onPitch = false;
              baseRate[them] *= 1.3;
              baseRate[us] *= 0.75;
            }
          }
        }
      }
      // straight red for a reckless challenge
      if (line !== 'GK' && rng.chance(0.0003 + (u.hothead ? 0.0006 : 0))) {
        stats.red = 1;
        rating -= 2;
        events.push({ minute, type: 'red', side: us, name: u.name, user: true, text: 'reckless challenge' });
        onPitch = false;
        baseRate[them] *= 1.3;
        baseRate[us] *= 0.75;
      }
      // knocks
      if (rng.chance(u.injuryRisk * (1 + fatigue * 6))) {
        userInjuryDays = -1; // resolved by the caller (injury system)
        events.push({ minute, type: 'injury', side: us, name: u.name, user: true });
        onPitch = false;
        subOffMinute = minute;
      }
      // the coach subs him off when tired or poor
      if (onPitch && u.role === 'start' && subOffMinute === 99 && (minute === 62 || minute === 72 || minute === 80)) {
        const tired = fatigue > 0.18;
        const poor = rating < 5.9;
        if ((tired && rng.chance(0.55)) || (poor && rng.chance(0.45)) || rng.chance(0.06)) subOffMinute = minute + 1;
      }
    }
    // team chances
    for (const s of [0, 1] as const) {
      if (rng.chance(baseRate[s])) chance(s, minute, 'team');
    }
  }

  let hg = goals[0];
  let ag = goals[1];
  let pens: [number, number] | undefined;
  if (ko.needed) {
    const aggH = hg + (ko.aggregate?.[0] ?? 0);
    const aggA = ag + (ko.aggregate?.[1] ?? 0);
    if (aggH === aggA) {
      // extra time, compressed
      for (let minute = 91; minute <= 120; minute++) {
        for (const s of [0, 1] as const) if (rng.chance(baseRate[s] * 0.85)) chance(s, minute, 'team');
        if (onPitch) stats.minutes++;
      }
      hg = goals[0];
      ag = goals[1];
      if (hg + (ko.aggregate?.[0] ?? 0) === ag + (ko.aggregate?.[1] ?? 0)) pens = shootout(rng, (sh.overall - sa.overall) / 5);
    }
  }

  // team result bonuses
  const gf = us === 0 ? hg : ag;
  const ga = us === 0 ? ag : hg;
  if (stats.minutes > 0) {
    rating += gf > ga ? 0.3 : gf < ga ? -0.25 : 0;
    if ((line === 'DEF' || line === 'GK') && ga === 0 && stats.minutes >= 60) rating += 0.5;
    if (stats.minutes < 25) rating = 6.1 + (rating - 6.1) * 0.6;
    stats.rating = clamp(Math.round((rating + rng.gauss(0, 0.15)) * 10) / 10, 3, 10);
  } else stats.rating = 0;

  const userIds = new Set<number>();
  const outcome = finishOutcome(rng, home, away, sh, sa, hg, ag, lam[0], lam[1], { needed: false }, events, userIds);
  outcome.pens = pens;
  outcome.hg = hg;
  outcome.ag = ag;
  outcome.shots = [Math.max(shots[0], hg), Math.max(shots[1], ag)];
  outcome.possession = possession;
  outcome.user = stats;
  outcome.userInjuryDays = userInjuryDays;
  if (stats.minutes > 0) {
    const bestNpc = outcome.lines.reduce((m, l) => Math.max(m, l.rating), 0);
    if (stats.rating >= bestNpc) {
      stats.motm = true;
      outcome.motmId = USER_ID;
    }
  }
  // user card events come from the detailed loop; NPC cards were added by finishOutcome
  return outcome;
}
