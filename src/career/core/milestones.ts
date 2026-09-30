// Career milestones: the landmarks of a life in football, on and off the pitch (debut, first
// goal, 100 appearances, first cap, first trophy, own home, first car, marriage, becoming a
// parent, coaching badges, a million followers…). They are checked once a day from the state
// itself (no bookkeeping at the places where things happen), unlocked for good with the day they
// were reached, celebrated with a notice and a small morale boost, listed on the profile and
// counted in the legacy score and the hall of fame.

import { CONTINENTAL_NAME } from './competitions';
import { userOvr } from './footballer';
import { club } from './index';
import { netWorth } from './life';
import { addNotice, addTimeline } from './messages';
import { clamp } from './rng';
import type { CareerState } from './types';

export type MilestoneCategory = 'football' | 'honours' | 'life' | 'fame';

export interface MilestoneDef {
  key: string;
  name: string;
  desc: string;
  category: MilestoneCategory;
  /** 1 bronze, 2 silver, 3 gold: legacy points and how loudly it is celebrated */
  tier: 1 | 2 | 3;
  check: (s: CareerState) => boolean;
}

export const MILESTONE_CATEGORY_NAMES: Record<MilestoneCategory, string> = { football: 'On the pitch', honours: 'Honours', life: 'Life', fame: 'Fame & fortune' };

function worth(s: CareerState): number {
  return netWorth(s);
}

function stage(s: CareerState): string | undefined {
  const id = s.life.partnerId;
  return id === null ? undefined : s.life.people.find((p) => p.id === id && !p.gone)?.stage;
}

function seasonsAtOneClub(s: CareerState): number {
  const counts = new Map<string, number>();
  for (const h of s.user.history) if (h.clubName !== 'Free agent' && !h.loan) counts.set(h.clubName, (counts.get(h.clubName) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

function clubsPlayedFor(s: CareerState): number {
  const set = new Set<number>();
  for (const h of s.user.history) if (h.clubId >= 0) set.add(h.clubId);
  if (s.user.clubId >= 0) set.add(s.user.clubId);
  return set.size;
}

/** senior competitive totals (league, cup, continental) including the running season */
function t(s: CareerState): { apps: number; goals: number; assists: number } {
  const out = { apps: 0, goals: 0, assists: 0 };
  const lines = [s.user.season.league, s.user.season.cup, s.user.season.continental];
  for (const h of s.user.history) lines.push(h.league, h.cup, h.continental);
  for (const l of lines) {
    out.apps += l.apps;
    out.goals += l.goals;
    out.assists += l.assists;
  }
  return out;
}

export const MILESTONES: MilestoneDef[] = [
  // on the pitch
  { key: 'pro_contract', name: 'Professional', desc: 'Sign your first professional contract.', category: 'football', tier: 1, check: (s) => s.user.contract.kind === 'pro' && s.user.clubId >= 0 },
  { key: 'debut', name: 'The debut', desc: 'Play your first senior competitive match.', category: 'football', tier: 1, check: (s) => t(s).apps >= 1 },
  { key: 'first_goal', name: 'Off the mark', desc: 'Score your first senior goal.', category: 'football', tier: 1, check: (s) => t(s).goals >= 1 },
  { key: 'hat_trick', name: 'Match ball', desc: 'Score a hat-trick in a senior match.', category: 'football', tier: 2, check: (s) => s.reports.some((r) => !r.youth && (r.user?.goals ?? 0) >= 3) },
  { key: 'apps_50', name: 'Fifty not out', desc: '50 senior appearances.', category: 'football', tier: 1, check: (s) => t(s).apps >= 50 },
  { key: 'apps_100', name: 'Centurion', desc: '100 senior appearances.', category: 'football', tier: 2, check: (s) => t(s).apps >= 100 },
  { key: 'apps_300', name: 'Mr Reliable', desc: '300 senior appearances.', category: 'football', tier: 2, check: (s) => t(s).apps >= 300 },
  { key: 'apps_500', name: 'Five hundred', desc: '500 senior appearances.', category: 'football', tier: 3, check: (s) => t(s).apps >= 500 },
  { key: 'goals_10', name: 'Double figures', desc: '10 senior goals.', category: 'football', tier: 1, check: (s) => t(s).goals >= 10 },
  { key: 'goals_50', name: 'Goal machine', desc: '50 senior goals.', category: 'football', tier: 2, check: (s) => t(s).goals >= 50 },
  { key: 'goals_100', name: 'Club 100', desc: '100 senior goals.', category: 'football', tier: 3, check: (s) => t(s).goals >= 100 },
  { key: 'goals_200', name: 'Living legend', desc: '200 senior goals.', category: 'football', tier: 3, check: (s) => t(s).goals >= 200 },
  { key: 'assists_50', name: 'Provider', desc: '50 senior assists.', category: 'football', tier: 2, check: (s) => t(s).assists >= 50 },
  { key: 'motm_10', name: 'Man of the moment', desc: '10 player-of-the-match awards.', category: 'football', tier: 2, check: (s) => s.user.totals.motm >= 10 },
  { key: 'ovr_70', name: 'Top-flight level', desc: 'Reach a rating of 70.', category: 'football', tier: 1, check: (s) => userOvr(s.user) >= 70 },
  { key: 'ovr_80', name: 'Elite', desc: 'Reach a rating of 80.', category: 'football', tier: 2, check: (s) => userOvr(s.user) >= 80 },
  { key: 'ovr_88', name: 'World class', desc: 'Reach a rating of 88.', category: 'football', tier: 3, check: (s) => userOvr(s.user) >= 88 },
  { key: 'first_transfer', name: 'On the move', desc: 'Play for a second club.', category: 'football', tier: 1, check: (s) => clubsPlayedFor(s) >= 2 },
  { key: 'big_club', name: 'The big time', desc: 'Sign for one of the continent\'s giants.', category: 'football', tier: 2, check: (s) => (club(s, s.user.clubId)?.reputation ?? 0) >= 82 && s.user.squad === 'first' },
  { key: 'one_club', name: 'One of our own', desc: 'Ten seasons at the same club.', category: 'football', tier: 3, check: (s) => seasonsAtOneClub(s) >= 10 },
  { key: 'youth_intl', name: 'Wearing the badge', desc: 'Get called up by a national youth team.', category: 'football', tier: 1, check: (s) => s.user.national === 'U17' || s.user.national === 'U19' || s.user.national === 'U21' || s.user.caps > 0 },
  { key: 'senior_cap', name: 'Capped', desc: 'Win your first senior international cap.', category: 'football', tier: 2, check: (s) => s.user.caps >= 1 },
  { key: 'intl_goal', name: 'For the nation', desc: 'Score for the senior national team.', category: 'football', tier: 2, check: (s) => s.user.intlGoals >= 1 },
  { key: 'caps_50', name: 'Half a century', desc: '50 senior caps.', category: 'football', tier: 3, check: (s) => s.user.caps >= 50 },

  // honours
  { key: 'first_trophy', name: 'Silverware', desc: 'Win your first trophy.', category: 'honours', tier: 2, check: (s) => s.user.trophies.length >= 1 },
  { key: 'league_title', name: 'Champions!', desc: 'Win a league title.', category: 'honours', tier: 2, check: (s) => s.user.trophies.some((x) => x.name.endsWith(' champion')) },
  { key: 'continental', name: 'Kings of the continent', desc: `Win the ${CONTINENTAL_NAME}.`, category: 'honours', tier: 3, check: (s) => s.user.trophies.some((x) => x.name === CONTINENTAL_NAME) },
  { key: 'intl_trophy', name: 'National hero', desc: 'Win an international tournament with your country.', category: 'honours', tier: 3, check: (s) => s.user.trophies.some((x) => x.name.includes('Championship')) },
  { key: 'trophies_5', name: 'Trophy cabinet', desc: 'Win five trophies.', category: 'honours', tier: 3, check: (s) => s.user.trophies.length >= 5 },
  { key: 'first_award', name: 'Recognised', desc: 'Win an individual season award.', category: 'honours', tier: 2, check: (s) => s.user.awards.some((a) => !a.name.startsWith('Captain of')) },
  { key: 'captain', name: 'Skipper', desc: 'Be named club captain.', category: 'honours', tier: 2, check: (s) => s.user.awards.some((a) => a.name.startsWith('Captain of')) },

  // life
  { key: 'own_place', name: 'Keys of your own', desc: 'Move into your own apartment or house.', category: 'life', tier: 1, check: (s) => ['apartment', 'house', 'villa'].includes(s.life.housing.kind) },
  { key: 'homeowner', name: 'Homeowner', desc: 'Buy a property.', category: 'life', tier: 2, check: (s) => s.life.properties.length >= 1 },
  { key: 'villa', name: 'Living the dream', desc: 'Live in a luxury villa.', category: 'life', tier: 3, check: (s) => s.life.housing.kind === 'villa' },
  { key: 'first_car', name: 'Behind the wheel', desc: 'Buy your first car.', category: 'life', tier: 1, check: (s) => !['bus', 'bike'].includes(s.life.transport) },
  { key: 'dream_car', name: 'Dream machine', desc: 'Own a sports car or better.', category: 'life', tier: 2, check: (s) => s.life.transport === 'sports_car' || s.life.transport === 'luxury' },
  { key: 'parents_house', name: 'Thank you, Mum and Dad', desc: 'Buy your parents a house.', category: 'life', tier: 2, check: (s) => !!s.events.flags.parentsHouse },
  { key: 'relationship', name: 'Taken', desc: 'Start a serious relationship.', category: 'life', tier: 1, check: (s) => ['partner', 'living', 'engaged', 'married'].includes(stage(s) ?? '') },
  { key: 'married', name: 'Just married', desc: 'Get married.', category: 'life', tier: 2, check: (s) => stage(s) === 'married' },
  { key: 'parent', name: 'Proud parent', desc: 'Become a parent.', category: 'life', tier: 2, check: (s) => s.life.people.some((p) => p.role === 'child' && !p.gone) },
  { key: 'school', name: 'Graduated', desc: 'Finish school with good grades.', category: 'life', tier: 1, check: (s) => s.life.school.graduated && s.life.school.attended >= s.life.school.missed * 1.5 },
  { key: 'course', name: 'Lifelong learner', desc: 'Complete a college course.', category: 'life', tier: 1, check: (s) => s.life.education.completed.length >= 1 },
  { key: 'coach_badge', name: 'Coaching badge', desc: 'Earn your first coaching licence.', category: 'life', tier: 2, check: (s) => s.life.education.completed.includes('coach_c') },
  { key: 'pro_licence', name: 'Pro Licence', desc: 'Earn the Pro Licence — ready to manage anywhere.', category: 'life', tier: 3, check: (s) => s.life.education.completed.includes('coach_pro') },
  { key: 'charity', name: 'Giving back', desc: 'Earn 25 charity points (visits, coaching kids, donations).', category: 'life', tier: 1, check: (s) => s.life.charity.points >= 25 },
  { key: 'foundation', name: 'Foundation', desc: 'Start your own charity foundation.', category: 'life', tier: 3, check: (s) => s.life.charity.foundation },

  // fame & fortune
  { key: 'agent', name: 'Represented', desc: 'Hire an agent.', category: 'fame', tier: 1, check: (s) => s.life.agentId !== null },
  { key: 'sponsor', name: 'Brand ambassador', desc: 'Sign your first sponsorship deal.', category: 'fame', tier: 1, check: (s) => s.life.sponsors.length >= 1 },
  { key: 'followers_10k', name: 'Going viral', desc: '10,000 followers.', category: 'fame', tier: 1, check: (s) => s.user.followers >= 10_000 },
  { key: 'followers_100k', name: 'Influencer', desc: '100,000 followers.', category: 'fame', tier: 2, check: (s) => s.user.followers >= 100_000 },
  { key: 'followers_1m', name: 'Global icon', desc: 'One million followers.', category: 'fame', tier: 3, check: (s) => s.user.followers >= 1_000_000 },
  { key: 'worth_100k', name: 'Nest egg', desc: 'Net worth of 100k.', category: 'fame', tier: 1, check: (s) => worth(s) >= 100_000 },
  { key: 'millionaire', name: 'Millionaire', desc: 'Net worth of one million.', category: 'fame', tier: 2, check: (s) => worth(s) >= 1_000_000 },
  { key: 'worth_10m', name: 'Seriously rich', desc: 'Net worth of ten million.', category: 'fame', tier: 3, check: (s) => worth(s) >= 10_000_000 },
];

export const TIER_POINTS = [0, 10, 25, 50] as const;

export function milestonesOf(state: CareerState): Record<string, number> {
  if (!state.milestones) state.milestones = {};
  return state.milestones;
}

/** checks every locked milestone; returns the newly reached ones (celebrated with notices) */
export function checkMilestones(state: CareerState): MilestoneDef[] {
  const got = milestonesOf(state);
  const fresh: MilestoneDef[] = [];
  for (const m of MILESTONES) {
    if (got[m.key] !== undefined) continue;
    if (!m.check(state)) continue;
    got[m.key] = state.day;
    fresh.push(m);
  }
  for (const m of fresh) {
    addNotice(state, `Milestone: ${m.name} — ${m.desc.replace(/\.$/, '')}`, m.tier >= 2 ? 'gold' : 'good');
    addTimeline(state, `Milestone reached: ${m.name}`, 'good');
    state.user.morale = clamp(state.user.morale + m.tier * 1.5, 0, 100);
  }
  return fresh;
}

export function milestonePoints(state: CareerState): number {
  const got = milestonesOf(state);
  return MILESTONES.reduce((a, m) => a + (got[m.key] !== undefined ? TIER_POINTS[m.tier] : 0), 0);
}

export function milestoneCount(state: CareerState): { got: number; total: number } {
  const got = milestonesOf(state);
  return { got: MILESTONES.filter((m) => got[m.key] !== undefined).length, total: MILESTONES.length };
}
