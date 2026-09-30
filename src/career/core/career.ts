// Career orchestration: creating a career and the time loop.
//
// Time advances slot by slot (morning / afternoon / evening). Each slot is one of: club training
// (mornings on training days), a match, school (for under-17s on weekday afternoons), a pre-season
// double session, rehab, vacation, or a free slot spent on the planned activity (weekly plan or a
// one-off override). Narrative events are rolled at the start of slots; the loop STOPS whenever
// the player must decide something (event, match day, new offer, season review, retirement), so
// the UI can show it — the headless auto-policy (autoplay.ts) resolves the same stops.
//
// End of day: background fixtures are simulated, then sleep, body development, injuries, daily
// life. Start of day: weekly (wages, social, transfer interest), monthly (sponsors, investments,
// NPC development, coach changes), international windows, contract checkpoints, season rollover.

import type { DatabaseTables } from '../../game/data/database';
import { createSeason, isInternationalWeek, seasonCalendar } from './competitions';
import { checkImprovedContract, checkProContract, checkRenewal, clubValuation, loanCheck, transferInterest } from './contracts';
import { SLOT_NAMES, ageAt, dayOf, formatDate, type Slot, weekday, ymd } from './dates';
import { rollEvents } from './events';
import { createFootballer, refreshMarketValue, statsCopy, userAge, type CreatorInput } from './footballer';
import { dailyHealth, rehabProgress, startUserInjury } from './health';
import { city, club, coachOf, fixture, fixturesOn, invalidateIndex } from './index';
import { bumpAffinity, commuteEnergy, dailyLife, defaultPlan, doActivity, initFamily, monthlyFinances, planned, pruneOverrides, refreshClubPeople, sleep, userIsStudent, weeklyFinances } from './life';
import { addMessage, addNotice, addTimeline, formatMoney } from './messages';
import { initNationalTeams, internationalWindow, progressTournament, refreshNationalStrengths } from './national';
import { refreshNpc } from './players';
import { applyUserMatch, isUserFixture, playDayFixtures, simulateUserMatch, userMatchContext, type UserMatchContext } from './results';
import { retire } from './retirement';
import { Rng, clamp } from './rng';
import { checkMilestones } from './milestones';
import { midSeasonCoachChanges, rolloverSeason } from './season';
import { weeklySocial } from './social';
import { clubSessionFor, dailyDevelopment, trainSession } from './training';
import { generateWorld, generateYouthSquad } from './world';
import { trainingDef, INTENSITY_NAMES, type TrainingKey } from './data/lifestyle';
import type { MatchOutcome } from './matchsim';
import type { CareerState, Contract, Fixture, MatchReport } from './types';

export const SAVE_VERSION = 1;

// ----- rng

const rngs = new WeakMap<CareerState, Rng>();
export function rngOf(state: CareerState): Rng {
  let r = rngs.get(state);
  if (!r) {
    r = new Rng(state.rng || state.seed);
    rngs.set(state, r);
  }
  return r;
}

/** copies the live RNG state into the save */
export function syncRng(state: CareerState): void {
  state.rng = rngOf(state).state;
}

// ----- creation

export interface NewCareerOptions {
  seed?: number;
  db: DatabaseTables | null;
  startSeason?: number;
  /** city his family lives in (defaults to the academy's city) */
  hometown?: number;
}

export function makeCareerId(seed: number): string {
  return `c${seed.toString(36)}${Date.now().toString(36).slice(-4)}`;
}

/** generates only the world (used by the creator to list countries/cities/clubs) */
export function previewWorld(seed: number, db: DatabaseTables | null, startSeason = 2026) {
  return generateWorld({ seed, startSeason, db });
}

export function newCareer(input: CreatorInput, opts: NewCareerOptions): CareerState {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const startSeason = opts.startSeason ?? 2026;
  const world = generateWorld({ seed, startSeason, db: opts.db });
  const rng = new Rng(seed ^ 0xc0ffee);
  const day = dayOf(startSeason, 7, 1);
  const academy = world.clubs[input.clubId] ?? world.clubs[0];
  const contract: Contract = { clubId: academy.id, kind: 'youth', wage: 150, startDay: day, endSeason: startSeason + 1, role: 'youth', appearanceBonus: 0, goalBonus: 0, releaseClause: 0 };
  const user = createFootballer({ ...input, clubId: academy.id }, startSeason, rng, contract);
  const hometown = opts.hometown ?? academy.cityId;
  const state: CareerState = {
    version: SAVE_VERSION,
    id: makeCareerId(seed),
    seed,
    rng: rng.seed(),
    createdAt: Date.now(),
    savedAt: 0,
    day,
    slot: 0,
    season: startSeason,
    startSeason,
    world,
    comps: [],
    fixtures: [],
    nextFixtureId: 1,
    user,
    life: {
      cityId: academy.cityId,
      hometown,
      district: 2,
      school: { attended: 0, missed: 0, graduated: false },
      sleepMult: 1,
      housing: { kind: hometown === academy.cityId ? 'family' : 'digs', owned: false, weekly: 0, since: day },
      properties: [],
      transport: 'bus',
      diet: 'normal',
      sleep: 'normal',
      money: 400,
      investments: [],
      ledger: [],
      happiness: { football: 60, social: 60, romance: 50, family: 70, home: 60, money: 55 },
      people: [],
      nextPersonId: 1,
      agentId: null,
      partnerId: null,
      sponsors: [],
      education: { enrolled: null, progress: {}, completed: [] },
      hobbies: {},
      charity: { donated: 0, points: 0, foundation: false },
      plan: defaultPlan(),
      clubIntensity: 1,
      clubFocus: null,
      extraIntensity: 1,
      overrides: {},
      vacation: null,
      fatigueMental: 10,
      lastActivity: null,
    },
    inbox: [],
    feed: [],
    notices: [],
    nextMsgId: 1,
    offers: [],
    events: { pending: null, queue: [], log: {}, counts: {}, flags: {} },
    pendingMatch: null,
    reports: [],
    history: [],
    retired: null,
    settings: { romance: input.romance, difficulty: input.difficulty, matchDuration: null },
    nationalTeams: [],
    continentalQualified: [],
    timeline: [],
    milestones: {},
  };
  if (state.life.housing.kind === 'family') state.life.district = 0;
  generateYouthSquad(state.world, rng, academy, day, startSeason);
  invalidateIndex(state);
  initNationalTeams(state);
  createSeason(state, startSeason, rng);
  initFamily(state, rng);
  refreshClubPeople(state, rng);
  refreshMarketValue(state);
  rngs.set(state, new Rng(state.rng));
  const c = city(state, academy.cityId);
  addMessage(state, {
    from: `${academy.name} Academy`,
    kind: 'club',
    subject: `Welcome to ${academy.name}!`,
    body: `Welcome to the ${academy.name} academy, ${user.first}. Pre-season starts today in ${c.name}. You will train with the U19 squad every morning; afternoons and evenings are yours — use them wisely. Rest, eat well, and never skip a session.`,
  });
  addMessage(state, { from: 'Mum', kind: 'family', subject: 'So proud of you', body: `Your dad and I are so proud. ${state.life.housing.kind === 'digs' ? 'Call us every week — and eat your vegetables!' : 'Your room is exactly how you left it.'} Love you xx` });
  addTimeline(state, `Joined the ${academy.name} academy`, 'good');
  return state;
}

// ----- slot model

export type SlotKind = 'training' | 'national' | 'match' | 'free' | 'school' | 'rehab' | 'vacation' | 'preseason' | 'off';

export interface SlotInfo {
  kind: SlotKind;
  label: string;
  detail: string;
  fixture?: Fixture;
  activity?: string | null;
  training?: TrainingKey;
}

function inSummerBreak(state: CareerState, day: number): boolean {
  const t = ymd(day);
  return t.m === 6;
}

function nationalCamp(state: CareerState, day: number): boolean {
  const u = state.user;
  if (u.national === 'none') return false;
  for (let d = day - 3; d <= day + 3; d++) {
    for (const f of fixturesOn(state, d)) if (f.national && isUserFixture(state, f) && !f.played) return true;
  }
  return false;
}

export function userFixtureAt(state: CareerState, day: number, slot: Slot): Fixture | undefined {
  return fixturesOn(state, day).find((f) => f.slot === slot && !f.played && isUserFixture(state, f) && (!f.youth || state.user.squad === 'youth' || (state.events.flags.droppedToYouth ?? -99) >= day - 3));
}

export function slotInfo(state: CareerState, day: number, slot: Slot): SlotInfo {
  const u = state.user;
  const life = state.life;
  if (life.vacation && day < life.vacation.until) return { kind: 'vacation', label: 'On holiday', detail: `Enjoying ${life.vacation.place}` };
  const fx = userFixtureAt(state, day, slot);
  if (fx) return { kind: 'match', label: 'Match', detail: 'Match day', fixture: fx };
  const hasClub = u.clubId >= 0;
  const wd = weekday(day);
  if (slot === 0) {
    if (nationalCamp(state, day)) return { kind: 'national', label: 'National team training', detail: 'Training camp with the national team', training: 'tactical' };
    if (hasClub && !inSummerBreak(state, day)) {
      const key = clubSessionFor(state, day);
      if (key) {
        if (u.injury) return { kind: 'rehab', label: 'Rehab', detail: `Recovering from ${u.injury.name.toLowerCase()}` };
        const def = trainingDef(key);
        return { kind: 'training', label: 'Club training', detail: `${def.name} · ${INTENSITY_NAMES[life.clubIntensity]} effort`, training: key };
      }
      if (fixturesOn(state, day).some((f) => (f.home === u.clubId || f.away === u.clubId) && !f.youth && !f.national)) return { kind: 'off', label: 'Match-day morning', detail: 'Light walk-through and pre-match meal' };
    }
  }
  if (slot === 1) {
    const cal = seasonCalendar(state.season);
    if (hasClub && day >= cal.preseasonStart + 3 && day < cal.leagueStart - 6 && wd < 5 && !u.injury) return { kind: 'preseason', label: 'Pre-season session', detail: 'Double session: conditioning work', training: 'fitness' };
    if (userIsStudent(state) && wd < 5 && ![7, 8].includes(ymd(day).m) && !inSummerBreak(state, day)) return { kind: 'school', label: 'School', detail: 'Lessons at the academy school' };
  }
  const activity = planned(state, day, slot) ?? (slot === 0 && !hasClub ? 'park_run' : 'rest');
  return { kind: 'free', label: 'Free time', detail: activity, activity };
}

// ----- match context cache

const ctxCache = new WeakMap<CareerState, Map<number, UserMatchContext>>();
export function matchContext(state: CareerState, fixtureId: number): UserMatchContext {
  let m = ctxCache.get(state);
  if (!m) ctxCache.set(state, (m = new Map()));
  let ctx = m.get(fixtureId);
  if (!ctx) {
    const f = fixture(state, fixtureId)!;
    ctx = userMatchContext(state, f, rngOf(state));
    m.set(fixtureId, ctx);
  }
  return ctx;
}

function clearMatchContext(state: CareerState): void {
  ctxCache.get(state)?.clear();
}

// ----- the loop

export type StopReason = 'none' | 'event' | 'match' | 'offer' | 'season' | 'retired';

/** executes the current slot and moves to the next; returns why it stopped (or 'none') */
export function advanceSlot(state: CareerState): StopReason {
  if (state.retired) return 'retired';
  if (state.events.pending) return 'event';
  if (state.pendingMatch) return 'match';
  const rng = rngOf(state);
  const slotKey = state.day * 3 + state.slot;
  if (state.events.flags.rolledSlot !== slotKey) {
    state.events.flags.rolledSlot = slotKey;
    if (rollEvents(state, 'queued', rng)) return 'event';
    if (state.slot === 0 && rollEvents(state, 'morning', rng)) return 'event';
    if (state.slot === 2) {
      const tomorrow = fixturesOn(state, state.day + 1).some((f) => isUserFixture(state, f) && !f.played);
      if (tomorrow && rollEvents(state, 'matchEve', rng)) return 'event';
      if (rollEvents(state, 'evening', rng)) return 'event';
    }
  }
  const info = slotInfo(state, state.day, state.slot);
  if (info.kind === 'match' && info.fixture) {
    const ctx = matchContext(state, info.fixture.id);
    if (ctx.role === 'out') {
      const out = simulateUserMatch(state, ctx, rng);
      applyUserMatch(state, ctx, out, rng, false);
      clearMatchContext(state);
    } else {
      const entry = [...ctx.lineups[ctx.side].starters, ...ctx.lineups[ctx.side].bench].find((e) => e.npcId === -1);
      state.pendingMatch = { fixtureId: info.fixture.id, role: ctx.role, lineupPos: entry?.pos ?? state.user.pos };
      return 'match';
    }
  } else executeSlot(state, info, rng);
  return nextSlot(state);
}

function executeSlot(state: CareerState, info: SlotInfo, rng: Rng): void {
  const u = state.user;
  const life = state.life;
  switch (info.kind) {
    case 'training':
    case 'national': {
      if (state.events.flags.skipTrainingDay === state.day) {
        u.attendance = clamp(u.attendance * 0.93, 0, 1);
        addTimeline(state, 'Skipped training (physio)', 'info');
        break;
      }
      u.energy = clamp(u.energy - commuteEnergy(state), 0, 100);
      const res = trainSession(state, rng, info.training!, { intensity: life.clubIntensity, source: 'club' });
      u.attendance = clamp(u.attendance * 0.93 + 0.07, 0, 1);
      u.effort = clamp(u.effort * 0.9 + (life.clubIntensity / 2) * 0.1, 0, 1);
      const coach = life.people.find((p) => p.role === 'coach' && !p.gone);
      if (coach) coach.affinity = clamp(coach.affinity + [-0.4, 0.1, 0.5][life.clubIntensity] * (coachOf(state, u.clubId)?.discipline ?? 0.5) * 2, 0, 100);
      for (const p of life.people) if (p.role === 'teammate' && !p.gone) bumpAffinity(p, 0.18);
      const mentor = life.people.find((p) => p.role === 'mentor' && !p.gone);
      if (mentor) {
        bumpAffinity(mentor, 0.25);
        mentor.lastContact = state.day;
      }
      life.lastActivity = { day: state.day, slot: state.slot, key: 'club_training', summary: `${trainingDef(res.key).name}` };
      if (res.injured) startUserInjury(state, rng, 'training');
      break;
    }
    case 'preseason': {
      const res = trainSession(state, rng, 'fitness', { intensity: 1, source: 'club', scale: 0.8 });
      if (res.injured) startUserInjury(state, rng, 'training');
      break;
    }
    case 'rehab':
      doActivity(state, 'rehab', state.slot, rng);
      u.attendance = clamp(u.attendance * 0.97 + 0.03, 0, 1);
      if (rng.chance(0.3)) rehabProgress(state, 1);
      break;
    case 'school':
      doActivity(state, 'school', state.slot, rng);
      break;
    case 'vacation':
      u.energy = clamp(u.energy + 12, 0, 100);
      u.morale = clamp(u.morale + 0.6, 0, 100);
      life.fatigueMental = clamp(life.fatigueMental - 5, 0, 100);
      break;
    case 'off':
      u.energy = clamp(u.energy + 4, 0, 100);
      break;
    case 'free': {
      let key = info.activity ?? 'rest';
      if (u.injury && (key.startsWith('extra_training') || key.startsWith('gym_') || key === 'park_run' || key === 'kickabout' || key === 'personal_trainer' || key === 'surf')) key = state.slot === 2 ? 'rest' : 'rehab';
      const res = doActivity(state, key, state.slot, rng);
      if (res.summary && key !== 'rest') addTimeline(state, `${res.name}: ${res.summary}`);
      break;
    }
    case 'match':
      break;
  }
}

function nextSlot(state: CareerState): StopReason {
  if (state.slot < 2) {
    state.slot = (state.slot + 1) as Slot;
    return 'none';
  }
  endOfDay(state);
  state.day++;
  state.slot = 0;
  return startOfDay(state);
}

function endOfDay(state: CareerState): void {
  const rng = rngOf(state);
  playDayFixtures(state, state.day, rng);
  progressTournament(state, rng);
  sleep(state);
  dailyDevelopment(state);
  dailyHealth(state);
  dailyLife(state, rng);
  pruneOverrides(state);
  checkMilestones(state);
}

function startOfDay(state: CareerState): StopReason {
  const rng = rngOf(state);
  const u = state.user;
  const t = ymd(state.day);
  let stop: StopReason = 'none';
  const offersBefore = state.offers.filter((o) => o.status === 'pending').length;
  if (t.m === 7 && t.d === 1) {
    const age = userAge(state);
    const announced = state.events.flags.retireAtSeasonEnd === state.season;
    rolloverSeason(state, rng);
    if (announced) {
      retire(state, 'announced retirement');
      return 'retired';
    }
    if (age >= 40) {
      retire(state, 'age');
      return 'retired';
    }
    stop = 'season';
  }
  if (state.events.flags.careerEndingInjury && !state.retired) {
    delete state.events.flags.careerEndingInjury;
    addMessage(state, { from: 'Club doctor', kind: 'club', subject: 'The news we feared', body: 'The specialists agree: your body cannot take professional football any more. We are so sorry.' });
    retire(state, 'career-ending injury');
    return 'retired';
  }
  if (u.clubId < 0 && userAge(state) >= 34 && (state.events.flags.freeAgentSince ?? state.day) < state.day - 75) {
    retire(state, 'no club');
    return 'retired';
  }
  if (u.clubId < 0 && state.events.flags.freeAgentSince === undefined) state.events.flags.freeAgentSince = state.day;
  if (u.clubId >= 0) delete state.events.flags.freeAgentSince;

  if (weekday(state.day) === 0) {
    weeklyFinances(state, rng);
    weeklySocial(state, rng);
    u.weekStartStats = statsCopy(u.stats);
    transferInterest(state, rng);
    loanCheck(state, rng);
    if (t.m >= 1 && t.m <= 5) checkRenewal(state, rng);
    checkImprovedContract(state, rng);
    if (rollEvents(state, 'weekly', rng)) stop = stop === 'none' ? 'event' : stop;
  }
  if (t.d === 1) {
    monthlyFinances(state, rng);
    for (const n of state.world.npcs) refreshNpc(n, state.day);
    midSeasonCoachChanges(state, rng);
    refreshNationalStrengths(state);
    refreshMarketValue(state);
  }
  const cal = seasonCalendar(state.season);
  for (const w of cal.intlWeeks) if (state.day === w - 7) internationalWindow(state, w, rng);
  checkProContract(state, rng);
  // school graduation
  if (!state.life.school.graduated && ageAt(u.born, state.day) >= 17.6) {
    state.life.school.graduated = true;
    const total = state.life.school.attended + state.life.school.missed;
    const rate = total > 0 ? state.life.school.attended / total : 0.5;
    const grade = rate > 0.85 ? 'with distinction' : rate > 0.6 ? 'with good grades' : 'just about';
    addNotice(state, `You finished school ${grade}.`, rate > 0.6 ? 'good' : 'info');
    state.life.happiness.family = clamp(state.life.happiness.family + (rate > 0.6 ? 8 : -4), 0, 100);
  }
  // offers expire
  for (const o of state.offers) if (o.status === 'pending' && o.expiresDay < state.day) {
    o.status = 'withdrawn';
    for (const m of state.inbox) if (m.actions?.some((a) => a.data?.offerId === o.id)) m.resolved = true;
  }
  // academy players step up to the first-team squad when good enough
  if (u.squad === 'youth' && u.contract.kind === 'pro' && (t.d === 1 || t.d === 15)) {
    const val = clubValuation(state, u.clubId);
    if (val.diff > -9 || userAge(state) >= 18.8) {
      u.squad = 'first';
      addNotice(state, 'Promoted to the first-team squad!', 'gold');
      addTimeline(state, 'Promoted to the first team', 'good');
      u.morale = clamp(u.morale + 8, 0, 100);
      refreshClubPeople(state, rng);
    }
  }
  if (state.life.vacation && state.day >= state.life.vacation.until) state.life.vacation = null;
  const offersAfter = state.offers.filter((o) => o.status === 'pending').length;
  if (offersAfter > offersBefore && stop === 'none') stop = 'offer';
  return stop;
}

/** advances until the day changes (or a stop) */
export function advanceDay(state: CareerState): StopReason {
  const day = state.day;
  let guard = 0;
  while (state.day === day && guard++ < 10) {
    const r = advanceSlot(state);
    if (r !== 'none') return r;
  }
  return 'none';
}

/** advances until the next match day decision (or any other stop) */
export function advanceToNextMatch(state: CareerState, maxDays = 60): StopReason {
  const start = state.day;
  while (state.day - start < maxDays) {
    const r = advanceSlot(state);
    if (r !== 'none') return r;
  }
  return 'none';
}

// ----- match day

export function pendingMatchContext(state: CareerState): UserMatchContext | null {
  if (!state.pendingMatch) return null;
  return matchContext(state, state.pendingMatch.fixtureId);
}

/** SIMULATE the pending match */
export function simulatePendingMatch(state: CareerState): MatchReport | null {
  const ctx = pendingMatchContext(state);
  if (!ctx) return null;
  const out = simulateUserMatch(state, ctx, rngOf(state));
  return finishPendingMatch(state, out, false);
}

/** applies an outcome (simulated or from the 3D engine) and continues the day */
export function finishPendingMatch(state: CareerState, out: MatchOutcome, played3D: boolean): MatchReport | null {
  const ctx = pendingMatchContext(state);
  if (!ctx) return null;
  const rng = rngOf(state);
  const report = applyUserMatch(state, ctx, out, rng, played3D);
  state.pendingMatch = null;
  clearMatchContext(state);
  rollEvents(state, 'postMatch', rng);
  // a knock in the match -> evening at home
  nextSlot(state);
  return report;
}

// ----- UI helpers

export function slotLabel(state: CareerState): string {
  return `${SLOT_NAMES[state.slot]} · ${formatDate(state.day, true)}`;
}

export function upcomingUserFixtures(state: CareerState, n = 5): Fixture[] {
  return state.fixtures
    .filter((f) => !f.played && f.day >= state.day && (isUserFixture(state, f) || (f.youth && (f.home === state.user.clubId || f.away === state.user.clubId) && state.user.squad === 'youth')))
    .sort((a, b) => a.day - b.day || a.slot - b.slot)
    .slice(0, n);
}

export function isInternationalBreak(state: CareerState): boolean {
  return isInternationalWeek(state.day, seasonCalendar(state.season));
}

export function wageText(state: CareerState): string {
  return `${formatMoney(state, state.user.contract.wage)}/wk`;
}

export function clubOfUser(state: CareerState) {
  return club(state, state.user.clubId);
}
