// Life systems added in the final pass: milestones, children, new friends, the agent negotiating,
// retiring from international football, tapping-up and the match-fixing storyline.
import { describe, expect, it } from 'vitest';
import { advanceSlot, newCareer, rngOf, simulatePendingMatch } from '../src/career/core/career';
import { agentNegotiate, agentOptions, hireAgent, rejectOffer, transferInterest } from '../src/career/core/contracts';
import { dayOf } from '../src/career/core/dates';
import { EVENT_DEFS } from '../src/career/core/eventdefs';
import { pendingEvent, resolveEvent } from '../src/career/core/events';
import { activityBlocked, addChild, housingOptions, moveHouse, mortgageBlocked, netWorth, peopleOf, sellProperty, startDating, weeklyFinances } from '../src/career/core/life';
import { activityDef } from '../src/career/core/data/lifestyle';
import { MILESTONES, checkMilestones, milestoneCount, milestonePoints } from '../src/career/core/milestones';
import { evaluateCallUp } from '../src/career/core/national';
import { hallOfFameEntry, legacyScore } from '../src/career/core/retirement';
import { Rng } from '../src/career/core/rng';
import { deserialize, serialize } from '../src/career/core/save';
import { formatMoney } from '../src/career/core/messages';
import type { CareerState, ContractOffer } from '../src/career/core/types';
import { defaultInput, loadTables } from './careerhelpers';

const tables = loadTables();
const base = newCareer(defaultInput({ age: 16 }), { seed: 4242, db: tables });
base.user.born -= 365 * 9; // a 25-year-old
base.user.squad = 'first';
base.user.contract = { ...base.user.contract, kind: 'pro', wage: 12000, role: 'regular', endSeason: base.season + 3 };
base.life.money = 900000;
const json = serialize(base);
const fresh = (): CareerState => deserialize(json);

function fire(s: CareerState, id: string, choice: number, rng = new Rng(9)): string {
  const def = EVENT_DEFS.find((d) => d.id === id)!;
  const ctx = def.prepare ? def.prepare(s, rng) : {};
  expect(ctx).not.toBeNull();
  s.events.pending = { defId: id, day: s.day, ctx: ctx! };
  expect(pendingEvent(s)?.def.id).toBe(id);
  return resolveEvent(s, choice, rng);
}

function offerFrom(s: CareerState, clubId: number): ContractOffer {
  const o: ContractOffer = { id: s.nextMsgId++, clubId, kind: 'transfer', wage: 10000, years: 3, role: 'regular', signingBonus: 40000, releaseClause: 20_000_000, appearanceBonus: 1000, goalBonus: 2000, fee: 8_000_000, expiresDay: s.day + 14, status: 'pending', rounds: 0, patience: 1, note: '' };
  s.offers.push(o);
  return o;
}

describe('milestones', () => {
  it('unlock once, celebrate, and count towards the legacy', () => {
    const s = fresh();
    s.milestones = {};
    const before = legacyScore(s);
    s.user.followers = 12000;
    const got = checkMilestones(s).map((m) => m.key);
    expect(got).toContain('followers_10k');
    expect(got).toContain('pro_contract');
    expect(s.notices.some((n) => n.text.startsWith('Milestone:'))).toBe(true);
    expect(checkMilestones(s)).toHaveLength(0);
    expect(milestonePoints(s)).toBeGreaterThan(0);
    expect(legacyScore(s)).toBeGreaterThan(before);
    expect(milestoneCount(s).total).toBe(MILESTONES.length);
    expect(hallOfFameEntry(s).milestones).toBe(milestoneCount(s).got);
    expect(new Set(MILESTONES.map((m) => m.key)).size).toBe(MILESTONES.length);
  });

  it('are reached during a normal career loop', async () => {
    const { autoPlay } = await import('../src/career/core/autoplay');
    const s = newCareer(defaultInput({ talent: 'wonderkid' }), { seed: 91, db: tables });
    autoPlay(s, dayOf(2028, 9, 1));
    expect(Object.keys(s.milestones ?? {}).length).toBeGreaterThanOrEqual(3);
  });

  it('old saves without milestones still work', () => {
    const s = fresh();
    delete s.milestones;
    expect(() => checkMilestones(s)).not.toThrow();
    expect(s.milestones).toBeDefined();
  });
});

describe('family life', () => {
  it('a partner, a baby and time with the kids', () => {
    const s = fresh();
    const p = startDating(s, new Rng(3));
    p.stage = 'married';
    p.affinity = 90;
    const def = EVENT_DEFS.find((d) => d.id === 'baby_news')!;
    expect(def.condition!(s)).toBe(true);
    fire(s, 'baby_news', 0);
    const q = s.events.queue.find((x) => x.defId === 'baby_born');
    expect(q).toBeDefined();
    expect(q!.day - s.day).toBeGreaterThan(200);
    expect(activityBlocked(s, activityDef('family_time')!, 2)).not.toBeNull();
    fire(s, 'baby_born', 0);
    const kids = peopleOf(s, 'child');
    expect(kids).toHaveLength(1);
    expect(kids[0].last).toBe(s.user.last);
    expect(activityBlocked(s, activityDef('family_time')!, 2)).toBeNull();
    checkMilestones(s);
    expect(s.milestones!.parent).toBe(s.day);
    // children count as family
    const def2 = EVENT_DEFS.find((d) => d.id === 'child_moment')!;
    expect(def2.condition!(s)).toBe(true);
    const aff = kids[0].affinity;
    fire(s, 'child_moment', 1);
    expect(kids[0].affinity).toBeLessThan(aff);
  });

  it('buying the parents a house', () => {
    const s = fresh();
    const money = s.life.money;
    fire(s, 'parents_house', 0);
    expect(s.events.flags.parentsHouse).toBe(s.day);
    expect(s.life.money).toBeLessThan(money - 100000);
    checkMilestones(s);
    expect(s.milestones!.parents_house).toBeDefined();
  });

  it('new friends in a new city', () => {
    const s = fresh();
    const n = peopleOf(s, 'friend').length;
    fire(s, 'new_friend', 0);
    expect(peopleOf(s, 'friend').length).toBe(n + 1);
    const addChildCheck = addChild(s, 'Mia', 'daughter');
    expect(addChildCheck.role).toBe('child');
  });
});

describe('housing: buying with a mortgage', () => {
  it('pays a deposit, repays weekly and settles the loan when sold', () => {
    const s = fresh();
    s.user.born = base.user.born; // 25
    s.life.money = 150000;
    const opt = housingOptions(s).find((o) => o.kind === 'apartment' && !o.blocked && o.price > s.life.money)!;
    expect(opt).toBeDefined();
    expect(moveHouse(s, opt, true)).toBe('Not enough money');
    expect(mortgageBlocked(s, opt)).toBeNull();
    const worth = netWorth(s);
    expect(moveHouse(s, opt, true, true)).toBeNull();
    const p = s.life.properties[0];
    expect(p.mortgage).toBe(opt.price - Math.round(opt.price * 0.2));
    expect(s.life.housing.owned).toBe(true);
    expect(Math.abs(netWorth(s) - worth)).toBeLessThan(2);
    const loan = p.mortgage!;
    for (let w = 0; w < 10; w++) weeklyFinances(s, new Rng(w));
    expect(p.mortgage!).toBeLessThan(loan);
    expect(s.life.ledger.some((l) => l.label.startsWith('Mortgage'))).toBe(true);
    // a second mortgage is refused; selling (after moving out) repays the bank
    expect(mortgageBlocked(s, opt)).toBe('You already have a mortgage');
    s.life.housing = { kind: 'shared', owned: false, weekly: 200, since: s.day };
    const before = s.life.money;
    const proceeds = sellProperty(s, 0);
    expect(proceeds).toBeLessThan(opt.price);
    expect(s.life.money - before).toBe(proceeds);
    expect(s.life.properties).toHaveLength(0);
  });

  it('banks want a professional contract', () => {
    const s = fresh();
    s.user.contract = { ...s.user.contract, kind: 'youth' };
    const opt = housingOptions(s).find((o) => o.kind === 'apartment' && !o.blocked)!;
    expect(mortgageBlocked(s, opt)).toMatch(/professional/);
  });
});

describe('agent negotiates', () => {
  it('settles close to the club limit and never below the offer', () => {
    let weak = 0;
    let strong = 0;
    for (let i = 0; i < 12; i++) {
      for (const tier of [0, 3]) {
        const s = fresh();
        s.user.rep.national = 80;
        expect(hireAgent(s, agentOptions(s)[tier])).toBeNull();
        const o = offerFrom(s, 3);
        const r = agentNegotiate(s, o.id, new Rng(100 + i));
        if (r.outcome === 'accepted') {
          expect(o.status).toBe('pending');
          expect(o.wage).toBeGreaterThanOrEqual(10000);
          if (tier === 0) weak += o.wage;
          else strong += o.wage;
        }
      }
    }
    expect(strong).toBeGreaterThan(weak);
  });

  it('needs an agent', () => {
    const s = fresh();
    const o = offerFrom(s, 3);
    expect(agentNegotiate(s, o.id, new Rng(1)).outcome).toBe('rejected');
  });
});

describe('career storylines', () => {
  it('retiring from international football ends call-ups', () => {
    const s = fresh();
    s.user.national = 'senior';
    s.user.caps = 40;
    fire(s, 'international_retirement', 0);
    expect(s.events.flags.intlRetired).toBe(s.day);
    s.user.stats = Object.fromEntries(Object.keys(s.user.stats).map((k) => [k, 0.95])) as typeof s.user.stats;
    expect(evaluateCallUp(s, new Rng(2))).toBe('none');
  });

  it('a club that tapped him up bids in the window', () => {
    let hits = 0;
    for (let i = 0; i < 20; i++) {
      const s = fresh();
      s.day = dayOf(s.season, 7, 14);
      s.user.rep.national = 50;
      s.user.form = 70;
      s.events.flags.tappedBy = 5;
      s.events.flags.tappedDay = s.day - 30;
      transferInterest(s, new Rng(i + 1));
      if (s.offers.some((o) => o.status === 'pending' && o.clubId === 5)) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(3);
  });

  it('match fixing is found out and punished', () => {
    const s = fresh();
    s.life.sponsors.push({ id: 1, brand: 'Stryde', category: 'Boots', monthly: 5000, startDay: s.day, endDay: s.day + 300, duties: 1, dutiesDone: 0 });
    fire(s, 'match_fixer', 2, new Rng(1));
    expect(s.events.flags.fixerTaken).toBe(s.day);
    const rep = s.user.rep.national;
    s.user.rep.national = Math.max(rep, 40);
    fire(s, 'fixer_caught', 0);
    expect(s.user.banned).toBeGreaterThanOrEqual(10);
    expect(s.life.sponsors).toHaveLength(0);
    expect(s.user.rep.national).toBeLessThan(40);
  });

  it('has a broad catalogue of events', () => {
    expect(EVENT_DEFS.length).toBeGreaterThanOrEqual(55);
    const cats = new Set(EVENT_DEFS.map((d) => d.category));
    expect(cats.size).toBeGreaterThanOrEqual(9);
    void rngOf;
  });
});

describe('money is shown in one currency', () => {
  it('uses the home nation\'s currency wherever he plays', () => {
    const s = fresh();
    expect(formatMoney(s, 1500)).toMatch(/^£/);
    const german = s.world.clubs.find((c) => c.countryKey === 'GER')!;
    s.user.clubId = german.id;
    expect(formatMoney(s, 1500)).toMatch(/^£/);
    s.user.nat = 'BRA';
    expect(formatMoney(s, 1500)).toMatch(/^€/);
  });
});

describe('time never gets stuck', () => {
  it('a careless player who rejects every offer and picks random choices keeps moving', () => {
    const s = newCareer(defaultInput({ talent: 'grafter', traits: ['party', 'hothead'] }), { seed: 1313, db: tables });
    const rng = new Rng(77);
    s.life.plan = s.life.plan.map((d) => d.map((a, i) => (a === null ? null : i === 2 ? rng.pick(['night_out', 'bar', 'gaming', 'host_party', 'vip_night']) : rng.pick(['rest', 'shopping', 'surf', 'kickabout']))));
    s.life.diet = 'junk';
    let steps = 0;
    let lastKey = -1;
    let sameKey = 0;
    let freeAgentDays = 0;
    const end = dayOf(2028, 9, 1);
    while (!s.retired && s.day < end) {
      const r = advanceSlot(s);
      steps++;
      if (r === 'event') resolveEvent(s, rng.int(0, 3), rng);
      else if (r === 'match') simulatePendingMatch(s);
      for (const o of s.offers.filter((x) => x.status === 'pending' && x.kind !== 'free' && x.kind !== 'youth')) rejectOffer(s, o.id);
      if (s.user.clubId < 0) freeAgentDays++;
      const key = s.day * 3 + s.slot;
      sameKey = key === lastKey ? sameKey + 1 : 0;
      lastKey = key;
      expect(sameKey).toBeLessThan(12);
      expect(steps).toBeLessThan(60000);
    }
    expect(s.day).toBeGreaterThanOrEqual(end);
    expect(s.events.pending).toBeNull();
    void freeAgentDays;
  });
});
