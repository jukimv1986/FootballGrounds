// Contracts and transfers.
//
// Youth contract (15-17) -> first professional contract (~17, if the academy rates him) ->
// renewals, transfers, loans and free agency. Clubs value the user by comparing his rating (and
// for youngsters, his potential) with their first XI; that valuation sets the squad role and
// wage they offer. Interest from other clubs grows with reputation, form and market value and is
// limited by what they can afford. Negotiation: the player (or his agent, who squeezes out more)
// asks for wage / length / role / release clause / signing bonus; the club accepts, counters or
// walks away as its patience runs out.

import { ageAt, formatDate, seasonOf } from './dates';
import { AGENT_NAMES } from './data/agents';
import { hasTrait, potentialOvr, refreshMarketValue, userAge, userOvr } from './footballer';
import { city, club, country, invalidateSquads, squadOf, youthOf } from './index';
import { addPerson, agent, housingOptions, moveHouse, refreshClubPeople } from './life';
import { addMessage, addMoney, addNotice, addTimeline, formatMoney } from './messages';
import { expectedWage, refreshNpc, roundMoney } from './players';
import { Rng, clamp } from './rng';
import { clubStrength } from './selection';
import { createUserSeasonFixtures } from './competitions';
import { generateYouthSquad, generateIntakePlayer } from './world';
import type { CareerState, Contract, ContractOffer, Id, OfferKind, SquadRole } from './types';

export const ROLE_NAMES: Record<SquadRole, string> = { youth: 'Academy player', prospect: 'Hot prospect', rotation: 'Squad rotation', regular: 'First-team regular', key: 'Key player', star: 'Star player' };
const ROLE_ORDER: SquadRole[] = ['youth', 'prospect', 'rotation', 'regular', 'key', 'star'];

export function roleRank(r: SquadRole): number {
  return ROLE_ORDER.indexOf(r);
}

export function inTransferWindow(day: number): boolean {
  const d = new Date(day * 86400000);
  const m = d.getUTCMonth() + 1;
  return m === 7 || m === 8 || m === 1;
}

/** how a club rates the user relative to its first XI (rating points) */
export function clubValuation(state: CareerState, clubId: Id): { diff: number; potentialDiff: number; role: SquadRole } {
  const f = state.user;
  const xi = clubStrength(state, clubId);
  const ovr = userOvr(f);
  const age = userAge(state);
  const pot = potentialOvr(f);
  const diff = ovr - xi;
  const potentialDiff = pot - xi;
  let role: SquadRole;
  if (diff >= 5 && f.rep.national > 45) role = 'star';
  else if (diff >= 2) role = 'key';
  else if (diff >= -2.5) role = 'regular';
  else if (diff >= -6) role = 'rotation';
  else if (age < 21 && potentialDiff > -3) role = 'prospect';
  else role = age < 18.5 ? 'youth' : 'rotation';
  return { diff, potentialDiff, role };
}

export function contractYearsLeft(state: CareerState): number {
  return state.user.contract.endSeason - state.season + 1;
}

export function wageFor(state: CareerState, clubId: Id, role: SquadRole): number {
  const f = state.user;
  const c = club(state, clubId);
  const base = expectedWage(userOvr(f), c?.reputation ?? 50, userAge(state));
  const roleMult: Record<SquadRole, number> = { youth: 0.35, prospect: 0.6, rotation: 0.8, regular: 1, key: 1.25, star: 1.6 };
  const fame = 1 + Math.max(f.rep.national, f.rep.world) / 250;
  return roundMoney(base * roleMult[role] * fame);
}

function makeOffer(state: CareerState, clubId: Id, kind: OfferKind, rng: Rng, extra: Partial<ContractOffer> = {}): ContractOffer {
  const val = clubValuation(state, clubId);
  const role = kind === 'loan' ? (val.role === 'youth' || val.role === 'prospect' ? 'regular' : val.role) : kind === 'youth' ? 'youth' : val.role;
  const age = userAge(state);
  const wage = kind === 'youth' ? roundMoney(90 + age * 8) : wageFor(state, clubId, role) * rng.range(0.9, 1.05);
  const years = kind === 'loan' ? 1 : age < 21 ? rng.int(3, 5) : age < 29 ? rng.int(2, 5) : age < 33 ? rng.int(1, 2) : 1;
  const offer: ContractOffer = {
    id: state.nextMsgId++,
    clubId,
    kind,
    wage: roundMoney(wage),
    years,
    role,
    signingBonus: kind === 'youth' || kind === 'loan' ? 0 : roundMoney(wage * rng.range(2, 8)),
    releaseClause: kind === 'loan' || kind === 'youth' ? 0 : roundMoney(state.user.marketValue * rng.range(2.2, 4)),
    appearanceBonus: kind === 'youth' ? 0 : roundMoney(wage * 0.12),
    goalBonus: kind === 'youth' ? 0 : roundMoney(wage * (['CF', 'AM', 'LM', 'RM'].includes(state.user.pos) ? 0.18 : 0.3)),
    fee: 0,
    expiresDay: state.day + 14,
    status: 'pending',
    rounds: 0,
    patience: 1,
    note: '',
    ...extra,
  };
  state.offers.push(offer);
  return offer;
}

// ----- lifecycle checks (called from the career loop)

/** first professional contract around the 17th birthday */
export function checkProContract(state: CareerState, rng: Rng): void {
  const f = state.user;
  if (f.contract.kind !== 'youth' || f.clubId < 0) return;
  const age = userAge(state);
  if (age < 17 || state.events.flags.proDecision) return;
  if (state.offers.some((o) => o.status === 'pending' && o.kind === 'pro' && o.clubId === f.clubId)) return;
  const val = clubValuation(state, f.clubId);
  state.events.flags.proDecision = state.day;
  const c = club(state, f.clubId)!;
  if (val.diff > -17 || val.potentialDiff > -1) {
    const offer = makeOffer(state, f.clubId, 'pro', rng, { expiresDay: state.day + 21, note: 'Your first professional contract!' });
    offer.role = val.role === 'youth' ? 'prospect' : val.role;
    offer.wage = wageFor(state, f.clubId, offer.role);
    addMessage(state, {
      from: `${c.name} — Academy director`,
      kind: 'offer',
      subject: 'Your first professional contract',
      body: `We have been impressed by your development. The club would like to offer you a professional contract: ${formatMoney(state, offer.wage)} a week for ${offer.years} years as a ${ROLE_NAMES[offer.role].toLowerCase()}.`,
      actions: [{ label: 'View offer', action: 'open_offer', data: { offerId: offer.id } }],
    });
    addNotice(state, 'Professional contract offer from your club!', 'gold');
  } else {
    state.events.flags.releaseWarning = state.day;
    addMessage(state, {
      from: `${c.name} — Academy director`,
      kind: 'club',
      subject: 'Your future at the club',
      body: 'We have decided not to offer you a professional contract at this time. Your youth deal runs until the summer. Keep working — other clubs may take a chance on you, and our door is not closed.',
    });
    addNotice(state, 'No pro contract offer. Your future is uncertain…', 'bad');
    f.morale = clamp(f.morale - 12, 0, 100);
  }
}

/** renewal talks when the deal is running down */
export function checkRenewal(state: CareerState, rng: Rng): void {
  const f = state.user;
  if (f.clubId < 0 || f.contract.kind === 'loan') return;
  if (contractYearsLeft(state) > 1) return;
  if (f.contract.kind === 'youth' && userAge(state) < 17) return;
  const key = `renewal-${state.season}`;
  if (state.events.flags[key]) return;
  const val = clubValuation(state, f.clubId);
  const age = userAge(state);
  state.events.flags[key] = state.day;
  const c = club(state, f.clubId)!;
  const wanted = val.diff > -7 || (age < 22 && val.potentialDiff > -3);
  if (!wanted || age > 36) {
    addMessage(state, { from: c.name, kind: 'club', subject: 'Contract situation', body: `The club will not be offering you a new contract. You are free to talk to other clubs; your deal expires on ${formatDate(seasonEndDay(f.contract.endSeason))}.` });
    return;
  }
  const offer = makeOffer(state, f.clubId, 'renewal', rng, { expiresDay: state.day + 30, note: 'Contract extension' });
  if (age >= 32) offer.years = 1;
  addMessage(state, {
    from: c.name,
    kind: 'offer',
    subject: 'Contract extension offer',
    body: `The club wants to extend your contract: ${formatMoney(state, offer.wage)} per week for ${offer.years} year${offer.years > 1 ? 's' : ''} as a ${ROLE_NAMES[offer.role].toLowerCase()}.`,
    actions: [{ label: 'View offer', action: 'open_offer', data: { offerId: offer.id } }],
  });
}

/** the club rewards a player who has outgrown his deal with an improved contract */
export function checkImprovedContract(state: CareerState, rng: Rng): void {
  const f = state.user;
  if (f.clubId < 0 || f.contract.kind !== 'pro') return;
  if (state.offers.some((o) => o.status === 'pending' && o.clubId === f.clubId)) return;
  if (state.day - (state.events.flags.lastImproved ?? -999) < 150) return;
  const val = clubValuation(state, f.clubId);
  if (roleRank(val.role) < roleRank('rotation')) return;
  const fair = wageFor(state, f.clubId, val.role);
  if (fair < f.contract.wage * 1.7) return;
  state.events.flags.lastImproved = state.day;
  const c = club(state, f.clubId)!;
  const offer = makeOffer(state, f.clubId, 'renewal', rng, { expiresDay: state.day + 21, note: 'Improved contract' });
  addMessage(state, {
    from: c.name,
    kind: 'offer',
    subject: 'An improved contract',
    body: `Your progress has not gone unnoticed. ${c.name} would like to tear up your current deal and offer improved terms: ${formatMoney(state, offer.wage)} per week for ${offer.years} years as a ${ROLE_NAMES[offer.role].toLowerCase()}.`,
    actions: [{ label: 'View offer', action: 'open_offer', data: { offerId: offer.id } }],
  });
}

/** the player asks for a new deal (contract screen) */
export function askForNewContract(state: CareerState, rng: Rng): string {
  const f = state.user;
  if (f.clubId < 0) return 'You do not have a club.';
  if (f.contract.kind === 'loan') return 'You are on loan — talk to your parent club in the summer.';
  if (state.offers.some((o) => o.status === 'pending' && o.clubId === f.clubId)) return 'There is already an offer on the table.';
  if (state.day - (state.events.flags.askedContract ?? -999) < 60) return '"We spoke about this recently. Not now."';
  state.events.flags.askedContract = state.day;
  const val = clubValuation(state, f.clubId);
  const fair = wageFor(state, f.clubId, val.role);
  const c = club(state, f.clubId)!;
  const coach = state.life.people.find((p) => p.role === 'coach' && !p.gone);
  if ((f.contract.kind === 'youth' && userAge(state) >= 16.5 && val.potentialDiff > -8) || (fair > f.contract.wage * 1.2 && roleRank(val.role) >= roleRank('rotation')) || contractYearsLeft(state) <= 1) {
    const offer = makeOffer(state, f.clubId, f.contract.kind === 'youth' ? 'pro' : 'renewal', rng, { expiresDay: state.day + 21, note: 'New contract talks' });
    if (offer.kind === 'pro' && offer.role === 'youth') offer.role = 'prospect';
    addMessage(state, { from: c.name, kind: 'offer', subject: 'Contract talks', body: `The club is open to a new deal: ${formatMoney(state, offer.wage)}/week for ${offer.years} years.`, actions: [{ label: 'View offer', action: 'open_offer', data: { offerId: offer.id } }] });
    return `${c.name} agree to talk. An offer is waiting in your inbox.`;
  }
  if (coach) coach.affinity = clamp(coach.affinity - 2, 0, 100);
  return `${c.name} feel your current contract reflects your status. Keep performing.`;
}

function seasonEndDay(season: number): number {
  return Math.round(Date.UTC(season + 1, 5, 30) / 86400000);
}

/** clubs that could want him (step up or sideways, can afford him) */
export function interestedClubs(state: CareerState): Id[] {
  const f = state.user;
  const ovr = userOvr(f);
  const cur = club(state, f.clubId);
  const curRep = cur?.reputation ?? 30;
  const pot = potentialOvr(f);
  const age = userAge(state);
  return state.world.clubs
    .filter((c) => c.id !== f.clubId)
    .filter((c) => {
      const xi = clubStrength(state, c.id);
      const fitsSquad = ovr >= xi - 4 || (age < 21 && pot >= xi + 2);
      const affordable = c.balance > f.marketValue * 0.8 || c.reputation < curRep;
      const ambitionOk = c.reputation >= curRep - (hasTrait(f, 'ambitious') ? 5 : 18);
      return fitsSquad && affordable && ambitionOk && (c.countryKey === cur?.countryKey || c.reputation > 55 || f.rep.world > 20);
    })
    .map((c) => c.id);
}

/** weekly during transfer windows: bids from other clubs */
export function transferInterest(state: CareerState, rng: Rng): void {
  const f = state.user;
  if (f.clubId < 0) {
    freeAgentOffers(state, rng);
    return;
  }
  if (!inTransferWindow(state.day) || f.contract.kind === 'youth' || f.contract.kind === 'loan') return;
  if (state.offers.some((o) => o.status === 'pending' && o.kind === 'transfer')) return;
  const age = userAge(state);
  const buzz = (f.form - 50) / 50 + Math.max(f.rep.national, f.rep.world) / 60 + (f.transferRequest ? 0.6 : 0) + (hasTrait(f, 'ambitious') ? 0.2 : 0) - (hasTrait(f, 'loyal') ? 0.3 : 0);
  const a = agent(state);
  const reach = a ? a.reach ?? 0.5 : 0.25;
  const pushed = (state.events.flags.agentPush ?? -99) > state.day - 14 ? 0.15 : 0;
  const p = clamp(0.03 + buzz * 0.05 + reach * 0.06 + pushed - (age > 32 ? 0.05 : 0), 0.005, 0.35);
  if (!rng.chance(p)) return;
  const candidates = interestedClubs(state);
  if (candidates.length === 0) return;
  const buyerId = rng.weighted(candidates, (id) => Math.pow(state.world.clubs[id].reputation / 50, 2));
  const buyer = state.world.clubs[buyerId];
  refreshMarketValue(state);
  let fee = roundMoney(f.marketValue * rng.range(0.85, 1.35));
  const rc = f.contract.releaseClause;
  const cur = club(state, f.clubId)!;
  // selling club's stance: key players are hard to prise away
  const val = clubValuation(state, f.clubId);
  const importance = clamp((val.diff + 6) / 12, 0, 1);
  let accepted = rng.chance(clamp(0.75 - importance * 0.55 + (f.transferRequest ? 0.35 : 0) - (contractYearsLeft(state) > 2 ? 0.1 : -0.2), 0.05, 0.95));
  if (rc > 0 && fee >= rc) accepted = true;
  if (!accepted && rc > 0 && buyer.balance > rc * 1.5 && rng.chance(0.3)) {
    fee = rc;
    accepted = true;
  }
  if (!accepted) {
    addMessage(state, { from: cur.name, kind: 'club', subject: `${buyer.name} bid rejected`, body: `${buyer.name} made an offer of ${formatMoney(state, fee)} for you. The club rejected it: you are part of our plans.` });
    f.morale = clamp(f.morale + (hasTrait(f, 'ambitious') ? -3 : 1), 0, 100);
    return;
  }
  const offer = makeOffer(state, buyerId, 'transfer', rng, { fee, note: `Fee agreed: ${formatMoney(state, fee)}` });
  addMessage(state, {
    from: a ? `${a.first} ${a.last} (agent)` : buyer.name,
    kind: 'offer',
    subject: `${buyer.name} want to sign you`,
    body: `${buyer.name} (${state.world.leagues[buyer.leagueId].name}) have agreed a ${formatMoney(state, fee)} fee with ${cur.name}. They offer ${formatMoney(state, offer.wage)}/week for ${offer.years} years as a ${ROLE_NAMES[offer.role].toLowerCase()}.`,
    actions: [{ label: 'View offer', action: 'open_offer', data: { offerId: offer.id } }],
  });
  addNotice(state, `Transfer offer from ${buyer.name}!`, 'gold');
}

/** a young squad player without minutes may be sent on loan in the windows */
export function loanCheck(state: CareerState, rng: Rng): void {
  const f = state.user;
  if (f.clubId < 0 || f.contract.kind !== 'pro' || !inTransferWindow(state.day)) return;
  const age = userAge(state);
  if (age > 22) return;
  const key = `loan-${state.season}-${new Date(state.day * 86400000).getUTCMonth()}`;
  if (state.events.flags[key]) return;
  const val = clubValuation(state, f.clubId);
  const apps = f.season.league.apps + f.season.cup.apps;
  const benchWarmer = val.diff < -6 && (state.day - Math.round(Date.UTC(state.season, 6, 1) / 86400000) > 20 ? apps < 3 : true);
  if (!benchWarmer) return;
  state.events.flags[key] = state.day;
  const cur = club(state, f.clubId)!;
  const ovr = userOvr(f);
  const targets = state.world.clubs.filter((c) => c.id !== f.clubId && c.reputation < cur.reputation - 5 && Math.abs(clubStrength(state, c.id) - ovr) < 7);
  if (targets.length === 0) return;
  const t = rng.pick(targets);
  const offer = makeOffer(state, t.id, 'loan', rng, { note: `Season-long loan from ${cur.name}` });
  offer.wage = f.contract.wage;
  addMessage(state, {
    from: cur.name,
    kind: 'offer',
    subject: `Loan move to ${t.name}?`,
    body: `The coach feels you need regular football. ${t.name} would take you on a season-long loan and promise you minutes as a ${ROLE_NAMES[offer.role].toLowerCase()}. Your wage stays the same.`,
    actions: [{ label: 'View offer', action: 'open_offer', data: { offerId: offer.id } }],
  });
}

/** without a club, offers trickle in (weaker clubs first) */
export function freeAgentOffers(state: CareerState, rng: Rng): void {
  const f = state.user;
  if (state.offers.some((o) => o.status === 'pending')) return;
  const ovr = userOvr(f);
  const age = userAge(state);
  const pool = state.world.clubs.filter((c) => clubStrength(state, c.id) <= ovr + 5 + (age < 20 ? 8 : 0));
  const list = pool.length ? pool : [...state.world.clubs].sort((a, b) => a.reputation - b.reputation).slice(0, 10);
  const c = rng.weighted(list, (x) => x.reputation);
  const kind: OfferKind = age < 18 ? 'youth' : 'free';
  const offer = makeOffer(state, c.id, kind, rng, { note: 'Free transfer', expiresDay: state.day + 10 });
  if (kind === 'youth') offer.role = 'youth';
  addMessage(state, {
    from: c.name,
    kind: 'offer',
    subject: `${c.name} offer you a contract`,
    body: `${c.name} have watched your trial and would like to sign you on a free: ${formatMoney(state, offer.wage)}/week for ${offer.years} years.`,
    actions: [{ label: 'View offer', action: 'open_offer', data: { offerId: offer.id } }],
  });
}

// ----- negotiation

export interface Demand {
  wage: number;
  years: number;
  role: SquadRole;
  releaseClause: number;
  signingBonus: number;
}

export interface NegotiationResult {
  outcome: 'accepted' | 'countered' | 'rejected' | 'withdrawn';
  message: string;
}

/** the club's hidden ceiling for this offer */
function clubCeiling(state: CareerState, o: ContractOffer): { wage: number; bonus: number; minClause: number; maxRole: number } {
  const a = agent(state);
  const skill = a ? a.skill ?? 0.5 : 0.15;
  const val = clubValuation(state, o.clubId);
  const eagerness = clamp(0.5 + (val.diff + (userAge(state) < 22 ? val.potentialDiff * 0.5 : 0)) / 20, 0.1, 1.2);
  return {
    wage: o.wage * (1.08 + 0.2 * skill + 0.15 * eagerness),
    bonus: o.signingBonus * (1.3 + skill) + o.wage * 2 * skill,
    minClause: o.releaseClause * (0.75 - skill * 0.25),
    maxRole: Math.min(ROLE_ORDER.length - 1, roleRank(o.role) + (eagerness > 0.9 ? 1 : 0)),
  };
}

export function negotiate(state: CareerState, offerId: Id, d: Demand): NegotiationResult {
  const o = state.offers.find((x) => x.id === offerId);
  if (!o || o.status !== 'pending') return { outcome: 'withdrawn', message: 'This offer is no longer available.' };
  const cap = clubCeiling(state, o);
  const excess = Math.max(0, d.wage / cap.wage - 1) + Math.max(0, (d.signingBonus - cap.bonus) / Math.max(1, cap.bonus)) * 0.5 + (o.releaseClause > 0 ? Math.max(0, (cap.minClause - d.releaseClause) / Math.max(1, cap.minClause)) * 0.6 : 0) + Math.max(0, roleRank(d.role) - cap.maxRole) * 0.25;
  o.rounds++;
  const c = club(state, o.clubId)!;
  if (excess <= 0.001) {
    Object.assign(o, { wage: roundMoney(d.wage), years: d.years, role: d.role, releaseClause: roundMoney(d.releaseClause), signingBonus: roundMoney(d.signingBonus), note: 'Terms agreed' });
    return { outcome: 'accepted', message: `${c.name} accept your terms.` };
  }
  o.patience -= 0.22 + excess * 0.6;
  if (o.patience <= 0 || excess > 0.9) {
    o.status = 'withdrawn';
    addNotice(state, `${c.name} walked away from the negotiations.`, 'bad');
    return { outcome: 'withdrawn', message: `${c.name} have ended the talks — your demands were too high.` };
  }
  // counter: meet somewhere between their ceiling and the demand
  o.wage = roundMoney(Math.min(d.wage, (o.wage + cap.wage) / 2 + (cap.wage - o.wage) * 0.2));
  o.signingBonus = roundMoney(Math.min(d.signingBonus, (o.signingBonus + cap.bonus) / 2));
  if (o.releaseClause > 0) o.releaseClause = roundMoney(Math.max(d.releaseClause, (o.releaseClause + cap.minClause) / 2));
  if (roleRank(d.role) <= cap.maxRole) o.role = d.role;
  o.years = d.years;
  return { outcome: 'countered', message: `${c.name} came back with an improved offer (${formatMoney(state, o.wage)}/week). Their patience is ${o.patience > 0.6 ? 'fine' : o.patience > 0.3 ? 'wearing thin' : 'almost gone'}.` };
}

export function rejectOffer(state: CareerState, offerId: Id): void {
  const o = state.offers.find((x) => x.id === offerId);
  if (!o || o.status !== 'pending') return;
  o.status = 'rejected';
  for (const m of state.inbox) if (m.actions?.some((a) => a.data?.offerId === offerId)) m.resolved = true;
  const c = club(state, o.clubId);
  if (o.kind === 'renewal' || o.kind === 'pro') addNotice(state, `You turned down the ${o.kind === 'pro' ? 'professional contract' : 'extension'} from ${c?.name}.`, 'info');
}

export function acceptOffer(state: CareerState, offerId: Id, rng: Rng): string | null {
  const o = state.offers.find((x) => x.id === offerId);
  if (!o || o.status !== 'pending') return 'Offer not available';
  o.status = 'accepted';
  for (const m of state.inbox) if (m.actions?.some((a) => a.data?.offerId === offerId)) m.resolved = true;
  const f = state.user;
  // an N-year deal covers N full seasons; deals signed in the second half of a season start counting next season
  const secondHalf = new Date(state.day * 86400000).getUTCMonth() + 1 < 7;
  const endSeason = state.season + o.years - 1 + (secondHalf ? 1 : 0);
  void inPreseasonOrLater;
  const contract: Contract = {
    clubId: o.clubId,
    kind: o.kind === 'youth' ? 'youth' : o.kind === 'loan' ? 'loan' : 'pro',
    wage: o.wage,
    startDay: state.day,
    endSeason: o.kind === 'loan' ? state.season : Math.max(state.season, endSeason),
    role: o.role,
    appearanceBonus: o.appearanceBonus,
    goalBonus: o.goalBonus,
    releaseClause: o.releaseClause,
  };
  if (o.signingBonus > 0) addMoney(state, o.signingBonus, 'Signing bonus');
  if (o.kind === 'pro' || o.kind === 'renewal') {
    f.contract = contract;
    if (o.kind === 'pro') {
      addTimeline(state, 'Signed a first professional contract!', 'good');
      addNotice(state, 'You are a professional footballer!', 'gold');
      f.morale = clamp(f.morale + 12, 0, 100);
      state.life.happiness.family = clamp(state.life.happiness.family + 8, 0, 100);
    } else addTimeline(state, `Extended the contract until ${contract.endSeason + 1}`, 'good');
    f.transferRequest = false;
    return null;
  }
  if (o.kind === 'loan') {
    contract.parentClubId = f.clubId;
    contract.parent = { ...f.contract };
  }
  const from = club(state, f.clubId);
  const to = club(state, o.clubId)!;
  if (o.fee > 0 && from) {
    from.balance += o.fee;
    to.balance -= o.fee;
  }
  moveUserToClub(state, o.clubId, contract, rng);
  addTimeline(state, o.kind === 'loan' ? `Joined ${to.name} on loan` : `Signed for ${to.name}${o.fee ? ` (${formatMoney(state, o.fee)})` : ''}`, 'good');
  addNotice(state, o.kind === 'loan' ? `On loan at ${to.name}.` : `Welcome to ${to.name}!`, 'gold');
  // other pending offers lapse
  for (const other of state.offers) if (other.status === 'pending') other.status = 'withdrawn';
  return null;
}

function inPreseasonOrLater(state: CareerState): boolean {
  return seasonOf(state.day) === state.season;
}

/** moves the user to a new club: city, housing, squad, people, fixtures */
export function moveUserToClub(state: CareerState, clubId: Id, contract: Contract, rng: Rng): void {
  const f = state.user;
  const to = club(state, clubId)!;
  const age = userAge(state);
  f.clubId = clubId;
  f.contract = contract;
  f.squad = contract.kind === 'youth' && age < 18.5 ? 'youth' : 'first';
  f.transferRequest = false;
  f.attendance = 1;
  if (f.squad === 'youth' && youthOf(state, clubId).length === 0) {
    generateYouthSquad(state.world, rng, to, state.day, state.season);
    invalidateSquads(state);
  }
  if (state.life.cityId !== to.cityId) {
    state.life.cityId = to.cityId;
    const opts = housingOptions(state);
    const pick = age < 18 ? opts.find((o) => o.kind === 'digs') : state.life.cityId === state.life.hometown ? opts.find((o) => o.kind === 'family') : opts.filter((o) => o.kind === (f.contract.wage > 4000 ? 'apartment' : 'shared') && !o.blocked).sort((a, b) => a.weekly - b.weekly)[0];
    const fallback = opts.find((o) => !o.blocked && o.weekly === 0) ?? opts.filter((o) => !o.blocked).sort((a, b) => a.weekly - b.weekly)[0];
    const chosen = pick && !pick.blocked ? pick : fallback;
    if (chosen) {
      state.life.housing = { kind: chosen.kind, owned: false, weekly: chosen.weekly, since: state.day };
      state.life.district = chosen.district;
    }
    state.life.happiness.home = clamp(state.life.happiness.home - 10, 0, 100);
    addMessage(state, { from: to.name, kind: 'club', subject: `Welcome to ${city(state, to.cityId).name}`, body: `The club has arranged temporary accommodation for you (${chosen?.name ?? 'club hotel'}). Visit Finances → Housing to find your own place.` });
    void moveHouse;
  }
  // the new club's youth league / friendlies next season are generated at rollover
  refreshClubPeople(state, rng);
  if (!state.comps.some((c) => c.id.startsWith('Y') && c.teamIds.includes(clubId) && c.season === state.season)) createUserSeasonFixtures(state, state.season, rng);
}

/** at the end of the season: loans end, expired contracts */
export function seasonEndContracts(state: CareerState, rng: Rng): void {
  const f = state.user;
  const c = f.contract;
  if (c.kind === 'loan' && c.endSeason <= state.season && c.parent && c.parentClubId !== undefined) {
    const parent = c.parent;
    addNotice(state, `Your loan has ended — back to ${club(state, c.parentClubId)?.name}.`, 'info');
    moveUserToClub(state, c.parentClubId, parent, rng);
    return;
  }
  if (c.endSeason <= state.season) {
    const accepted = state.offers.some((o) => o.status === 'accepted' && o.clubId === f.clubId && (o.kind === 'renewal' || o.kind === 'pro'));
    if (accepted) return;
    if (c.kind === 'youth' && userAge(state) < 17.5) {
      // youth deals roll over until the pro decision
      c.endSeason = state.season + 1;
      return;
    }
    addNotice(state, 'Your contract has expired. You are a free agent.', 'bad');
    addTimeline(state, `Left ${club(state, f.clubId)?.name} as a free agent`, 'bad');
    f.clubId = -1;
    f.contract = { clubId: -1, kind: 'pro', wage: 0, startDay: state.day, endSeason: state.season + 1, role: 'rotation', appearanceBonus: 0, goalBonus: 0, releaseClause: 0 };
    refreshClubPeople(state, rng);
  }
}

export function requestTransfer(state: CareerState): void {
  const f = state.user;
  f.transferRequest = true;
  const coach = state.life.people.find((p) => p.role === 'coach' && !p.gone);
  if (coach) coach.affinity = clamp(coach.affinity - 12, 0, 100);
  f.rep.local = clamp(f.rep.local - 5, 0, 100);
  addNotice(state, 'You handed in a transfer request.', 'bad');
}

// ----- agents

export interface AgentOption {
  first: string;
  last: string;
  skill: number;
  fee: number;
  reach: number;
  minRep: number;
  blurb: string;
}

export function agentOptions(state: CareerState): AgentOption[] {
  const rng = new Rng(state.seed + state.season * 17);
  const out: AgentOption[] = [];
  const tiers = [
    { skill: 0.3, fee: 0.05, reach: 0.3, minRep: 0, blurb: 'A family friend who "knows people". Cheap and loyal.' },
    { skill: 0.55, fee: 0.08, reach: 0.55, minRep: 8, blurb: 'Solid local agency with good league contacts.' },
    { skill: 0.75, fee: 0.1, reach: 0.8, minRep: 25, blurb: 'Big agency with clients in every top league.' },
    { skill: 0.92, fee: 0.12, reach: 0.95, minRep: 50, blurb: 'The super-agent. Ruthless, expensive, gets deals done.' },
  ];
  for (const t of tiers) {
    const n = rng.pick(AGENT_NAMES);
    out.push({ first: n[0], last: n[1], ...t });
  }
  return out;
}

export function hireAgent(state: CareerState, a: AgentOption): string | null {
  const f = state.user;
  const rep = Math.max(f.rep.national, f.rep.world, f.rep.local * 0.5);
  if (rep < a.minRep) return `${a.first} ${a.last} only represents established players.`;
  const cur = agent(state);
  if (cur) fireAgent(state);
  const p = addPerson(state, { first: a.first, last: a.last, role: 'agent', affinity: 60, skill: a.skill, fee: a.fee, reach: a.reach, job: 'Football agent' });
  state.life.agentId = p.id;
  addTimeline(state, `Hired agent ${a.first} ${a.last}`, 'info');
  return null;
}

export function fireAgent(state: CareerState): void {
  const a = agent(state);
  if (!a) return;
  a.gone = true;
  state.life.agentId = null;
  const comp = Math.round(state.user.contract.wage * 2);
  if (comp > 0) addMoney(state, -comp, 'Agent termination fee');
}

// ----- NPC market (summer)

/**
 * Summer housekeeping for the NPC world: contracts expire, veterans retire, big clubs buy the
 * best players of smaller clubs, and every club gets a youth intake to keep squads at size.
 */
export function npcSummerMarket(state: CareerState, rng: Rng): { retired: number; moved: number } {
  const w = state.world;
  const season = state.season;
  let retired = 0;
  let moved = 0;
  const day = state.day;
  // retirements
  w.npcs = w.npcs.filter((n) => {
    const age = ageAt(n.born, day);
    const quit = age > 40 || (age > 33 && rng.chance((age - 33) * 0.14 + (n.ovr < 60 ? 0.15 : 0)));
    if (quit) retired++;
    return !quit;
  });
  invalidateSquads(state);
  // transfers: richer clubs strengthen weak positions from poorer clubs
  const clubs = [...w.clubs].sort((a, b) => b.reputation - a.reputation);
  for (const buyer of clubs) {
    if (!rng.chance(0.55)) continue;
    const squad = squadOf(state, buyer.id);
    const xi = clubStrength(state, buyer.id);
    const targets = w.npcs.filter((n) => n.clubId >= 0 && n.clubId !== buyer.id && n.squad === 'first' && n.ovr > xi - 1 && w.clubs[n.clubId].reputation < buyer.reputation - 4 && ageAt(n.born, day) < 30);
    if (targets.length === 0) continue;
    const t = rng.pick(targets.slice(0, 40));
    const fee = roundMoney(t.ovr * t.ovr * 1500);
    if (buyer.balance < fee) continue;
    const seller = w.clubs[t.clubId];
    seller.balance += fee;
    buyer.balance -= fee;
    t.clubId = buyer.id;
    t.contractEnd = season + rng.int(2, 5);
    t.wage = expectedWage(t.ovr, buyer.reputation, ageAt(t.born, day));
    moved++;
    // the buyer offloads its weakest player at that position to the seller
    const same = squad.filter((n) => n.pos === t.pos).sort((a, b) => a.ovr - b.ovr);
    if (same.length > 2) {
      same[0].clubId = seller.id;
      moved++;
    }
  }
  invalidateSquads(state);
  // youth intake: fill every squad back to 25 (and refresh the user's development squad)
  for (const c of w.clubs) {
    const squad = squadOf(state, c.id);
    const counts = new Map<string, number>();
    for (const n of squad) counts.set(n.pos, (counts.get(n.pos) ?? 0) + 1);
    const need: string[] = [];
    const template = ['GK', 'GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'LB', 'LB', 'RB', 'RB', 'DM', 'DM', 'CM', 'CM', 'CM', 'AM', 'AM', 'LM', 'LM', 'RM', 'RM', 'CF', 'CF', 'CF'];
    for (const pos of template) {
      const have = counts.get(pos) ?? 0;
      if (have > 0) counts.set(pos, have - 1);
      else need.push(pos);
    }
    for (const pos of need.slice(0, 6)) generateIntakePlayer(w, rng, c, pos as never, day, season);
    // squads that got too big release their weakest veterans
    const now = w.npcs.filter((n) => n.clubId === c.id && n.squad === 'first');
    if (now.length > 29) {
      now.sort((a, b) => a.ovr - b.ovr);
      for (const n of now.slice(0, now.length - 28)) n.clubId = -1;
    }
  }
  // free agents: some get picked up, the rest drop out of football
  w.npcs = w.npcs.filter((n) => n.clubId >= 0 || n.squad === 'youth' ? true : rng.chance(0.3));
  for (const n of w.npcs) if (n.clubId < 0 && n.squad === 'first') n.clubId = rng.pick(w.clubs.filter((c) => state.world.leagues[c.leagueId].tier === 2)).id;
  // development squads age out: 19+ youth either join the first team or leave
  for (const n of w.npcs) {
    if (n.squad === 'youth' && ageAt(n.born, day) >= 19) {
      if (n.ovr >= clubStrength(state, n.clubId) - 10) n.squad = 'first';
      else n.clubId = -1;
    }
  }
  w.npcs = w.npcs.filter((n) => n.clubId >= 0);
  for (const n of w.npcs) refreshNpc(n, day);
  invalidateSquads(state);
  // replenish the user's development squad
  const u = state.user;
  if (u.clubId >= 0) {
    const youth = youthOf(state, u.clubId);
    if (youth.length < 14) {
      const extra = generateYouthSquad(w, rng, w.clubs[u.clubId], day, season).slice(0, 16 - youth.length);
      const keep = new Set(extra.map((n) => n.id));
      w.npcs = w.npcs.filter((n) => n.squad !== 'youth' || n.clubId !== u.clubId || keep.has(n.id) || youth.includes(n));
      invalidateSquads(state);
    }
  }
  void country;
  return { retired, moved };
}
