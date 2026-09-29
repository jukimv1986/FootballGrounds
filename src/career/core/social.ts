// Media and social media: fan and journalist reactions to matches, the player's own posts (with
// risk/reward: a humble training clip vs. flexing a sports car vs. banter with a rival), weekly
// follower dynamics, and sponsorship offers that scale with fame and fit the player's image.

import { BRANDS } from './data/lifestyle';
import { club, city } from './index';
import { hasTrait } from './footballer';
import { addMessage, addPost, formatMoney } from './messages';
import { roundMoney } from './players';
import { Rng, clamp } from './rng';
import type { CareerState, MatchReport, SponsorDeal } from './types';

function fanHandle(state: CareerState, rng: Rng): string {
  const c = club(state, state.user.clubId);
  const cityName = c ? city(state, c.cityId).name.replace(/[^A-Za-z]/g, '') : 'Footy';
  return rng.pick([`@${c?.shortName ?? 'FC'}_ultra`, `@${cityName}Til1Die`, `@${cityName.toLowerCase()}_fan${rng.int(7, 99)}`, '@footy_takes', '@TacticsNerd', '@SundayLeagueLegend', `@${(c?.nickname ?? 'the_fans').replace(/[^A-Za-z]/g, '')}Faithful`, '@xG_merchant']);
}

const JOURNALISTS = ['@MarcoRomanoReports', '@TheAthleticEye', '@TransferInsider', '@PressBoxPete', '@CalcioChronicle', '@FootballFocusFM'];

export function reactToMatch(state: CareerState, r: MatchReport, rng: Rng): void {
  const u = r.user;
  const last = state.user.last;
  if (r.role === 'out' || r.youth) {
    if (r.youth && u && u.rating >= 7.8) addPost(state, { author: 'Academy Watch', handle: '@AcademyWatch', text: `${state.user.first} ${last} (${Math.floor((state.day - state.user.born) / 365.25)}) ran the show for the U19s again. First-team call soon? 👀`, likes: rng.int(40, 400), kind: 'journalist', mood: 1 });
    return;
  }
  if (!u) {
    if (rng.chance(0.35)) addPost(state, { author: 'Fan', handle: fanHandle(state, rng), text: rng.pick([`Why is ${last} not playing?? Give the kid a chance`, `${last} warming the bench again. Criminal.`, `Coach knows best I guess… ${last} deserves minutes though`]), likes: rng.int(5, 120), kind: 'fan', mood: 0 });
    return;
  }
  const good = u.rating >= 7.3;
  const bad = u.rating < 5.8;
  const n = good || bad ? 2 : 1;
  for (let i = 0; i < n; i++) {
    let text: string;
    if (u.goals >= 2) text = rng.pick([`${last} is HIM. ${u.goals} goals!!!`, `Someone sign ${last} to a lifetime deal NOW`, `${last} brace. Ballon d'Or incoming 😂🔥`]);
    else if (u.goals === 1) text = rng.pick([`What a finish from ${last}!`, `${last} with the goal, love to see it`, `${last} scores again. Consistency.`]);
    else if (good) text = rng.pick([`${last} was everywhere today. Class.`, `Underrated performance from ${last}`, `${last} made that look easy`]);
    else if (bad) text = rng.pick([`${last} was a passenger today`, `Not ${last}'s day. Bounce back.`, `Drop ${last}. Simple as.`]);
    else text = rng.pick([`Solid from ${last}, nothing flashy`, `${last} did his job`, `Decent shift from ${last}`]);
    addPost(state, { author: 'Fan', handle: fanHandle(state, rng), text, likes: Math.round(rng.range(10, 60) * (1 + state.user.followers / 20000)), kind: 'fan', mood: good ? 1 : bad ? -1 : 0 });
  }
  if ((good || bad) && rng.chance(0.5)) {
    addPost(state, {
      author: 'Journalist',
      handle: rng.pick(JOURNALISTS),
      text: good ? `${state.user.first} ${last} (${u.rating.toFixed(1)}) — ${u.goals ? `${u.goals}G ` : ''}${u.assists ? `${u.assists}A ` : ''}${u.keyPasses} key passes. Stock rising.` : `Tough afternoon for ${last}: ${u.passesCompleted}/${u.passes} passes, ${u.rating.toFixed(1)} rating.`,
      likes: rng.int(30, 900),
      kind: 'journalist',
      mood: good ? 1 : -1,
    });
  }
}

// ----- the player's own posts

export interface PostOption {
  key: string;
  label: string;
  desc: string;
  /** base follower gain as a fraction of followers */
  reach: number;
  risk: number;
}

export const POST_OPTIONS: PostOption[] = [
  { key: 'training', label: 'Training grind clip', desc: 'Sweat, cones and a motivational caption. Coaches approve.', reach: 0.01, risk: 0 },
  { key: 'fans', label: 'Thank the fans', desc: 'Heartfelt message to the supporters.', reach: 0.012, risk: 0 },
  { key: 'lifestyle', label: 'Lifestyle flex', desc: 'The car, the watch, the view. Big reach, some eye-rolls.', reach: 0.03, risk: 0.35 },
  { key: 'family', label: 'Family photo', desc: 'Sunday dinner with the family.', reach: 0.008, risk: 0 },
  { key: 'charity', label: 'Promote a charity', desc: 'Use your platform for good.', reach: 0.009, risk: 0 },
  { key: 'banter', label: 'Banter with a rival', desc: 'A cheeky dig at your rivals. Could go viral — either way.', reach: 0.045, risk: 0.55 },
];

export function makePost(state: CareerState, key: string, rng: Rng): string {
  const f = state.user;
  const opt = POST_OPTIONS.find((o) => o.key === key) ?? POST_OPTIONS[0];
  const fame = hasTrait(f, 'media') ? 1.6 : hasTrait(f, 'introvert') ? 0.7 : 1;
  const hobbyBoost = state.life.hobbies.photography ? 1.25 : 1;
  const base = Math.max(40, f.followers) * opt.reach * fame * hobbyBoost * rng.range(0.5, 1.6) + 20;
  const backfire = rng.chance(opt.risk * (hasTrait(f, 'humble') ? 0.6 : 1));
  const c = club(state, f.clubId);
  const rival = c ? state.world.clubs[c.rivalId]?.name ?? 'the rivals' : 'the rivals';
  const texts: Record<string, string> = {
    training: rng.pick(['Extra work. No shortcuts. 💪', 'The work you do when nobody watches. 🔁', 'Early start. Big goals.']),
    fans: rng.pick(['Your support means everything. See you on Saturday ❤️', 'Grateful for every single one of you. 🙏', 'We go again. Together.']),
    lifestyle: rng.pick(['New wheels 🏎️', 'Sunset from the balcony 🌅', 'Treat yourself ⌚']),
    family: rng.pick(['Sunday dinner with the ones who made it all possible ❤️', 'Mum\'s cooking > everything', 'Home.']),
    charity: rng.pick(['Proud to support the children\'s hospital today. Please donate 🙏', 'Football is nothing without community.']),
    banter: rng.pick([`Heard ${rival} are looking for a striker… 😂`, `${rival} fans very quiet today 🤫`, `Nice weather in ${rival} land. Shame about the football.`]),
  };
  const text = texts[opt.key];
  addPost(state, { author: `${f.first} ${f.last}`, handle: `@${f.first.toLowerCase()}${f.last.toLowerCase().replace(/[^a-z]/g, '')}`, text, likes: Math.round(base * rng.range(3, 8)), kind: 'self', mood: 1 });
  let summary: string;
  if (backfire) {
    f.followers = Math.max(0, Math.round(f.followers + base * 0.2));
    f.rep.local = clamp(f.rep.local - 1.5, 0, 100);
    f.professionalism = clamp(f.professionalism - (opt.key === 'lifestyle' ? 1.5 : 0.5), 0, 100);
    const coach = state.life.people.find((p) => p.role === 'coach' && !p.gone);
    if (coach && opt.key === 'banter') coach.affinity = clamp(coach.affinity - 3, 0, 100);
    addPost(state, { author: 'Fan', handle: fanHandle(state, rng), text: opt.key === 'banter' ? `Focus on your own game mate` : `Bit much when we\'re losing every week tbh`, likes: rng.int(50, 800), kind: 'fan', mood: -1 });
    summary = 'The post backfired a little — some fans were not impressed.';
  } else {
    f.followers = Math.round(f.followers + base);
    if (opt.key === 'fans' || opt.key === 'charity') f.rep.local = clamp(f.rep.local + 0.6, 0, 100);
    if (opt.key === 'training') f.professionalism = clamp(f.professionalism + 0.3, 0, 100);
    if (opt.key === 'family') state.life.happiness.family = clamp(state.life.happiness.family + 3, 0, 100);
    summary = `+${Math.round(base)} followers.`;
  }
  return summary;
}

// ----- weekly social dynamics and sponsors

export function weeklySocial(state: CareerState, rng: Rng): void {
  const f = state.user;
  const fame = Math.max(f.rep.local * 0.4, f.rep.national, f.rep.world * 1.3);
  const target = 150 + Math.pow(fame, 2.6) * 18 * (hasTrait(f, 'media') ? 1.6 : 1);
  // followers drift towards what his fame "deserves"
  f.followers = Math.round(f.followers + (target - f.followers) * 0.02 + rng.gauss(0, Math.max(5, f.followers * 0.002)));
  if (f.followers < 50) f.followers = 50;
  // reputation fades a little when out of the spotlight
  f.rep.local = clamp(f.rep.local - 0.12, 0, 100);
  f.rep.national = clamp(f.rep.national - 0.1, 0, 100);
  f.rep.world = clamp(f.rep.world - 0.06, 0, 100);
  if (rng.chance(0.25)) sponsorOffer(state, rng);
}

export function sponsorValue(state: CareerState, tier: number): number {
  const f = state.user;
  const fame = Math.max(f.rep.national, f.rep.world * 1.2, f.rep.local * 0.5);
  const followersBoost = Math.log10(Math.max(100, f.followers)) - 2;
  return roundMoney(Math.max(150, (60 + Math.pow(fame, 2.1) * 3) * (0.6 + tier * 0.45) * (0.7 + followersBoost * 0.25)));
}

export function sponsorOffer(state: CareerState, rng: Rng): void {
  const f = state.user;
  const fame = Math.max(f.rep.national, f.rep.world * 1.2, f.rep.local * 0.5);
  const maxTier = fame > 70 ? 4 : fame > 50 ? 3 : fame > 30 ? 2 : fame > 12 ? 1 : 0;
  const pending = state.inbox.some((m) => m.kind === 'sponsor' && !m.resolved);
  if (pending || state.life.sponsors.length >= 4) return;
  const options = BRANDS.filter((b) => b.tier <= maxTier && !state.life.sponsors.some((s) => s.category === b.category));
  if (options.length === 0) return;
  const b = rng.weighted(options, (x) => 1 + x.tier);
  const monthly = sponsorValue(state, b.tier);
  const months = rng.pick([6, 12, 12, 24]);
  const duties = b.tier >= 3 ? 2 : 1;
  addMessage(state, {
    from: b.brand,
    kind: 'sponsor',
    subject: `Partnership proposal: ${b.brand}`,
    body: `${b.brand} (${b.category}) would like you as an ambassador: ${formatMoney(state, monthly)} per month for ${months} months, with ${duties} promotional evening${duties > 1 ? 's' : ''} a month.${b.category === 'Betting' ? ' Some fans and your family may not love a betting deal.' : ''}${b.category === 'Fast food' ? ' Your nutritionist would probably disapprove.' : ''}`,
    actions: [
      { label: 'Accept', action: 'sponsor_accept', data: { brand: b.brand, category: b.category, monthly, months, duties } },
      { label: 'Decline', action: 'sponsor_decline' },
    ],
  });
}

export function acceptSponsor(state: CareerState, data: { brand: string; category: string; monthly: number; months: number; duties: number }): SponsorDeal {
  const deal: SponsorDeal = { id: state.nextMsgId++, brand: data.brand, category: data.category, monthly: data.monthly, startDay: state.day, endDay: state.day + data.months * 30, duties: data.duties, dutiesDone: 0 };
  state.life.sponsors.push(deal);
  if (data.category === 'Betting') {
    state.user.rep.local = clamp(state.user.rep.local - 2, 0, 100);
    state.life.happiness.family = clamp(state.life.happiness.family - 4, 0, 100);
  }
  return deal;
}
