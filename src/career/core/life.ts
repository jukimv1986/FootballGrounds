// Life outside football.
//
// Every free slot of a day is spent on an activity at a city venue. Activities cost energy and
// money and move the interlocking meters:
//   energy (today) -> training quality, injury risk, match condition
//   fitness / sharpness -> match condition
//   morale  <- drifts towards overall happiness, which is a weighted mix of football, social,
//              romance, family, home and money happiness (weights shaped by traits)
//   professionalism -> what coaches see (selection), training efficiency
//   relationships (family, friends, teammates, coach, partner, agent) decay without attention
// Sleep recovers energy overnight: housing comfort, district calm, diet and the evening's
// activity (a night out ruins it) all matter. Money flows weekly: net wage in; rent, food,
// transport and lifestyle out; sponsors and investments monthly.

import { ageAt, weekday, ymd } from './dates';
import { ACTIVITIES, COURSES, DIETS, HOBBIES, HOUSING, INVESTMENTS, SLEEP, TRANSPORT, VENUES, activityDef, type ActivityDef, type ActivityEffects, type TrainingKey, type VenueKey } from './data/lifestyle';
import { NAME_POOLS, randomFemaleName, randomName } from './data/names';
import { hasTrait } from './footballer';
import { rehabProgress, startUserInjury } from './health';
import { city, club, country, squadOf, youthOf } from './index';
import { addMessage, addMoney, addNotice, addTimeline, formatMoney } from './messages';
import { roundMoney } from './players';
import { Rng, clamp } from './rng';
import { makePost } from './social';
import { applyXp, trainSession, xpMultiplier } from './training';
import type { CareerState, HousingKind, Person, PersonRole, TransportKind } from './types';
import type { Slot } from './dates';

// ----- people

export function addPerson(state: CareerState, p: Omit<Person, 'id' | 'lastContact' | 'since'>): Person {
  const person: Person = { id: state.life.nextPersonId++, lastContact: state.day, since: state.day, ...p };
  state.life.people.push(person);
  return person;
}

/** relationship gains shrink as a relationship approaches its best (diminishing returns) */
export function bumpAffinity(p: Person, delta: number): void {
  if (delta > 0) p.affinity = clamp(p.affinity + delta * Math.max(0.08, 1 - p.affinity / 112), 0, 100);
  else p.affinity = clamp(p.affinity + delta, 0, 100);
}

/** parents, siblings and his own children */
export function isFamily(p: Person): boolean {
  return p.role === 'mother' || p.role === 'father' || p.role === 'sibling' || p.role === 'child';
}

export function peopleOf(state: CareerState, role: PersonRole): Person[] {
  return state.life.people.filter((p) => p.role === role && !p.gone);
}

export function partner(state: CareerState): Person | undefined {
  const id = state.life.partnerId;
  return id === null ? undefined : state.life.people.find((p) => p.id === id && !p.gone);
}

export function agent(state: CareerState): Person | undefined {
  const id = state.life.agentId;
  return id === null ? undefined : state.life.people.find((p) => p.id === id && !p.gone);
}

export function initFamily(state: CareerState, rng: Rng): void {
  const nat = state.user.nat;
  const last = state.user.last;
  const pool = NAME_POOLS[nat] ?? NAME_POOLS.ENG;
  addPerson(state, { first: rng.pick(pool.female), last, role: 'mother', affinity: 82, job: rng.pick(['nurse', 'teacher', 'accountant', 'shop owner', 'civil servant']), cityId: state.life.hometown });
  addPerson(state, { first: rng.pick(pool.first), last, role: 'father', affinity: 76, job: rng.pick(['electrician', 'taxi driver', 'engineer', 'bus driver', 'builder', 'sports teacher']), cityId: state.life.hometown });
  if (rng.chance(0.7)) {
    const sis = rng.chance(0.5);
    const taken = new Set([...state.life.people.map((p) => p.first), state.user.first]);
    const names = (sis ? pool.female : pool.first).filter((n) => !taken.has(n));
    addPerson(state, { first: rng.pick(names.length ? names : pool.first), last, role: 'sibling', affinity: 70, job: sis ? 'little sister' : 'big brother', cityId: state.life.hometown });
  }
  for (let i = 0; i < 2; i++) {
    const n = randomName(rng, nat);
    addPerson(state, { first: n.first, last: n.last, role: 'friend', affinity: 65 + rng.int(0, 15), job: rng.pick(['school friend', 'childhood friend', 'neighbour']), cityId: state.life.hometown });
  }
}

/** coach and teammates of the current club become people in his life */
export function refreshClubPeople(state: CareerState, rng: Rng): void {
  const f = state.user;
  for (const p of state.life.people) {
    if (p.role === 'coach') p.gone = true;
    if (p.role === 'teammate' && p.npcId !== undefined) {
      const n = state.world.npcs.find((x) => x.id === p.npcId);
      if (!n || n.clubId !== f.clubId) {
        // former teammates stay friends if they were close
        if (p.affinity >= 70) {
          p.role = 'friend';
          p.job = 'former teammate';
        } else p.gone = true;
      }
    }
    if (p.role === 'mentor' && p.npcId !== undefined) {
      const n = state.world.npcs.find((x) => x.id === p.npcId);
      if (!n || n.clubId !== f.clubId) p.role = 'friend';
    }
  }
  // keep the circle of friends to a realistic size: the closest six
  const friends = state.life.people.filter((p) => p.role === 'friend' && !p.gone).sort((a, b) => b.affinity - a.affinity);
  for (const p of friends.slice(6)) p.gone = true;
  // forget people who left your life long ago (keeps saves small)
  state.life.people = state.life.people.filter((p) => !p.gone || state.day - p.lastContact < 400);
  const c = club(state, f.clubId);
  const coach = c ? state.world.coaches.find((x) => x.id === c.coachId) : undefined;
  if (coach) addPerson(state, { first: coach.first, last: coach.last, role: 'coach', affinity: 50, job: `Head coach, ${c!.name}`, npcId: coach.id });
  const mates = peopleOf(state, 'teammate');
  const pool = (f.squad === 'youth' ? youthOf(state, f.clubId) : squadOf(state, f.clubId)).filter((n) => !mates.some((m) => m.npcId === n.id));
  const ageNow = ageAt(f.born, state.day);
  rng.shuffle(pool);
  pool.sort((a, b) => Math.abs(ageAt(a.born, state.day) - ageNow) - Math.abs(ageAt(b.born, state.day) - ageNow));
  for (const n of pool.slice(0, Math.max(0, 3 - mates.length))) {
    addPerson(state, { first: n.first, last: n.last, role: 'teammate', affinity: 45 + rng.int(0, 15), job: `${n.pos}, ${c?.name ?? ''}`, npcId: n.id });
  }
}

// ----- availability

export function venuesIn(state: CareerState): VenueKey[] {
  const c = city(state, state.life.cityId);
  return VENUES.filter((v) => (v.coastal ? c.coastal : true) && (v.minSize ? c.size >= v.minSize : true)).map((v) => v.key);
}

export function userIsStudent(state: CareerState): boolean {
  return !state.life.school.graduated && ageAt(state.user.born, state.day) < 17.6;
}

export function activityCost(state: CareerState, def: ActivityDef): number {
  const c = city(state, state.life.cityId);
  let cost = def.cost * c.cost;
  if (def.special === 'study' && state.life.education.enrolled) {
    const course = COURSES.find((x) => x.key === state.life.education.enrolled);
    if (course) cost += course.costPerSession;
  }
  return Math.round(cost);
}

/** null when available, else the reason it is not */
export function activityBlocked(state: CareerState, def: ActivityDef, slot: Slot): string | null {
  const f = state.user;
  const life = state.life;
  if (!def.slots.includes(slot as 0 | 1 | 2)) return 'Not at this time of day';
  if (!venuesIn(state).includes(def.venue)) return 'No such venue in this city';
  const age = ageAt(f.born, state.day);
  switch (def.requires) {
    case 'injured':
      if (!f.injury) return 'Only when injured';
      break;
    case 'fit':
      if (f.injury) return 'You are injured';
      break;
    case 'partner': {
      const p = partner(state);
      if (!p || p.stage === 'dating') return 'Needs a partner';
      break;
    }
    case 'dating':
      if (!partner(state)) return 'Nobody to date (yet)';
      break;
    case 'agent':
      if (!agent(state)) return 'You have no agent';
      break;
    case 'enrolled':
      if (!life.education.enrolled) return 'Enrol in a course first';
      break;
    case 'student':
      if (!userIsStudent(state)) return 'You have finished school';
      break;
    case 'house':
      if (!['apartment', 'house', 'villa'].includes(life.housing.kind)) return 'Needs your own place';
      break;
    case 'fame':
      if (f.followers < 25000 && f.rep.national < 35) return 'You are not famous enough';
      break;
    case 'sponsor':
      if (!life.sponsors.some((s) => s.dutiesDone < s.duties)) return 'No sponsor duties pending';
      break;
    case 'adult':
      if (age < 18) return 'Over-18s only';
      break;
    case 'hobby':
      if (Object.keys(life.hobbies).length === 0) return 'Pick up a hobby first (Finances → Shop)';
      break;
    case 'hometown':
      if (life.cityId !== life.hometown) return 'Your family lives elsewhere';
      break;
    case 'away':
      if (life.cityId === life.hometown) return 'Your family lives in this city';
      break;
    case 'kids':
      if (!peopleOf(state, 'child').length) return 'You have no children';
      break;
  }
  const cost = activityCost(state, def);
  if (cost > 0 && life.money < cost) return 'Not enough money';
  if (def.effects.energy && def.effects.energy > 0 && f.energy < def.effects.energy * 0.5) return 'Too tired';
  return null;
}

export function activitiesAt(state: CareerState, venue: VenueKey, slot: Slot): { def: ActivityDef; blocked: string | null }[] {
  return ACTIVITIES.filter((a) => a.venue === venue).map((def) => ({ def, blocked: activityBlocked(state, def, slot) }));
}

// ----- doing things

export const EXTRA_TRAINING_DEFAULT: Record<string, TrainingKey> = { GK: 'goalkeeping', CB: 'defending', LB: 'speed', RB: 'speed', DM: 'defending', CM: 'passing', AM: 'ballcontrol', LM: 'speed', RM: 'speed', CF: 'finishing' };

function applyEffects(state: CareerState, e: ActivityEffects, rng: Rng, scale = 1): void {
  const f = state.user;
  const h = state.life.happiness;
  if (e.energy) f.energy = clamp(f.energy - e.energy * scale, 0, 100);
  if (e.morale) f.morale = clamp(f.morale + e.morale * scale, 0, 100);
  if (e.fitness) f.fitness = clamp(f.fitness + e.fitness * scale, 0, 100);
  if (e.sharpness) f.sharpness = clamp(f.sharpness + e.sharpness * scale, 0, 100);
  if (e.professionalism) f.professionalism = clamp(f.professionalism + e.professionalism * scale, 0, 100);
  if (e.social) h.social = clamp(h.social + e.social * scale, 0, 100);
  if (e.romance) h.romance = clamp(h.romance + e.romance * scale, 0, 100);
  if (e.family) {
    h.family = clamp(h.family + e.family * scale * 0.5, 0, 100);
    for (const p of state.life.people) if (!p.gone && isFamily(p)) {
      bumpAffinity(p, e.family * scale * 0.35);
      p.lastContact = state.day;
    }
  }
  if (e.home) h.home = clamp(h.home + e.home * scale, 0, 100);
  if (e.moneyHappy) h.money = clamp(h.money + e.moneyHappy * scale, 0, 100);
  if (e.football) h.football = clamp(h.football + e.football * scale, 0, 100);
  if (e.repLocal) f.rep.local = clamp(f.rep.local + e.repLocal * scale, 0, 100);
  if (e.followers) f.followers = Math.round(f.followers + Math.max(5, f.followers * e.followers) * scale * rng.range(0.6, 1.4));
  if (e.relax) state.life.fatigueMental = clamp(state.life.fatigueMental - e.relax * scale, 0, 100);
  if (e.coach) {
    const coach = state.life.people.find((p) => p.role === 'coach' && !p.gone);
    if (coach) coach.affinity = clamp(coach.affinity + e.coach * scale, 0, 100);
  }
  if (e.teammates) for (const p of peopleOf(state, 'teammate')) {
    bumpAffinity(p, e.teammates * scale);
    p.lastContact = state.day;
  }
  if (e.sleepPenalty) state.life.sleepMult *= e.sleepPenalty;
  if (e.train) {
    const mult = xpMultiplier(state, { intensity: 1, source: 'self' });
    for (const [k, v] of Object.entries(e.train)) applyXp(state, k as TrainingKey, (v ?? 0) * mult * scale);
  }
  if (e.injuryRisk && !f.injury && rng.chance(e.injuryRisk)) startUserInjury(state, rng, 'activity');
}

export interface ActivityResult {
  key: string;
  name: string;
  summary: string;
}

/**
 * Performs an activity. Keys may carry a parameter after a colon:
 * `extra_training:finishing`, `social_post:banter`, `hobby:guitar`.
 */
export function doActivity(state: CareerState, fullKey: string, slot: Slot, rng: Rng): ActivityResult {
  const [key, param] = fullKey.split(':');
  const def = activityDef(key);
  if (!def) return { key, name: key, summary: '' };
  const blocked = activityBlocked(state, def, slot);
  if (blocked) {
    const rest = activityDef('rest')!;
    applyEffects(state, rest.effects, rng);
    return { key: 'rest', name: rest.name, summary: `${def.name} was not possible (${blocked.toLowerCase()}), so you rested.` };
  }
  const f = state.user;
  const cost = activityCost(state, def);
  if (cost > 0) addMoney(state, -cost, def.name);
  applyEffects(state, def.effects, rng);
  let summary = def.desc;
  const life = state.life;
  switch (def.special) {
    case 'extra_training': {
      const tk = (param as TrainingKey) || EXTRA_TRAINING_DEFAULT[f.pos];
      const res = trainSession(state, rng, tk, { intensity: life.extraIntensity, source: 'club' });
      const gained = Object.values(res.gains).reduce((a, b) => a + (b ?? 0), 0);
      summary = `Extra ${tk} work (+${(gained * 100).toFixed(2)} attribute points).`;
      state.user.effort = clamp(state.user.effort * 0.92 + 0.08, 0, 1);
      const coach = state.life.people.find((p) => p.role === 'coach' && !p.gone);
      if (coach) coach.affinity = clamp(coach.affinity + 0.4, 0, 100);
      if (res.injured) {
        startUserInjury(state, rng, 'training');
        summary += ' You felt something go…';
      }
      break;
    }
    case 'rehab':
      if (rng.chance(0.45)) rehabProgress(state, 1);
      f.fitness = clamp(f.fitness + 0.8, 0, 100);
      summary = 'Rehab with the physios. Every session counts.';
      break;
    case 'study': {
      const key2 = life.education.enrolled!;
      const course = COURSES.find((c) => c.key === key2)!;
      life.education.progress[key2] = (life.education.progress[key2] ?? 0) + 1;
      const done = life.education.progress[key2];
      summary = `${course.name}: session ${done}/${course.sessions}.`;
      if (done >= course.sessions) {
        life.education.completed.push(key2);
        life.education.enrolled = null;
        addNotice(state, `Completed: ${course.name}!`, 'gold');
        addTimeline(state, `Graduated: ${course.name}`, 'good');
        f.morale = clamp(f.morale + 6, 0, 100);
        state.life.happiness.family = clamp(state.life.happiness.family + 5, 0, 100);
      }
      break;
    }
    case 'school':
      life.school.attended++;
      summary = 'A day at school. Your teachers say you are doing fine.';
      break;
    case 'call_family':
    case 'visit_family':
      summary = rng.pick(['Mum wants to know if you are eating properly.', 'Dad has watched every one of your games — twice.', 'Your family could not be prouder.', 'Catching up on the news from home.']);
      break;
    case 'date':
    case 'partner_time': {
      const p = partner(state);
      if (p) {
        bumpAffinity(p, def.special === 'date' ? 7 : 6);
        p.lastContact = state.day;
        summary = def.special === 'date' ? `A lovely evening with ${p.first}.` : `Quality time with ${p.first}.`;
      }
      break;
    }
    case 'teammates': {
      const mates = peopleOf(state, 'teammate');
      if (mates.length) {
        const m = rng.pick(mates);
        bumpAffinity(m, 5);
        m.lastContact = state.day;
        summary = `Good times with ${m.first} and the lads.`;
      }
      // a teammate's partner has a friend who would be perfect for you…
      maybeMeetSomeone(state, rng, 0.015);
      break;
    }
    case 'friends': {
      const friends = peopleOf(state, 'friend');
      for (const p of friends) {
        bumpAffinity(p, 5);
        p.lastContact = state.day;
      }
      summary = friends.length ? `Caught up with ${friends.map((p) => p.first).slice(0, 2).join(' and ')}.` : 'You enjoyed a coffee on your own.';
      maybeMeetSomeone(state, rng, 0.02);
      if (!friends.length) maybeMakeFriend(state, rng, 0.15);
      break;
    }
    case 'post':
      summary = makePost(state, param || 'training', rng);
      break;
    case 'agent': {
      const a = agent(state);
      if (a) {
        bumpAffinity(a, 5);
        a.lastContact = state.day;
        state.events.flags.agentPush = state.day;
        summary = `${a.first} ${a.last} will sound out a few clubs and brands.`;
      }
      break;
    }
    case 'charity':
      life.charity.points += 1;
      summary = 'The smiles made your week.';
      break;
    case 'sponsor': {
      const deal = life.sponsors.find((s) => s.dutiesDone < s.duties);
      if (deal) {
        deal.dutiesDone++;
        summary = `Promo event for ${deal.brand}. Smile for the cameras.`;
      }
      break;
    }
    case 'hobby': {
      const keys = Object.keys(life.hobbies);
      const hk = param && life.hobbies[param] !== undefined ? param : keys[0];
      const hobby = HOBBIES.find((h) => h.key === hk);
      if (hobby) {
        life.hobbies[hk] = Math.min(100, (life.hobbies[hk] ?? 0) + 1.5);
        const level = life.hobbies[hk];
        if (hobby.stat) {
          const s = hobby.stat[0] as keyof typeof f.stats;
          f.stats[s] = clamp(f.stats[s] + hobby.stat[1] * (0.5 + level / 100), 0, 1);
        }
        if (hobby.followers) f.followers = Math.round(f.followers * (1 + hobby.followers * (0.3 + level / 100)));
        summary = `${hobby.name} (skill ${Math.round(level)}).`;
      }
      break;
    }
    case 'party':
      state.events.flags.partyDay = state.day;
      summary = 'The party was a hit. Your neighbours disagree.';
      break;
    case 'night_out':
      state.events.flags.nightOutDay = state.day;
      summary = 'A big night out.';
      maybeMeetSomeone(state, rng, 0.12);
      maybeMakeFriend(state, rng, 0.04);
      break;
    case 'meet_people':
      maybeMeetSomeone(state, rng, 0.08);
      maybeMakeFriend(state, rng, 0.06);
      break;
    case 'fan_event':
      summary = 'Hundreds of selfies. Your hand hurts from signing.';
      break;
    case 'shopping':
      summary = rng.pick(['New trainers. Obviously.', 'A new jacket you did not need.', 'Gadgets, clothes and a coffee.']);
      break;
  }
  life.lastActivity = { day: state.day, slot, key: fullKey, summary };
  return { key: fullKey, name: def.name, summary };
}

/** chance of meeting someone (romance storylines) */
function maybeMeetSomeone(state: CareerState, rng: Rng, p: number): void {
  if (!state.settings.romance || partner(state)) return;
  if (ageAt(state.user.born, state.day) < 17) return;
  if (state.events.pending || state.events.queue.some((q) => q.defId === 'romance_meet')) return;
  if (rng.chance(p)) state.events.queue.push({ defId: 'romance_meet', day: state.day, ctx: {} });
}

/** chance of striking up a new friendship (new_friend event) */
function maybeMakeFriend(state: CareerState, rng: Rng, p: number): void {
  if (peopleOf(state, 'friend').length >= 5 || ageAt(state.user.born, state.day) < 16) return;
  if (state.events.pending || state.events.queue.length > 2 || state.day - (state.events.log.new_friend ?? -999) < 40) return;
  if (rng.chance(p)) state.events.queue.push({ defId: 'new_friend', day: state.day + 1, ctx: {} });
}

export function startDating(state: CareerState, rng: Rng): Person {
  const c = club(state, state.user.clubId);
  const nat = rng.chance(0.7) ? state.user.nat : c?.countryKey ?? state.user.nat;
  const n = randomFemaleName(rng, nat);
  const p = addPerson(state, { first: n.first, last: n.last, role: 'partner', affinity: 55, stage: 'dating', job: rng.pick(['architect', 'nurse', 'student', 'designer', 'lawyer', 'musician', 'journalist', 'physiotherapist', 'teacher', 'photographer']), cityId: state.life.cityId });
  state.life.partnerId = p.id;
  state.life.happiness.romance = clamp(state.life.happiness.romance + 12, 0, 100);
  return p;
}

/** a son or daughter is born (a family member who lives with him) */
export function addChild(state: CareerState, first: string, kind: string): Person {
  const p = addPerson(state, { first, last: state.user.last, role: 'child', affinity: 85, job: kind === 'daughter' ? 'daughter' : 'son', cityId: state.life.cityId });
  addNotice(state, `Welcome to the world, ${first}!`, 'gold');
  addTimeline(state, `Became a parent: ${first} was born`, 'good');
  state.life.happiness.family = clamp(state.life.happiness.family + 10, 0, 100);
  return p;
}

export function breakUp(state: CareerState): void {
  const p = partner(state);
  if (!p) return;
  p.gone = true;
  state.life.partnerId = null;
  state.life.happiness.romance = clamp(state.life.happiness.romance - 25, 0, 100);
  state.user.morale = clamp(state.user.morale - 10, 0, 100);
}

// ----- sleep, daily life, happiness

export function housingDef(kind: HousingKind) {
  return HOUSING.find((h) => h.kind === kind)!;
}

/** overnight recovery */
export function sleep(state: CareerState): number {
  const f = state.user;
  const life = state.life;
  const diet = DIETS.find((d) => d.kind === life.diet)!;
  const sleepDef = SLEEP.find((s) => s.kind === life.sleep)!;
  const district = city(state, life.cityId).districts[life.district];
  const comfort = housingDef(life.housing.kind).comfort;
  const age = ageAt(f.born, state.day);
  let rec = 58;
  rec *= sleepDef.recovery * diet.recovery;
  rec *= 0.85 + comfort / 400 + (district?.calm ?? 0.5) * 0.1;
  rec *= age > 30 ? 1 - (age - 30) * 0.015 : 1;
  rec *= life.sleepMult;
  if (hasTrait(f, 'resilient')) rec *= 1.04;
  rec *= 1 - life.fatigueMental / 400;
  f.energy = clamp(f.energy + rec, 0, 100);
  life.sleepMult = 1;
  return rec;
}

export function happinessWeights(state: CareerState): Record<keyof CareerState['life']['happiness'], number> {
  const f = state.user;
  const w = { football: 0.3, social: 0.15, romance: state.settings.romance ? 0.1 : 0, family: 0.15, home: 0.15, money: 0.15 };
  if (hasTrait(f, 'family')) w.family *= 1.8;
  if (hasTrait(f, 'party')) w.social *= 1.7;
  if (hasTrait(f, 'introvert')) w.social *= 0.6;
  if (hasTrait(f, 'ambitious')) w.football *= 1.4;
  return w;
}

export function happinessIndex(state: CareerState): number {
  const w = happinessWeights(state);
  const h = state.life.happiness;
  let sum = 0;
  let tot = 0;
  for (const k of Object.keys(w) as (keyof typeof w)[]) {
    sum += h[k] * w[k];
    tot += w[k];
  }
  return tot > 0 ? sum / tot : 50;
}

/** weekly expenses of the current lifestyle (for money happiness and the finances screen) */
export function weeklyCosts(state: CareerState): { label: string; amount: number }[] {
  const life = state.life;
  const c = city(state, life.cityId);
  const out: { label: string; amount: number }[] = [];
  if (!life.housing.owned && life.housing.weekly > 0) out.push({ label: `Rent (${housingDef(life.housing.kind).name})`, amount: life.housing.weekly });
  for (const p of life.properties) out.push({ label: `Upkeep (${housingDef(p.kind).name})`, amount: Math.round(p.value * 0.0004) });
  for (const p of life.properties) if (p.mortgage && p.mortgage > 0 && p.mortgageWeekly) out.push({ label: `Mortgage (${housingDef(p.kind).name})`, amount: Math.min(p.mortgageWeekly, Math.ceil(p.mortgage * (1 + MORTGAGE_RATE / 52))) });
  const diet = DIETS.find((d) => d.kind === life.diet)!;
  // academy digs and the family home include meals and bills
  const provided = life.housing.kind === 'digs' || life.housing.kind === 'family';
  const food = provided && diet.kind !== 'nutritionist' ? Math.round(diet.weekly * c.cost * 0.15) : Math.round(diet.weekly * c.cost);
  out.push({ label: `Food (${diet.name})`, amount: food });
  const t = TRANSPORT.find((x) => x.kind === life.transport)!;
  out.push({ label: `Transport (${t.name})`, amount: t.weekly });
  const status = housingDef(life.housing.kind).status;
  out.push({ label: 'Living costs', amount: Math.round((provided ? 25 : 70 + status * 12) * c.cost) });
  return out;
}

export function netWeeklyWage(state: CareerState): { gross: number; tax: number; agentFee: number; net: number } {
  const f = state.user;
  const cl = club(state, f.clubId);
  const co = cl ? country(state, cl.countryKey) : null;
  const gross = f.contract.wage;
  const taxRate = gross > 600 ? co?.tax ?? 0.4 : 0.05;
  const a = agent(state);
  const agentFee = a && f.contract.kind !== 'youth' ? Math.round(gross * (a.fee ?? 0.08)) : 0;
  const tax = Math.round(gross * taxRate);
  return { gross, tax, agentFee, net: gross - tax - agentFee };
}

export function dailyLife(state: CareerState, rng: Rng): void {
  const f = state.user;
  const life = state.life;
  const h = life.happiness;
  // social need
  h.social = clamp(h.social - (hasTrait(f, 'party') ? 0.9 : hasTrait(f, 'introvert') ? 0.35 : 0.6), 0, 100);
  // family happiness follows family affinity
  const fam = state.life.people.filter((p) => !p.gone && isFamily(p));
  const famAvg = fam.length ? fam.reduce((a, p) => a + p.affinity, 0) / fam.length : 60;
  h.family = clamp(h.family + (famAvg - h.family) * 0.05, 0, 100);
  // romance follows the partner (or drifts to neutral when single)
  const p = partner(state);
  if (!state.settings.romance) h.romance = 50;
  else if (p) h.romance = clamp(h.romance + (p.affinity - h.romance) * 0.06, 0, 100);
  else h.romance = clamp(h.romance + (42 - h.romance) * 0.02, 0, 100);
  // home: comfort, district fit, living abroad
  const cl = club(state, f.clubId);
  const comfort = housingDef(life.housing.kind).comfort;
  const district = city(state, life.cityId).districts[life.district];
  const likesFun = hasTrait(f, 'party') ? 1 : hasTrait(f, 'introvert') ? -1 : 0;
  const fit = likesFun > 0 ? district.fun * 12 : likesFun < 0 ? district.calm * 12 : (district.fun + district.calm) * 5;
  const abroad = cl && cl.countryKey !== f.nat && !(COUNTRY_LANG_OK(state)) ? (hasTrait(f, 'family') ? 14 : 9) : 0;
  const homeTarget = clamp(comfort * 0.75 + fit + 10 - abroad - (life.cityId !== life.hometown && ageAt(f.born, state.day) < 18 ? 8 : 0), 0, 100);
  h.home = clamp(h.home + (homeTarget - h.home) * 0.04, 0, 100);
  // money: runway in weeks of expenses
  const costs = weeklyCosts(state).reduce((a, c) => a + c.amount, 0);
  const net = netWeeklyWage(state).net;
  const runway = life.money / Math.max(50, costs);
  const moneyTarget = clamp(40 + Math.log10(Math.max(1, runway + 1)) * 18 + (net - costs > 0 ? 10 : -15) + (life.money < 0 ? -30 : 0), 0, 100);
  h.money = clamp(h.money + (moneyTarget - h.money) * 0.05, 0, 100);
  // football happiness drifts to neutral
  h.football = clamp(h.football + (50 - h.football) * 0.01, 0, 100);
  // relationships decay without contact
  for (const person of life.people) {
    if (person.gone) continue;
    const since = state.day - person.lastContact;
    if (person.role === 'coach' || person.role === 'agent' || person.role === 'mentor') {
      // professional relationships drift back to neutral rather than fade
      person.affinity = clamp(person.affinity + ((person.role === 'coach' ? 50 : 58) - person.affinity) * 0.004, 0, 100);
      continue;
    }
    // relationships fade a little every day and faster when neglected for a while
    const rate = person.role === 'partner' ? 0.3 : person.role === 'friend' ? 0.22 : person.role === 'teammate' ? 0.07 : 0.1;
    const familyBoost = hasTrait(f, 'family') && isFamily(person) ? 1.3 : 1;
    const neglect = since > 10 ? 1.6 : 1;
    person.affinity = clamp(person.affinity - rate * familyBoost * neglect, 0, 100);
  }
  // mental fatigue builds up in the season
  life.fatigueMental = clamp(life.fatigueMental + (weekday(state.day) === 6 ? 0.5 : 1.3) - (life.vacation ? 6 : 0), 0, 100);
  if (life.fatigueMental > 70) f.morale = clamp(f.morale - 0.6, 0, 100);
  // professionalism drifts to the personality baseline
  const baseProf = hasTrait(f, 'professional') ? 70 : hasTrait(f, 'party') ? 40 : 52;
  f.professionalism = clamp(f.professionalism + (baseProf - f.professionalism) * 0.004, 0, 100);
  // morale drifts towards happiness
  const hi = happinessIndex(state);
  f.morale = clamp(f.morale + (hi - f.morale) * 0.05, 0, 100);
  void rng;
}

/** language settles players abroad */
function COUNTRY_LANG_OK(state: CareerState): boolean {
  return state.life.education.completed.includes('language');
}

// ----- money

export function weeklyFinances(state: CareerState, rng: Rng): void {
  const life = state.life;
  const w = netWeeklyWage(state);
  if (w.gross > 0) addMoney(state, w.net, 'Wage (net)');
  for (const c of weeklyCosts(state)) addMoney(state, -c.amount, c.label);
  // mortgage repayments (charged above with the other costs) pay interest first, then the loan
  for (const p of life.properties) {
    if (!p.mortgage || p.mortgage <= 0 || !p.mortgageWeekly) continue;
    const interest = p.mortgage * (MORTGAGE_RATE / 52);
    p.mortgage = Math.max(0, Math.round(p.mortgage + interest - p.mortgageWeekly));
    if (p.mortgage === 0) {
      delete p.mortgage;
      delete p.mortgageWeekly;
      addNotice(state, `Mortgage paid off: the ${housingDef(p.kind).name.toLowerCase()} is all yours.`, 'gold');
      state.life.happiness.money = clamp(state.life.happiness.money + 6, 0, 100);
    }
  }
  // sponsors deliver duty evenings; unpaid duties annoy them
  void rng;
  if (life.money < -20000 && !state.events.flags.debtWarned) {
    state.events.flags.debtWarned = state.day;
    addMessage(state, { from: 'Your bank', kind: 'system', subject: 'Your account is overdrawn', body: `Your balance is ${formatMoney(state, life.money)}. Please reduce your expenses — consider cheaper housing, transport or food.` });
  }
  if (life.money > 0) delete state.events.flags.debtWarned;
}

export function monthlyFinances(state: CareerState, rng: Rng): void {
  const life = state.life;
  for (const s of [...life.sponsors]) {
    if (state.day > s.endDay) {
      life.sponsors.splice(life.sponsors.indexOf(s), 1);
      addNotice(state, `Your deal with ${s.brand} has ended.`, 'info');
      continue;
    }
    const paid = s.dutiesDone >= s.duties ? s.monthly : Math.round(s.monthly * (0.5 + 0.5 * (s.dutiesDone / Math.max(1, s.duties))));
    addMoney(state, paid, `Sponsor: ${s.brand}`);
    if (s.dutiesDone < s.duties) addNotice(state, `${s.brand} paid less: you skipped promo duties.`, 'bad');
    s.dutiesDone = 0;
  }
  const business = life.education.completed.includes('business') ? 0.01 : 0;
  for (const inv of life.investments) {
    const def = INVESTMENTS.find((i) => i.key === inv.key)!;
    const mean = def.key === 'savings' ? 0.0017 : def.key === 'index' ? 0.005 : def.key === 'property_fund' ? 0.004 : def.key === 'startup' ? 0.004 : 0.006;
    const r = mean + business / 12 + rng.gauss(0, def.risk * 0.06);
    const delta = Math.round(inv.amount * r);
    inv.amount = Math.max(0, inv.amount + delta);
  }
  // startups sometimes fail or boom
  for (const inv of life.investments) {
    if (inv.key === 'startup' && rng.chance(0.015)) {
      if (rng.chance(0.35)) {
        inv.amount *= 6;
        addNotice(state, `Your friend's start-up was acquired! Investment now ${formatMoney(state, inv.amount)}.`, 'gold');
      } else {
        inv.amount = 0;
        addNotice(state, `Your friend's start-up went bust.`, 'bad');
      }
    }
  }
  life.investments = life.investments.filter((i) => i.amount > 0);
  for (const p of life.properties) p.value = Math.round(p.value * (1 + 0.002 + rng.gauss(0, 0.006)));
  // property he owns but does not live in is let out (a letting agent keeps a cut)
  for (const p of life.properties) if (!livesIn(state, p)) addMoney(state, propertyRent(p), `Rent received (${housingDef(p.kind).name})`);
  if (life.charity.foundation) addMoney(state, -Math.round(2000 * city(state, life.cityId).cost), 'Foundation running costs');
  if (life.charity.foundation) life.charity.points += 2;
}

/** cash + investments + property, minus what is still owed on mortgages */
export function netWorth(state: CareerState): number {
  const l = state.life;
  return l.money + l.investments.reduce((a, i) => a + i.amount, 0) + l.properties.reduce((a, p) => a + p.value - (p.mortgage ?? 0), 0);
}

export function invest(state: CareerState, key: string, amount: number): boolean {
  if (amount <= 0 || state.life.money < amount) return false;
  const def = INVESTMENTS.find((i) => i.key === key);
  if (!def) return false;
  addMoney(state, -amount, `Invested: ${def.name}`);
  const existing = state.life.investments.find((i) => i.key === key);
  if (existing) existing.amount += amount;
  else state.life.investments.push({ key, name: def.name, amount, risk: def.risk, since: state.day });
  return true;
}

export function withdraw(state: CareerState, key: string): number {
  const inv = state.life.investments.find((i) => i.key === key);
  if (!inv) return 0;
  const fee = key === 'savings' ? 0 : Math.round(inv.amount * 0.01);
  addMoney(state, inv.amount - fee, `Withdrawn: ${inv.name}`);
  state.life.investments = state.life.investments.filter((i) => i !== inv);
  return inv.amount - fee;
}

export function donate(state: CareerState, amount: number): boolean {
  if (amount <= 0 || state.life.money < amount) return false;
  addMoney(state, -amount, 'Charity donation');
  state.life.charity.donated += amount;
  state.life.charity.points += Math.max(1, Math.round(Math.log10(amount) * 2 - 4));
  state.user.rep.local = clamp(state.user.rep.local + Math.min(4, Math.log10(amount) - 2.5), 0, 100);
  state.user.morale = clamp(state.user.morale + 2, 0, 100);
  return true;
}

export const FOUNDATION_COST = 250000;
export function startFoundation(state: CareerState): boolean {
  if (state.life.charity.foundation || state.life.money < FOUNDATION_COST) return false;
  addMoney(state, -FOUNDATION_COST, 'Started a charity foundation');
  state.life.charity.foundation = true;
  state.life.charity.points += 20;
  state.user.rep.national = clamp(state.user.rep.national + 5, 0, 100);
  state.user.rep.local = clamp(state.user.rep.local + 8, 0, 100);
  addNotice(state, 'Your foundation is live. It will change lives.', 'gold');
  return true;
}

// ----- housing & transport

export function districtMultiplier(prestige: number): number {
  return 0.65 + prestige * 0.9;
}

export interface HousingOption {
  kind: HousingKind;
  district: number;
  name: string;
  districtName: string;
  weekly: number;
  price: number;
  blocked: string | null;
}

export function housingOptions(state: CareerState): HousingOption[] {
  const life = state.life;
  const c = city(state, life.cityId);
  const age = ageAt(state.user.born, state.day);
  const out: HousingOption[] = [];
  for (const h of HOUSING) {
    if (h.kind === 'digs') {
      out.push({ kind: 'digs', district: 2, name: h.name, districtName: c.districts[2].name, weekly: 0, price: 0, blocked: state.user.squad !== 'youth' && age > 18.5 ? 'Only for academy players' : null });
      continue;
    }
    if (h.kind === 'family') {
      out.push({ kind: 'family', district: 0, name: h.name, districtName: c.districts[0].name, weekly: 0, price: 0, blocked: life.cityId !== life.hometown ? 'Your family lives in another city' : null });
      continue;
    }
    c.districts.forEach((d, i) => {
      if (h.kind === 'villa' && d.prestige < 0.55) return;
      if (h.kind === 'shared' && d.prestige > 0.7) return;
      const m = districtMultiplier(d.prestige) * c.cost;
      out.push({ kind: h.kind, district: i, name: h.name, districtName: d.name, weekly: roundMoney(h.rent * m), price: roundMoney(h.price * m), blocked: h.minAge && age < h.minAge ? `From age ${h.minAge}` : null });
    });
  }
  return out;
}

export const MORTGAGE_RATE = 0.045;
export const MORTGAGE_DEPOSIT = 0.2;
const MORTGAGE_YEARS = 15;

/** fixed weekly repayment of a mortgage (annuity over MORTGAGE_YEARS) */
export function mortgagePayment(loan: number): number {
  const r = MORTGAGE_RATE / 52;
  const n = MORTGAGE_YEARS * 52;
  return Math.ceil((loan * r) / (1 - Math.pow(1 + r, -n)));
}

/** null when the bank lends him the money for this home, else why not */
export function mortgageBlocked(state: CareerState, opt: HousingOption): string | null {
  if (opt.price <= 0) return 'This place cannot be bought';
  const f = state.user;
  if (f.clubId < 0 || f.contract.kind !== 'pro') return 'Banks want a professional contract';
  if (f.contract.endSeason - state.season < 1) return 'Banks want at least two years left on your contract';
  if (state.life.properties.some((p) => p.mortgage)) return 'You already have a mortgage';
  const deposit = Math.round(opt.price * MORTGAGE_DEPOSIT);
  if (state.life.money < deposit) return `You need a ${Math.round(MORTGAGE_DEPOSIT * 100)}% deposit`;
  const pay = mortgagePayment(opt.price - deposit);
  if (pay > netWeeklyWage(state).net * 0.35) return 'Repayments would be over a third of your wage';
  return null;
}

export function moveHouse(state: CareerState, opt: HousingOption, buy: boolean, mortgage = false): string | null {
  const life = state.life;
  if (opt.blocked) return opt.blocked;
  if (buy && mortgage) {
    const why = mortgageBlocked(state, opt);
    if (why) return why;
    const deposit = Math.round(opt.price * MORTGAGE_DEPOSIT);
    const loan = opt.price - deposit;
    addMoney(state, -deposit, `Deposit: ${opt.name}`);
    life.properties.push({ kind: opt.kind, cityId: life.cityId, district: opt.district, value: opt.price, boughtDay: state.day, mortgage: loan, mortgageWeekly: mortgagePayment(loan) });
  } else if (buy) {
    if (opt.price <= 0) return 'This place cannot be bought';
    if (life.money < opt.price) return 'Not enough money';
    addMoney(state, -opt.price, `Bought: ${opt.name}`);
    life.properties.push({ kind: opt.kind, cityId: life.cityId, district: opt.district, value: opt.price, boughtDay: state.day });
  } else if (opt.weekly > 0 && life.money < opt.weekly * 4) return 'You need four weeks of rent as a deposit';
  const prevStatus = housingDef(life.housing.kind).status;
  life.housing = { kind: opt.kind, owned: buy, weekly: buy ? 0 : opt.weekly, since: state.day };
  life.district = opt.district;
  const status = housingDef(opt.kind).status;
  state.life.happiness.home = clamp(state.life.happiness.home + 8 + (status - prevStatus) * 0.2, 0, 100);
  if (status > prevStatus + 20) state.user.followers = Math.round(state.user.followers * 1.02);
  addTimeline(state, `Moved into: ${opt.name}, ${opt.districtName}`, 'good');
  return null;
}

/** true when this owned property is his current home */
export function livesIn(state: CareerState, p: { kind: string; cityId: number; district: number }): boolean {
  const cur = state.life.housing;
  return cur.owned && cur.kind === p.kind && p.cityId === state.life.cityId && p.district === state.life.district;
}

/** monthly rent an owned property brings in when it is let out */
export function propertyRent(p: { value: number }): number {
  return Math.round(p.value * 0.0035);
}

export function sellProperty(state: CareerState, index: number): number {
  const p = state.life.properties[index];
  if (!p) return 0;
  if (livesIn(state, p)) return 0;
  const proceeds = Math.round(p.value * 0.96) - (p.mortgage ?? 0);
  addMoney(state, proceeds, p.mortgage ? 'Sold property (mortgage repaid)' : 'Sold property');
  state.life.properties.splice(index, 1);
  return proceeds;
}

export function buyTransport(state: CareerState, kind: TransportKind): string | null {
  const t = TRANSPORT.find((x) => x.kind === kind)!;
  const age = ageAt(state.user.born, state.day);
  if (age < t.minAge) return `You need a driving licence (age ${t.minAge})`;
  const cur = TRANSPORT.find((x) => x.kind === state.life.transport)!;
  const tradeIn = Math.round(cur.price * 0.45);
  const price = t.price - tradeIn;
  if (state.life.money < price) return 'Not enough money';
  addMoney(state, -price, `Bought: ${t.name}${tradeIn > 0 ? ' (trade-in)' : ''}`);
  state.life.transport = kind;
  state.life.happiness.home = clamp(state.life.happiness.home + 3, 0, 100);
  if (t.status > 40) state.user.followers = Math.round(state.user.followers * 1.015);
  return null;
}

export function buyHobby(state: CareerState, key: string): string | null {
  const h = HOBBIES.find((x) => x.key === key);
  if (!h) return 'Unknown hobby';
  if (state.life.hobbies[key] !== undefined) return 'Already your hobby';
  const price = Math.round(h.price * city(state, state.life.cityId).cost);
  if (state.life.money < price) return 'Not enough money';
  addMoney(state, -price, `Hobby: ${h.name}`);
  state.life.hobbies[key] = 5;
  return null;
}

export function enrollCourse(state: CareerState, key: string): string | null {
  const course = COURSES.find((c) => c.key === key);
  if (!course) return 'Unknown course';
  const age = ageAt(state.user.born, state.day);
  if (age < course.minAge) return `From age ${course.minAge}`;
  if (course.requires && !state.life.education.completed.includes(course.requires)) return `Requires ${COURSES.find((c) => c.key === course.requires)?.name}`;
  if (state.life.education.completed.includes(key)) return 'Already completed';
  state.life.education.enrolled = key;
  return null;
}

/** travel costs for commuting (energy) — applied on training days */
export function commuteEnergy(state: CareerState): number {
  const life = state.life;
  const district = city(state, life.cityId).districts[life.district];
  const t = TRANSPORT.find((x) => x.kind === life.transport)!;
  const minutes = life.housing.kind === 'digs' ? 5 : district?.commute ?? 25;
  return (minutes / 30) * 3 * t.commute;
}

/** the week plan template shipped with a new career */
export function defaultPlan(): (string | null)[][] {
  // Mon..Sun, slots [morning, afternoon, evening]
  return [
    [null, 'extra_training', 'call_family'],
    [null, 'rest', 'gaming'],
    [null, 'extra_training', 'rest'],
    [null, 'footage', 'coffee_friends'],
    [null, 'rest', 'early_night'],
    [null, 'rest', 'rest'],
    ['rest', 'walk', 'call_family'],
  ];
}

export function planned(state: CareerState, day: number, slot: Slot): string | null {
  const o = state.life.overrides[`${day}:${slot}`];
  if (o) return o;
  return state.life.plan[weekday(day)][slot];
}

export function setOverride(state: CareerState, day: number, slot: Slot, key: string | null): void {
  const k = `${day}:${slot}`;
  if (key === null) delete state.life.overrides[k];
  else state.life.overrides[k] = key;
}

export function pruneOverrides(state: CareerState): void {
  for (const k of Object.keys(state.life.overrides)) {
    const day = parseInt(k.split(':')[0], 10);
    if (day < state.day) delete state.life.overrides[k];
  }
}

export function monthOf(day: number): number {
  return ymd(day).m;
}
