// Retirement and legacy: why the career ended, what he does next (decided by the choices made
// along the way: coaching badges, courses, fame, money, charity, loyalty), a legacy score, and
// the hall of fame entry that survives across careers.

import { nationName } from './data/geography';
import { fullName, userAge, userOvr } from './footballer';
import { addTimeline } from './messages';
import { netWorth } from './life';
import { milestoneCount, milestonePoints } from './milestones';
import { avgRating, emptyLine } from './players';
import type { CareerState, Legacy, StatLine } from './types';

export interface HallOfFameEntry {
  id: string;
  name: string;
  nat: string;
  pos: string;
  seasons: number;
  apps: number;
  goals: number;
  assists: number;
  caps: number;
  trophies: number;
  awards: number;
  peakOvr: number;
  score: number;
  next: string;
  retiredAge: number;
  clubs: string[];
  finishedAt: number;
  /** milestones reached (entries from older versions lack it) */
  milestones?: number;
}

export function careerTotals(state: CareerState): StatLine {
  const t = emptyLine();
  for (const r of state.user.history) for (const line of [r.league, r.cup, r.continental]) for (const k of Object.keys(t) as (keyof StatLine)[]) t[k] += line[k];
  for (const line of [state.user.season.league, state.user.season.cup, state.user.season.continental]) for (const k of Object.keys(t) as (keyof StatLine)[]) t[k] += line[k];
  return t;
}

export function peakOvr(state: CareerState): number {
  return Math.max(Math.round(userOvr(state.user)), ...state.user.history.map((h) => h.ovrEnd));
}

export function legacyScore(state: CareerState): number {
  const u = state.user;
  const t = careerTotals(state);
  const score = t.apps * 0.6 + t.goals * 1.6 + t.assists * 0.8 + u.caps * 2 + u.intlGoals * 3 + u.trophies.length * 25 + u.awards.length * 18 + Math.max(0, peakOvr(state) - 60) * 12 + u.rep.world * 2 + state.life.charity.points * 0.5 + milestonePoints(state) * 0.5;
  return Math.round(score);
}

/** what he does after football, from the choices made in his career */
export function nextChapter(state: CareerState): { next: string; detail: string } {
  const edu = state.life.education.completed;
  const u = state.user;
  const money = netWorth(state);
  const clubCounts = new Map<string, number>();
  for (const h of u.history) clubCounts.set(h.clubName, (clubCounts.get(h.clubName) ?? 0) + h.league.apps);
  const [legendClub, legendApps] = [...clubCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  if (edu.includes('coach_pro')) return { next: 'Head coach', detail: `With a Pro Licence in hand, ${u.last} takes his first top-flight job. The dugout suits him.` };
  if (edu.includes('coach_a')) return { next: 'Head coach (lower leagues)', detail: `${u.last} starts his managerial career in the lower leagues, learning the trade the hard way.` };
  if (edu.includes('coach_b')) return { next: 'Assistant coach', detail: `${u.last} joins a coaching staff as an assistant, working towards his A licence.` };
  if (edu.includes('coach_c')) return { next: 'Academy coach', detail: `${u.last} goes back to where it all began: coaching kids at an academy.` };
  if (edu.includes('media') || (u.followers > 1_000_000 && u.rep.national > 60)) return { next: 'TV pundit', detail: `${u.last} becomes a sharp, popular pundit — the camera loves him.` };
  if (edu.includes('business') || money > 20_000_000) return { next: 'Entrepreneur', detail: `${u.last} builds a business empire: restaurants, a clothing line and a stake in a club.` };
  if (edu.includes('sports_science')) return { next: 'Performance coach', detail: `${u.last} uses his sports-science diploma to become a sought-after performance coach.` };
  if (state.life.charity.foundation) return { next: 'Philanthropist', detail: `${u.last} dedicates his time to his foundation, changing thousands of lives.` };
  if (legendApps > 200) return { next: 'Club ambassador', detail: `${legendClub} make their legend a club ambassador. He never pays for a drink in town again.` };
  return { next: 'Family life', detail: `${u.last} steps away from football to enjoy life with family and friends.` };
}

export function retire(state: CareerState, reason: string): Legacy {
  const chapter = nextChapter(state);
  const legacy: Legacy = { retiredDay: state.day, age: Math.floor(userAge(state)), reason, next: chapter.next, nextDetail: chapter.detail, score: legacyScore(state) };
  state.retired = legacy;
  state.pendingMatch = null;
  state.events.pending = null;
  addTimeline(state, `Retired from professional football (${reason})`, 'info');
  return legacy;
}

export function hallOfFameEntry(state: CareerState): HallOfFameEntry {
  const u = state.user;
  const t = careerTotals(state);
  const clubs: string[] = [];
  for (const h of u.history) if (!clubs.includes(h.clubName) && h.clubName !== 'Free agent') clubs.push(h.clubName);
  return {
    id: state.id,
    name: fullName(u),
    nat: nationName(u.nat),
    pos: u.pos,
    seasons: u.history.length,
    apps: t.apps,
    goals: t.goals,
    assists: t.assists,
    caps: u.caps,
    trophies: u.trophies.length,
    awards: u.awards.length,
    peakOvr: peakOvr(state),
    score: state.retired?.score ?? legacyScore(state),
    next: state.retired?.next ?? '',
    retiredAge: state.retired?.age ?? Math.floor(userAge(state)),
    clubs,
    finishedAt: Date.now(),
    milestones: milestoneCount(state).got,
  };
}

export function careerAverageRating(state: CareerState): number {
  return avgRating(careerTotals(state));
}
