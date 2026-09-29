// Headless auto-policy: plays a career without a UI (tests, balancing, "sim to date"). It makes
// the decisions a sensible, ambitious-but-professional player would: a training-heavy weekly plan
// adapted to energy, simulate every match, accept good contracts and step-up transfers, upgrade
// housing and diet as wages grow, and retire in his mid/late thirties when the legs go.

import { acceptOffer, clubValuation, negotiate, rejectOffer, roleRank } from './contracts';
import { advanceSlot, rngOf, simulatePendingMatch, type StopReason } from './career';
import { ageAt } from './dates';
import { autoResolve } from './events';
import { userAge, userOvr } from './footballer';
import { club } from './index';
import { enrollCourse, housingOptions, moveHouse, buyTransport, invest } from './life';
import { acceptSponsor } from './social';
import { bestTrainingFocus } from './training';
import type { CareerState } from './types';

export interface AutoOptions {
  /** called after every stop (for progress logging in tests) */
  onStop?: (reason: StopReason, state: CareerState) => void;
}

function handleOffers(state: CareerState): void {
  const rng = rngOf(state);
  const u = state.user;
  for (const o of state.offers.filter((x) => x.status === 'pending')) {
    const c = club(state, o.clubId);
    if (!c) continue;
    const cur = club(state, u.clubId);
    let take = false;
    if (o.kind === 'pro' || o.kind === 'renewal' || o.kind === 'youth') take = o.wage >= u.contract.wage * 0.9 || u.clubId < 0;
    else if (o.kind === 'free') take = true;
    else if (o.kind === 'loan') take = userAge(state) < 22;
    else if (o.kind === 'transfer') take = !cur || c.reputation >= cur.reputation + 6 || (o.wage > u.contract.wage * 1.6 && c.reputation >= cur.reputation - 4);
    if (take && o.kind !== 'loan' && o.kind !== 'youth' && o.rounds === 0) {
      // a little haggling
      negotiate(state, o.id, { wage: Math.round(o.wage * 1.08), years: o.years, role: o.role, releaseClause: o.releaseClause, signingBonus: o.signingBonus });
      if (o.status !== 'pending') continue;
    }
    if (take) acceptOffer(state, o.id, rng);
    else rejectOffer(state, o.id);
  }
}

function handleInbox(state: CareerState): void {
  for (const m of state.inbox) {
    if (m.resolved || !m.actions) continue;
    if (m.kind === 'sponsor') {
      const accept = m.actions.find((a) => a.action === 'sponsor_accept');
      const data = accept?.data as { brand: string; category: string; monthly: number; months: number; duties: number } | undefined;
      if (data && data.category !== 'Betting' && data.category !== 'Fast food') acceptSponsor(state, data);
      m.resolved = true;
    }
    m.read = true;
  }
}

function lifestyle(state: CareerState): void {
  const u = state.user;
  const life = state.life;
  const wage = u.contract.wage;
  const age = ageAt(u.born, state.day);
  if (wage > 2500 && life.diet === 'normal') life.diet = 'balanced';
  if (wage > 30000 && life.diet !== 'nutritionist') life.diet = 'nutritionist';
  // housing ladder
  if (age >= 18 && (life.housing.kind === 'digs' || life.housing.kind === 'family') && wage > 1500) {
    const opt = housingOptions(state).filter((o) => o.kind === (wage > 6000 ? 'apartment' : 'shared') && !o.blocked).sort((a, b) => b.districtName.localeCompare(a.districtName))[0];
    if (opt) moveHouse(state, opt, false);
  }
  if (life.housing.kind === 'shared' && wage > 6000) {
    const opt = housingOptions(state).find((o) => o.kind === 'apartment' && !o.blocked);
    if (opt) moveHouse(state, opt, false);
  }
  if ((life.housing.kind === 'apartment' || life.housing.kind === 'shared') && wage > 35000) {
    const opt = housingOptions(state).find((o) => o.kind === 'house' && !o.blocked);
    if (opt) moveHouse(state, opt, life.money > opt.price * 1.5);
  }
  if (age >= 18.5 && life.transport === 'bus' && life.money > 12000) buyTransport(state, 'used_car');
  if (life.transport === 'used_car' && life.money > 90000) buyTransport(state, 'car');
  if (life.money > 400000 && life.investments.length === 0) invest(state, 'index', Math.round(life.money * 0.3));
  if (age >= 25 && !life.education.enrolled && !life.education.completed.includes('coach_c')) enrollCourse(state, 'coach_c');
  else if (age >= 26 && !life.education.enrolled && life.education.completed.includes('coach_c') && !life.education.completed.includes('coach_b')) enrollCourse(state, 'coach_b');
  // a weekly plan that trains hard but protects energy
  const tired = u.energy < 45;
  life.clubIntensity = tired ? 1 : u.energy > 75 ? 2 : 1;
  life.extraIntensity = 1;
  const study = life.education.enrolled ? 'study' : 'footage';
  const focus = bestTrainingFocus(state);
  const focus2 = bestTrainingFocus(state, [focus]);
  life.clubFocus = focus;
  const extra = `extra_training:${focus2}`;
  life.plan = [
    [null, tired ? 'rest' : extra, 'call_family'],
    [null, 'rest', life.education.enrolled ? 'study' : 'gaming'],
    [null, tired ? 'yoga' : `extra_training:${focus}`, 'rest'],
    [null, study, 'coffee_friends'],
    [null, 'rest', 'early_night'],
    [null, 'rest', 'rest'],
    ['rest', tired ? 'rest' : 'gym_strength', life.partnerId !== null ? 'partner_night' : 'team_dinner'],
  ];
  if (state.life.partnerId !== null && state.life.plan[3]) state.life.plan[3][2] = 'dinner_date';
}

/** resolves whatever the loop stopped for */
export function autoResolveStop(state: CareerState, reason: StopReason): void {
  const rng = rngOf(state);
  switch (reason) {
    case 'event':
      autoResolve(state, rng);
      break;
    case 'match':
      simulatePendingMatch(state);
      break;
    case 'offer':
      handleOffers(state);
      break;
    case 'season':
      handleOffers(state);
      break;
    default:
      break;
  }
}

/** runs the career headlessly until `untilDay` or retirement */
export function autoPlay(state: CareerState, untilDay: number, opts: AutoOptions = {}): void {
  let lastDay = -1;
  let guard = 0;
  while (!state.retired && state.day < untilDay && guard++ < 400000) {
    if (state.day !== lastDay) {
      lastDay = state.day;
      if (state.slot === 0) {
        lifestyle(state);
        handleInbox(state);
        if (state.offers.some((o) => o.status === 'pending')) handleOffers(state);
        // veterans call it a day when the level drops
        const age = userAge(state);
        if (age >= 34 && !state.events.flags.retireAtSeasonEnd && (userOvr(state.user) < 66 || age >= 37.5 || clubValuation(state, state.user.clubId).diff < -12)) state.events.flags.retireAtSeasonEnd = state.season;
      }
    }
    const r = advanceSlot(state);
    if (r !== 'none') {
      opts.onStop?.(r, state);
      autoResolveStop(state, r);
    }
  }
  void roleRank;
}
