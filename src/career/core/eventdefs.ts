// Narrative event catalogue. Each event is a small story beat with real trade-offs that touch
// the interlocking systems (energy, morale, professionalism, relationships, reputation, money,
// offers). Follow-ups continue the story days later. Weights are chances per check; with the
// cooldowns the player sees two or three events a week.

import { COURSES, TRANSPORT } from './data/lifestyle';
import { nationName } from './data/geography';
import { ageAt, weekday } from './dates';
import type { EventCtx, EventDef } from './events';
import { fullName, hasTrait, userAge, userOvr } from './footballer';
import { applyRehabChoice, specialistCost, startUserInjury } from './health';
import { club, city } from './index';
import { agent, breakUp, buyTransport, enrollCourse, invest, partner, peopleOf, startDating } from './life';
import { addMessage, addMoney, addNotice, addPost, formatMoney } from './messages';
import { Rng, clamp } from './rng';
import { hireAgent, agentOptions, requestTransfer, clubValuation } from './contracts';
import type { CareerState, Person } from './types';
import { nextUserFixture } from './results';
import { teamName } from './competitions';

// ----- helpers

interface Fx {
  morale?: number;
  energy?: number;
  prof?: number;
  social?: number;
  family?: number;
  romance?: number;
  home?: number;
  football?: number;
  money?: number;
  moneyLabel?: string;
  repLocal?: number;
  repNat?: number;
  followers?: number;
  coach?: number;
  teammates?: number;
  fitness?: number;
  form?: number;
  partner?: number;
  sleep?: number;
}

function fx(s: CareerState, e: Fx): void {
  const f = s.user;
  const h = s.life.happiness;
  if (e.morale) f.morale = clamp(f.morale + e.morale, 0, 100);
  if (e.energy) f.energy = clamp(f.energy + e.energy, 0, 100);
  if (e.prof) f.professionalism = clamp(f.professionalism + e.prof, 0, 100);
  if (e.social) h.social = clamp(h.social + e.social, 0, 100);
  if (e.family) {
    h.family = clamp(h.family + e.family, 0, 100);
    for (const p of s.life.people) if (!p.gone && (p.role === 'mother' || p.role === 'father' || p.role === 'sibling')) p.affinity = clamp(p.affinity + e.family * 0.8, 0, 100);
  }
  if (e.romance) h.romance = clamp(h.romance + e.romance, 0, 100);
  if (e.home) h.home = clamp(h.home + e.home, 0, 100);
  if (e.football) h.football = clamp(h.football + e.football, 0, 100);
  if (e.money) addMoney(s, e.money, e.moneyLabel ?? 'Expense');
  if (e.repLocal) f.rep.local = clamp(f.rep.local + e.repLocal, 0, 100);
  if (e.repNat) f.rep.national = clamp(f.rep.national + e.repNat, 0, 100);
  if (e.followers) f.followers = Math.max(0, Math.round(f.followers + (Math.abs(e.followers) < 1 ? f.followers * e.followers : e.followers)));
  if (e.coach) {
    const c = s.life.people.find((p) => p.role === 'coach' && !p.gone);
    if (c) c.affinity = clamp(c.affinity + e.coach, 0, 100);
  }
  if (e.teammates) for (const p of peopleOf(s, 'teammate')) p.affinity = clamp(p.affinity + e.teammates, 0, 100);
  if (e.fitness) f.fitness = clamp(f.fitness + e.fitness, 0, 100);
  if (e.form) f.form = clamp(f.form + e.form, 0, 100);
  if (e.partner) {
    const p = partner(s);
    if (p) p.affinity = clamp(p.affinity + e.partner, 0, 100);
  }
  if (e.sleep) s.life.sleepMult *= e.sleep;
}

function mate(s: CareerState, rng: Rng): Person | null {
  const list = peopleOf(s, 'teammate');
  return list.length ? rng.pick(list) : null;
}

function coachName(s: CareerState): string {
  const c = s.life.people.find((p) => p.role === 'coach' && !p.gone);
  return c ? `${c.first} ${c.last}` : 'the coach';
}

function clubName(s: CareerState): string {
  return club(s, s.user.clubId)?.name ?? 'your club';
}

function cityName(s: CareerState): string {
  return city(s, s.life.cityId).name;
}

function hasClub(s: CareerState): boolean {
  return s.user.clubId >= 0;
}

function isSeason(s: CareerState): boolean {
  const m = new Date(s.day * 86400000).getUTCMonth() + 1;
  return m >= 8 || m <= 5;
}

function matchTomorrow(s: CareerState): boolean {
  const f = nextUserFixture(s);
  return !!f && f.day === s.day + 1;
}

function recentRatings(s: CareerState, n: number): number[] {
  return s.user.ratings.slice(-n);
}

function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function coachAffinity(s: CareerState): number {
  return s.life.people.find((p) => p.role === 'coach' && !p.gone)?.affinity ?? 50;
}

function opponentName(s: CareerState): string {
  const f = nextUserFixture(s);
  if (!f) return 'the opposition';
  const oppId = f.home === s.user.clubId ? f.away : f.home;
  return teamName(s, oppId);
}

export const EVENT_DEFS: EventDef[] = [
  // ------------------------------------------------------------ club & dressing room
  {
    id: 'night_before_match',
    category: 'social',
    trigger: 'evening',
    condition: (s) => hasClub(s) && matchTomorrow(s) && userAge(s) >= 17 && !s.user.injury,
    weight: (s) => (hasTrait(s.user, 'party') ? 0.3 : 0.14),
    cooldown: 20,
    prepare: (s, rng) => {
      const m = mate(s, rng);
      return m ? { mate: m.first, mateId: m.id } : null;
    },
    title: () => 'One drink?',
    text: (s, c) => `${c.mate} texts: "Big game tomorrow, but a couple of us are going to that new bar in ${cityName(s)}. Just one drink, promise. You in?"`,
    choices: [
      {
        label: 'Go out with them',
        hint: '+Social, +teammates · tired tomorrow, the coach may hear about it',
        auto: 0.6,
        apply: (s, c, rng) => {
          fx(s, { social: 12, morale: 3, energy: -15, prof: -3, sleep: 0.55, teammates: 2 });
          const p = s.life.people.find((x) => x.id === c.mateId);
          if (p) p.affinity = clamp(p.affinity + 8, 0, 100);
          if (rng.chance(0.35)) s.events.queue.push({ defId: 'tabloid_photo', day: s.day + 1, ctx: { mate: c.mate } });
          return `"Just one drink" became four. You got home at 2am.`;
        },
      },
      {
        label: 'One drink, then home',
        hint: '+Social · a little tired',
        auto: 1.2,
        apply: (s) => {
          fx(s, { social: 6, energy: -5, teammates: 1, sleep: 0.9 });
          return 'You showed your face, had one soft drink and left at ten. Respect from both sides.';
        },
      },
      {
        label: 'Decline — early night',
        hint: '+Professionalism · teammates think you are boring',
        auto: 2,
        apply: (s, c) => {
          fx(s, { prof: 2, social: -3, sleep: 1.1 });
          const p = s.life.people.find((x) => x.id === c.mateId);
          if (p) p.affinity = clamp(p.affinity - 4, 0, 100);
          return `${c.mate} replies with a sleeping emoji. You sleep like a baby.`;
        },
      },
    ],
  },
  {
    id: 'tabloid_photo',
    category: 'media',
    trigger: 'queued',
    title: () => 'Caught on camera',
    text: (s) => `A tabloid runs photos of you leaving a bar at 2am the night before the game. "${s.user.last.toUpperCase()} PARTY SHAME" is trending in ${cityName(s)}.`,
    choices: [
      {
        label: 'Apologise publicly',
        hint: '−a little reputation · the coach appreciates it',
        auto: 2,
        apply: (s) => {
          fx(s, { repLocal: -1.5, coach: 3, morale: -2 });
          return 'Your apology is accepted. The story dies within a day.';
        },
      },
      {
        label: 'Ignore it',
        hint: '−reputation, −coach',
        auto: 1,
        apply: (s) => {
          fx(s, { repLocal: -3, coach: -5 });
          return 'The story rumbles on for a few days. The coach is not amused.';
        },
      },
      {
        label: 'Laugh it off online',
        hint: '+followers · −coach, −professionalism',
        auto: 0.5,
        apply: (s) => {
          fx(s, { followers: 0.04, coach: -8, prof: -3, repLocal: -1 });
          return 'Your meme reply goes viral. Your coach does not follow you.';
        },
      },
    ],
  },
  {
    id: 'journalist_bait',
    category: 'media',
    trigger: 'morning',
    condition: (s) => hasClub(s) && s.user.squad === 'first' && isSeason(s) && (s.reports[0]?.role !== 'start' || s.user.morale < 45),
    weight: () => 0.03,
    cooldown: 45,
    title: () => 'A loaded question',
    text: (s) => `After training a journalist corners you: "You're clearly good enough to start. Is ${coachName(s)} making a mistake by not playing you?"`,
    choices: [
      {
        label: '"I trust the coach completely."',
        hint: '+coach',
        auto: 2,
        apply: (s) => {
          fx(s, { coach: 5, prof: 1 });
          return 'A dull headline — exactly what the coach wanted.';
        },
      },
      {
        label: '"I just want to help the team."',
        hint: 'neutral',
        auto: 1.5,
        apply: (s) => {
          fx(s, { coach: 1 });
          return 'A diplomatic answer. Nobody learns anything.';
        },
      },
      {
        label: '"Ask him, not me."',
        hint: '+fans who agree · −−coach, follow-up',
        auto: 0.3,
        apply: (s) => {
          fx(s, { coach: -12, repLocal: 1, followers: 0.02, morale: 2 });
          s.events.queue.push({ defId: 'coach_meeting', day: s.day + 1, ctx: {} });
          return `"${s.user.last} HITS OUT" is tomorrow's back page.`;
        },
      },
    ],
  },
  {
    id: 'coach_meeting',
    category: 'club',
    trigger: 'queued',
    title: () => 'Office. Now.',
    text: (s) => `${coachName(s)} slams the paper on the desk. "If you have something to say, you say it to my face. Not to the press."`,
    choices: [
      {
        label: 'Apologise',
        hint: '+coach',
        auto: 2,
        apply: (s) => {
          fx(s, { coach: 9, morale: -2 });
          return 'He nods. "Now show me on the pitch."';
        },
      },
      {
        label: 'Stand your ground',
        hint: '−coach · +morale if ambitious',
        auto: 0.7,
        apply: (s) => {
          fx(s, { coach: -6, morale: hasTrait(s.user, 'ambitious') ? 4 : -2 });
          return 'You leave the office with the door still shaking.';
        },
      },
      {
        label: 'Ask to leave the club',
        hint: 'transfer request · −−coach, −fans',
        available: (s) => (s.user.contract.kind === 'pro' ? true : 'Only with a professional contract'),
        auto: 0.2,
        apply: (s) => {
          requestTransfer(s);
          return 'You hand in a written transfer request. Clubs will hear about it.';
        },
      },
    ],
  },
  {
    id: 'rebel_talk',
    category: 'club',
    trigger: 'morning',
    condition: (s) => hasClub(s) && s.user.squad === 'first' && isSeason(s) && peopleOf(s, 'teammate').length > 0,
    weight: () => 0.012,
    cooldown: 90,
    prepare: (s, rng) => {
      const m = mate(s, rng);
      return m ? { mate: m.first } : null;
    },
    title: () => 'Dressing-room whispers',
    text: (s, c) => `Some senior players are grumbling about ${coachName(s)}'s methods. ${c.mate} pulls you aside: "We're going to the chairman. Are you with us?"`,
    choices: [
      {
        label: 'Join them',
        hint: '+teammates · −−coach',
        auto: 0.6,
        apply: (s, _c, rng) => {
          fx(s, { teammates: 5, coach: -10 });
          if (rng.chance(0.25)) {
            addNotice(s, 'The rebellion worked — the chairman is reviewing the coach\'s position.', 'info');
            s.events.flags.coachUnderPressure = s.day;
          }
          return 'Your name is on the list. The dressing room respects you; the coach will not.';
        },
      },
      {
        label: 'Stay out of it',
        hint: 'neutral',
        auto: 2,
        apply: () => 'You keep your head down and focus on your football.',
      },
      {
        label: 'Warn the coach',
        hint: '++coach · −−teammates',
        auto: 0.4,
        apply: (s) => {
          fx(s, { coach: 12, teammates: -10, social: -4 });
          return 'The coach thanks you quietly. Somehow the lads find out.';
        },
      },
    ],
  },
  {
    id: 'teammate_mockery',
    category: 'club',
    trigger: 'morning',
    condition: (s) => hasClub(s) && peopleOf(s, 'teammate').length > 0 && !s.user.injury,
    weight: (s) => (hasTrait(s.user, 'hothead') ? 0.02 : 0.01),
    cooldown: 80,
    prepare: (s, rng) => {
      const m = mate(s, rng);
      return m ? { mate: m.first, mateId: m.id } : null;
    },
    title: () => 'Training-ground tension',
    text: (_s, c) => `In a rondo ${c.mate} nutmegs you, then keeps mocking you in front of everyone. The lads are laughing.`,
    choices: [
      {
        label: 'Laugh it off',
        hint: '+teammates',
        auto: 2,
        apply: (s, c) => {
          const p = s.life.people.find((x) => x.id === c.mateId);
          if (p) p.affinity = clamp(p.affinity + 5, 0, 100);
          fx(s, { teammates: 1 });
          return 'Next rondo you nutmeg him back. Honours even.';
        },
      },
      {
        label: 'Confront him',
        hint: 'risky: a fight means a fine',
        auto: (s) => (hasTrait(s.user, 'hothead') ? 1 : 0.4),
        apply: (s, c, rng) => {
          const p = s.life.people.find((x) => x.id === c.mateId);
          if (rng.chance(hasTrait(s.user, 'hothead') ? 0.6 : 0.3)) {
            fx(s, { coach: -8, prof: -3, money: -Math.round(s.user.contract.wage * 1), moneyLabel: 'Club fine', morale: -3 });
            if (p) p.affinity = clamp(p.affinity - 15, 0, 100);
            return 'It escalated into a scuffle. The club fines you a week\'s wages.';
          }
          if (p) p.affinity = clamp(p.affinity + 2, 0, 100);
          fx(s, { morale: 2 });
          return 'Words were exchanged. He backs down — and respects you more for it.';
        },
      },
      {
        label: 'Tell the coach',
        hint: '+coach · −teammates',
        auto: 0.3,
        apply: (s) => {
          fx(s, { coach: 2, teammates: -4 });
          return 'The coach has a word. The dressing room labels you a snitch.';
        },
      },
    ],
  },
  {
    id: 'coach_praise',
    category: 'club',
    trigger: 'morning',
    condition: (s) => hasClub(s) && recentRatings(s, 3).length === 3 && avg(recentRatings(s, 3)) >= 7.3,
    weight: () => 0.15,
    cooldown: 40,
    title: () => 'The coach is impressed',
    text: (s) => `${coachName(s)} stops you after training: "Your last few games have been excellent. Keep this up."`,
    choices: [
      {
        label: 'Thank him',
        hint: '+coach, +morale',
        auto: 2,
        apply: (s) => {
          fx(s, { coach: 5, morale: 4 });
          return 'A handshake and a nod. You walk taller.';
        },
      },
      {
        label: 'Ask for a bigger role',
        hint: 'may improve your standing — or annoy him',
        auto: 1,
        apply: (s, _c, rng) => {
          if (coachAffinity(s) > 55 && rng.chance(0.65)) {
            fx(s, { coach: 3, morale: 6 });
            if (s.user.contract.role === 'rotation' || s.user.contract.role === 'prospect') s.user.contract.role = 'regular';
            return 'He agrees: you are part of his plans. Your status in the squad has improved.';
          }
          fx(s, { coach: -3 });
          return '"Do not get ahead of yourself." Fair enough.';
        },
      },
    ],
  },
  {
    id: 'benched_frustration',
    category: 'club',
    trigger: 'morning',
    condition: (s) => hasClub(s) && s.reports.length >= 3 && s.reports.slice(0, 3).every((r) => r.role !== 'start' && !r.youth),
    weight: () => 0.25,
    cooldown: 30,
    title: () => 'Stuck on the bench',
    text: () => 'Three games without starting. You are frustrated and your family keeps asking why you are not playing.',
    choices: [
      {
        label: 'Ask the coach what to improve',
        hint: '+coach, clear feedback',
        auto: 2,
        apply: (s) => {
          fx(s, { coach: 4, prof: 1 });
          const val = clubValuation(s, s.user.clubId);
          return `The coach is honest: "${val.diff < -6 ? 'You are not at the level of the starters yet. Work on your weaknesses.' : 'You are close. Keep pushing in training and your chance will come.'}"`;
        },
      },
      {
        label: 'Train even harder',
        hint: '+effort, −energy',
        auto: 1.5,
        apply: (s) => {
          s.user.effort = clamp(s.user.effort + 0.12, 0, 1);
          fx(s, { energy: -8, prof: 2, coach: 2 });
          return 'Extra sessions, extra focus. The staff notice.';
        },
      },
      {
        label: 'Vent on social media',
        hint: '+followers · −−coach',
        auto: 0.3,
        apply: (s) => {
          fx(s, { followers: 0.03, coach: -10, repLocal: -1 });
          addPost(s, { author: fullName(s.user), handle: `@${s.user.first.toLowerCase()}${s.user.last.toLowerCase()}`, text: 'Some things are hard to understand. 🤐', likes: Math.round(s.user.followers * 0.1), kind: 'self', mood: -1 });
          return 'The cryptic post is analysed by every pundit in the country.';
        },
      },
      {
        label: 'Ask your agent to find a move',
        hint: 'more transfer interest',
        available: (s) => (agent(s) ? true : 'You have no agent'),
        auto: 0.6,
        apply: (s) => {
          s.events.flags.agentPush = s.day;
          fx(s, { morale: 2 });
          return 'Your agent starts making calls.';
        },
      },
    ],
  },
  {
    id: 'captaincy',
    category: 'club',
    trigger: 'weekly',
    condition: (s) => hasClub(s) && s.user.squad === 'first' && userAge(s) >= 23 && coachAffinity(s) >= 68 && !s.events.flags[`captain-${s.user.clubId}`] && (s.user.contract.role === 'key' || s.user.contract.role === 'star' || hasTrait(s.user, 'leader')),
    weight: (s) => (hasTrait(s.user, 'leader') ? 0.2 : 0.06),
    cooldown: 200,
    title: () => 'The armband',
    text: (s) => `${coachName(s)}: "The club needs a leader. I want you to be our captain."`,
    choices: [
      {
        label: 'Accept with pride',
        hint: '+reputation, +teammates · pressure',
        auto: 3,
        apply: (s) => {
          s.events.flags[`captain-${s.user.clubId}`] = s.day;
          fx(s, { repLocal: 6, repNat: 2, teammates: 4, morale: 8, family: 5 });
          addNotice(s, `You are the new captain of ${clubName(s)}!`, 'gold');
          s.user.awards.push({ season: s.season, name: `Captain of ${clubName(s)}` });
          return 'You lead the team out on Saturday. Goosebumps.';
        },
      },
      {
        label: 'Decline — focus on your game',
        hint: 'neutral',
        auto: 0.3,
        apply: (s) => {
          fx(s, { coach: -2 });
          return 'The coach respects your decision.';
        },
      },
    ],
  },
  {
    id: 'mentor_offer',
    category: 'club',
    trigger: 'weekly',
    condition: (s) => hasClub(s) && userAge(s) < 20 && !s.life.people.some((p) => p.role === 'mentor' && !p.gone),
    weight: () => 0.08,
    once: true,
    prepare: (s, rng) => {
      const squad = s.world.npcs.filter((n) => n.clubId === s.user.clubId && n.squad === 'first' && ageAt(n.born, s.day) > 29);
      if (squad.length === 0) return null;
      const n = rng.pick(squad);
      return { name: `${n.first} ${n.last}`, first: n.first, last: n.last, npcId: n.id };
    },
    title: () => 'An old head',
    text: (_s, c) => `Veteran ${c.name} has been watching you: "You remind me of me at your age. Want me to show you a few things?"`,
    choices: [
      {
        label: 'Accept the mentorship',
        hint: '+training efficiency, a new mentor',
        auto: 3,
        apply: (s, c) => {
          s.life.people.push({ id: s.life.nextPersonId++, first: String(c.first), last: String(c.last), role: 'mentor', affinity: 70, lastContact: s.day, since: s.day, npcId: Number(c.npcId), job: 'Veteran teammate' });
          s.events.flags.mentor = s.day;
          fx(s, { prof: 3, morale: 3 });
          return 'Extra sessions, stories and brutal honesty. You are learning fast.';
        },
      },
      {
        label: 'Politely decline',
        auto: 0.2,
        apply: () => 'You prefer to find your own way.',
      },
    ],
  },
  {
    id: 'community_day',
    category: 'club',
    trigger: 'weekly',
    condition: (s) => hasClub(s),
    weight: () => 0.05,
    cooldown: 120,
    title: () => 'Community day',
    text: (s) => `${clubName(s)} is running a community day at a local school on your day off. Attendance is voluntary.`,
    choices: [
      {
        label: 'Go and coach the kids',
        hint: '+local reputation, +morale, −energy',
        auto: 2,
        apply: (s) => {
          fx(s, { repLocal: 3, morale: 3, energy: -8, coach: 2 });
          s.life.charity.points += 2;
          return 'Forty kids chanting your name. Worth it.';
        },
      },
      {
        label: 'Rest instead',
        hint: '+energy',
        auto: 1,
        apply: (s) => {
          fx(s, { energy: 10 });
          return 'You spend the day on the sofa.';
        },
      },
    ],
  },

  // ------------------------------------------------------------ career
  {
    id: 'scout_watching',
    category: 'career',
    trigger: 'matchEve',
    condition: (s) => hasClub(s) && !s.user.injury && s.user.rep.national < 60,
    weight: (s) => 0.06 + s.user.form / 1500,
    cooldown: 50,
    prepare: (s, rng) => {
      const cur = club(s, s.user.clubId);
      const bigger = s.world.clubs.filter((c) => c.reputation > (cur?.reputation ?? 40) + 8);
      if (!bigger.length) return null;
      const c = rng.pick(bigger);
      return { club: c.name, clubId: c.id };
    },
    title: () => 'A scout in the stands',
    text: (_s, c) => `Word reaches you: the chief scout of ${c.club} will be in the stands tomorrow.`,
    choices: [
      {
        label: 'Stay calm, play your game',
        hint: '+composure',
        auto: 2,
        apply: (s, c) => {
          s.events.flags.scoutClub = Number(c.clubId);
          s.events.flags.scoutDay = s.day + 1;
          fx(s, { morale: 2 });
          return 'It is just another game. Right?';
        },
      },
      {
        label: 'Tell your agent',
        hint: 'more transfer interest',
        available: (s) => (agent(s) ? true : 'You have no agent'),
        auto: 1,
        apply: (s, c) => {
          s.events.flags.scoutClub = Number(c.clubId);
          s.events.flags.scoutDay = s.day + 1;
          s.events.flags.agentPush = s.day;
          return 'Your agent will make sure they have your number.';
        },
      },
      {
        label: 'Early night to be at your best',
        hint: '+energy tomorrow',
        auto: 1.5,
        apply: (s, c) => {
          s.events.flags.scoutClub = Number(c.clubId);
          s.events.flags.scoutDay = s.day + 1;
          fx(s, { sleep: 1.15, social: -2 });
          return 'In bed by nine. Lights out, head clear.';
        },
      },
    ],
  },
  {
    id: 'contract_rumour',
    category: 'media',
    trigger: 'morning',
    condition: (s) => hasClub(s) && s.user.rep.national > 25 && s.user.contract.kind === 'pro',
    weight: () => 0.012,
    cooldown: 90,
    prepare: (s, rng) => {
      const cur = club(s, s.user.clubId);
      const bigger = s.world.clubs.filter((c) => c.reputation > (cur?.reputation ?? 40) + 5);
      if (!bigger.length) return null;
      return { club: rng.pick(bigger).name };
    },
    title: () => 'Transfer gossip',
    text: (_s, c) => `The papers claim ${c.club} are preparing a bid for you. Fans are nervous; reporters want a reaction.`,
    choices: [
      {
        label: '"I am happy here."',
        hint: '+fans, +club',
        auto: 2,
        apply: (s) => {
          fx(s, { repLocal: 3, coach: 2 });
          return 'The fans sing your name on Saturday.';
        },
      },
      {
        label: '"Every player dreams of a club like that."',
        hint: '+transfer interest · −fans',
        auto: 0.6,
        apply: (s) => {
          fx(s, { repLocal: -4, coach: -3 });
          s.events.flags.agentPush = s.day;
          return 'Your agent\'s phone starts ringing. The home fans are less happy.';
        },
      },
      {
        label: 'No comment',
        auto: 1,
        apply: () => 'You smile and walk on.',
      },
    ],
  },
  {
    id: 'agent_approach',
    category: 'career',
    trigger: 'weekly',
    condition: (s) => !agent(s) && userAge(s) >= 16.3,
    weight: (s) => 0.08 + s.user.rep.national / 300,
    cooldown: 120,
    title: () => 'An agent calls',
    text: () => 'A smooth voice on the phone: "I represent some of the best young players in the country. I think I can make you a lot of money."',
    choices: [
      {
        label: 'Sign with him',
        hint: 'an agent negotiates better deals (fee from your wage)',
        auto: 2,
        apply: (s) => {
          const options = agentOptions(s);
          const rep = Math.max(s.user.rep.national, s.user.rep.world, s.user.rep.local * 0.5);
          const best = [...options].reverse().find((a) => rep >= a.minRep) ?? options[0];
          hireAgent(s, best);
          return `${best.first} ${best.last} is now your agent (${Math.round(best.fee * 100)}% fee).`;
        },
      },
      {
        label: 'Ask your parents first',
        hint: '+family',
        auto: 1,
        apply: (s) => {
          fx(s, { family: 4 });
          s.events.queue.push({ defId: 'agent_approach', day: s.day + 10, ctx: {} });
          return 'Your parents want to meet him first. He will call back.';
        },
      },
      {
        label: 'Not interested',
        auto: 0.5,
        apply: () => 'You hang up. You will find your own way.',
      },
    ],
  },
  {
    id: 'retirement_thoughts',
    category: 'career',
    trigger: 'weekly',
    condition: (s) => userAge(s) >= 33 && !s.events.flags.retireDecided,
    weight: (s) => (userAge(s) - 32) * 0.02 + (s.user.injury ? 0.05 : 0),
    cooldown: 120,
    title: () => 'Thinking about the end',
    text: (s) => `At ${Math.floor(userAge(s))}, recovery takes longer and the young players are quicker. Your partner, family and agent all ask the same question: how much longer?`,
    choices: [
      {
        label: 'Retire at the end of the season',
        hint: 'ends your playing career in the summer',
        auto: (s) => (userAge(s) >= 36.5 ? 2 : userAge(s) >= 35 ? 0.5 : 0.04),
        apply: (s) => {
          s.events.flags.retireDecided = s.day;
          s.events.flags.retireAtSeasonEnd = s.season;
          addNotice(s, 'You will retire at the end of the season.', 'gold');
          return 'You tell the club. The farewell tour begins.';
        },
      },
      {
        label: 'Keep going',
        hint: 'as long as the legs allow',
        auto: 2,
        apply: (s) => {
          fx(s, { morale: 2 });
          return 'Not yet. There is still fire in you.';
        },
      },
    ],
  },

  // ------------------------------------------------------------ media & social
  {
    id: 'post_match_interview',
    category: 'media',
    trigger: 'postMatch',
    condition: (s) => !!s.reports[0]?.user && (s.reports[0].user!.rating >= 7.4 || s.reports[0].user!.rating <= 5.6) && !s.reports[0].youth,
    weight: () => 0.45,
    cooldown: 10,
    title: () => 'Flash interview',
    text: (s) => {
      const r = s.reports[0];
      return `${r ? `${r.homeName} ${r.hg}-${r.ag} ${r.awayName}. ` : ''}A microphone is pushed in your face: "What happened out there today?"`;
    },
    choices: [
      {
        label: 'Praise the team',
        hint: '+teammates, +coach',
        auto: 2,
        apply: (s) => {
          fx(s, { teammates: 3, coach: 2, repLocal: 0.5 });
          return '"It was a team performance." The dressing room likes that.';
        },
      },
      {
        label: 'Talk about your own game',
        hint: '+followers · −teammates',
        auto: 0.8,
        apply: (s) => {
          fx(s, { followers: 0.015, teammates: -2 });
          return 'Confident, maybe a little too confident.';
        },
      },
      {
        label: 'Blame the referee',
        hint: '+fans · risk of a fine',
        auto: 0.4,
        apply: (s, _c, rng) => {
          fx(s, { repLocal: 1, prof: -1 });
          if (rng.chance(0.4)) {
            fx(s, { money: -Math.round(Math.max(500, s.user.contract.wage * 0.5)), moneyLabel: 'FA fine' });
            return 'The federation fines you for your comments.';
          }
          return 'Fans love the passion. The federation takes note.';
        },
      },
    ],
  },
  {
    id: 'pre_match_press',
    category: 'media',
    trigger: 'matchEve',
    condition: (s) => {
      const f = nextUserFixture(s);
      if (!f || f.youth) return false;
      const c = s.comps.find((x) => x.id === f.compId);
      return !!c && (c.type === 'continental' || c.type === 'international' || (c.type === 'cup' && f.round >= 4) || f.home === club(s, s.user.clubId)?.rivalId || f.away === club(s, s.user.clubId)?.rivalId);
    },
    weight: () => 0.5,
    cooldown: 7,
    title: () => 'Pre-match press conference',
    text: (s) => `Big game tomorrow against ${opponentName(s)}. The room is packed.`,
    choices: [
      {
        label: 'Confident: "We will win."',
        hint: '+morale, pressure',
        auto: 1,
        apply: (s) => {
          fx(s, { morale: 4, followers: 0.01 });
          s.events.flags.boast = s.day + 1;
          return 'Bold words. Now back them up.';
        },
      },
      {
        label: 'Respectful and humble',
        hint: '+reputation',
        auto: 2,
        apply: (s) => {
          fx(s, { repNat: 1, coach: 1 });
          return '"They are a great side. We will give everything."';
        },
      },
      {
        label: 'Wind them up',
        hint: '+followers · the opponents will be fired up',
        auto: 0.4,
        apply: (s) => {
          fx(s, { followers: 0.03, prof: -1 });
          s.events.flags.windUp = s.day + 1;
          return 'The clip is everywhere within the hour.';
        },
      },
    ],
  },
  {
    id: 'pundit_criticism',
    category: 'media',
    trigger: 'morning',
    condition: (s) => recentRatings(s, 3).length === 3 && avg(recentRatings(s, 3)) < 6.1,
    weight: () => 0.12,
    cooldown: 40,
    title: () => 'The pundits are not kind',
    text: (s) => `A famous TV pundit: "${s.user.last}? Overrated. I do not know what the fuss is about."`,
    choices: [
      {
        label: 'Let your football do the talking',
        hint: '+professionalism',
        auto: 2,
        apply: (s) => {
          fx(s, { prof: 2, morale: -2 });
          return 'You pin the clip to your dressing-room mirror.';
        },
      },
      {
        label: 'Fire back online',
        hint: '+followers · −reputation',
        auto: 0.5,
        apply: (s) => {
          fx(s, { followers: 0.03, repNat: -1, morale: 2 });
          return 'Your reply gets more likes than his show has viewers.';
        },
      },
    ],
  },
  {
    id: 'fan_abuse',
    category: 'social',
    trigger: 'evening',
    condition: (s) => s.user.followers > 2000 && recentRatings(s, 2).length === 2 && avg(recentRatings(s, 2)) < 6,
    weight: () => 0.12,
    cooldown: 45,
    title: () => 'Online abuse',
    text: () => 'After two poor games your notifications are full of abuse. Some messages are really nasty.',
    choices: [
      {
        label: 'Block, report, move on',
        hint: '−a little morale',
        auto: 2,
        apply: (s) => {
          fx(s, { morale: -2 });
          return 'The club\'s social team helps. You feel a bit better.';
        },
      },
      {
        label: 'Take a social media break',
        hint: '+morale · −followers',
        auto: 1.5,
        apply: (s) => {
          fx(s, { morale: 4, followers: -0.02 });
          return 'A week offline. The best week in months.';
        },
      },
      {
        label: 'Respond angrily',
        hint: '−reputation',
        auto: 0.3,
        apply: (s) => {
          fx(s, { repLocal: -2, morale: -3, followers: 0.01 });
          return 'Screenshots of your reply make the news. Not a good look.';
        },
      },
    ],
  },
  {
    id: 'fan_encounter',
    category: 'social',
    trigger: 'evening',
    condition: (s) => s.user.rep.local > 8,
    weight: () => 0.025,
    cooldown: 25,
    title: () => 'A young fan',
    text: (s) => `Outside a shop in ${cityName(s)} a kid in your shirt freezes, then whispers: "Can… can I have a photo?"`,
    choices: [
      {
        label: 'Photo, autograph and a chat',
        hint: '+local reputation, +followers',
        auto: 3,
        apply: (s) => {
          fx(s, { repLocal: 1.5, followers: 60, morale: 2 });
          addPost(s, { author: 'Proud dad', handle: '@proud_dad_' + Math.floor(s.day % 97), text: `My son met ${s.user.first} ${s.user.last} today. What a guy. ❤️`, likes: 400 + Math.floor(s.user.followers * 0.02), kind: 'fan', mood: 1 });
          return 'The dad\'s post gets thousands of likes.';
        },
      },
      {
        label: 'Quick photo, you are in a hurry',
        auto: 1,
        apply: (s) => {
          fx(s, { repLocal: 0.3 });
          return 'A quick selfie and you are off.';
        },
      },
    ],
  },
  {
    id: 'celebrity_party',
    category: 'social',
    trigger: 'evening',
    condition: (s) => s.user.followers > 60000 && userAge(s) >= 18,
    weight: () => 0.02,
    cooldown: 60,
    title: () => 'Celebrity invitation',
    text: () => 'A famous musician invites you to an exclusive party. Cameras, influencers, a rooftop pool.',
    choices: [
      {
        label: 'Go',
        hint: '++followers, +social · −professionalism, tired',
        auto: 1,
        apply: (s) => {
          fx(s, { followers: 0.05, social: 12, prof: -3, energy: -15, sleep: 0.6 });
          return 'You end up in everyone\'s stories.';
        },
      },
      {
        label: 'Decline',
        hint: '+professionalism',
        auto: 1.5,
        apply: (s) => {
          fx(s, { prof: 1 });
          return 'Not your scene. Maybe next time.';
        },
      },
    ],
  },
  {
    id: 'brand_controversy',
    category: 'money',
    trigger: 'weekly',
    condition: (s) => s.life.sponsors.length > 0,
    weight: () => 0.04,
    cooldown: 120,
    prepare: (s, rng) => (s.life.sponsors.length ? { brand: rng.pick(s.life.sponsors).brand } : null),
    title: () => 'Sponsor request',
    text: (_s, c) => `${c.brand} want you to post an ad mocking a rival club's fans. "Edgy content performs," says their marketing team.`,
    choices: [
      {
        label: 'Post it',
        hint: '+money · −reputation',
        auto: 0.4,
        apply: (s) => {
          fx(s, { money: 3000, moneyLabel: 'Sponsor bonus', repLocal: -2, repNat: -1.5, followers: 0.02 });
          return 'The ad goes viral — for the wrong reasons.';
        },
      },
      {
        label: 'Refuse',
        hint: '−sponsor relationship',
        auto: 2,
        apply: (s, c) => {
          const deal = s.life.sponsors.find((d) => d.brand === c.brand);
          if (deal) deal.monthly = Math.round(deal.monthly * 0.9);
          fx(s, { prof: 1 });
          return 'They grumble and cut your fee slightly. Your integrity is intact.';
        },
      },
    ],
  },

  // ------------------------------------------------------------ family & friends
  {
    id: 'family_emergency',
    category: 'family',
    trigger: 'morning',
    condition: (s) => s.life.people.some((p) => p.role === 'father' && !p.gone),
    weight: () => 0.0025,
    cooldown: 400,
    title: () => 'Bad news from home',
    text: (s) => `Your mum calls in tears: your dad has been taken to hospital in ${city(s, s.life.hometown).name}. It is serious but stable.`,
    choices: [
      {
        label: 'Go home immediately',
        hint: '++family · miss training',
        auto: 2,
        apply: (s) => {
          fx(s, { family: 15, morale: -4, energy: -10, money: -Math.round(200 * city(s, s.life.cityId).cost), moneyLabel: 'Travel home' });
          s.user.attendance = clamp(s.user.attendance - 0.1, 0, 1);
          fx(s, { coach: hasTrait(s.user, 'family') ? 0 : -1 });
          return 'You spend two days at his bedside. He will be fine. The club understood.';
        },
      },
      {
        label: 'Pay for the best private care',
        hint: '+family · costs money',
        available: (s) => (s.life.money > 5000 ? true : 'Not enough money'),
        auto: 1,
        apply: (s) => {
          fx(s, { family: 8, money: -5000, moneyLabel: 'Private hospital care', morale: -2 });
          return 'The best specialists in the country look after him.';
        },
      },
      {
        label: 'Call and stay focused',
        hint: '−family',
        auto: 0.3,
        apply: (s) => {
          fx(s, { family: -8, morale: -6 });
          return 'You call every day. It does not feel like enough.';
        },
      },
    ],
  },
  {
    id: 'homesick',
    category: 'family',
    trigger: 'evening',
    condition: (s) => s.life.cityId !== s.life.hometown && (userAge(s) < 20 || hasTrait(s.user, 'family')) && s.life.happiness.family < 60,
    weight: () => 0.03,
    cooldown: 50,
    title: () => 'Homesick',
    text: (s) => `It is raining in ${cityName(s)}, your flat is quiet, and all you can think about is home.`,
    choices: [
      {
        label: 'Video call the family',
        hint: '+family',
        auto: 2,
        apply: (s) => {
          fx(s, { family: 6, morale: 2 });
          return 'Your little sister shows you her drawings. You laugh for the first time in days.';
        },
      },
      {
        label: 'Fly them over for a weekend',
        hint: '++family · costs money',
        available: (s) => (s.life.money > 800 ? true : 'Not enough money'),
        auto: 1,
        apply: (s) => {
          fx(s, { family: 15, morale: 6, money: -Math.round(600 * city(s, s.life.cityId).cost), moneyLabel: 'Family visit' });
          return 'They watch you play on Saturday. Mum cries.';
        },
      },
      {
        label: 'Push through it',
        hint: '−morale',
        auto: 0.3,
        apply: (s) => {
          fx(s, { morale: -4 });
          return 'You go to bed early. It will pass.';
        },
      },
    ],
  },
  {
    id: 'parents_advice',
    category: 'family',
    trigger: 'weekly',
    condition: (s) => userAge(s) < 19 && s.user.professionalism < 45,
    weight: () => 0.15,
    cooldown: 60,
    title: () => 'A word from dad',
    text: () => 'Your dad calls: "Your coach phoned us. He says you are not taking this seriously. Is that true?"',
    choices: [
      {
        label: '"You are right. I will do better."',
        hint: '+professionalism, +family',
        auto: 2,
        apply: (s) => {
          fx(s, { prof: 5, family: 4 });
          return 'He sounds relieved. You feel twelve years old again.';
        },
      },
      {
        label: '"Stay out of my career."',
        hint: '−family',
        auto: 0.4,
        apply: (s) => {
          fx(s, { family: -10, morale: -2 });
          return 'He goes quiet and hangs up.';
        },
      },
    ],
  },
  {
    id: 'birthday',
    category: 'life',
    trigger: 'morning',
    condition: (s) => {
      const b = new Date(s.user.born * 86400000);
      const t = new Date(s.day * 86400000);
      return b.getUTCMonth() === t.getUTCMonth() && b.getUTCDate() === t.getUTCDate();
    },
    weight: () => 1,
    cooldown: 300,
    title: (s) => `Happy ${Math.floor(userAge(s))}th birthday!`,
    text: (s) => `You are ${Math.floor(userAge(s))} today. Messages pour in from family, friends and teammates.`,
    choices: [
      {
        label: 'Party with friends and teammates',
        hint: '+social, +teammates · tired tomorrow',
        available: (s) => (userAge(s) >= 17 ? true : 'Maybe when you are older'),
        auto: 1,
        apply: (s) => {
          fx(s, { social: 15, teammates: 4, morale: 5, energy: -10, sleep: 0.7, money: -Math.round(300 * city(s, s.life.cityId).cost), moneyLabel: 'Birthday party' });
          return 'A great night. Your teammates sang badly.';
        },
      },
      {
        label: 'Dinner with family',
        hint: '+family',
        auto: 1.5,
        apply: (s) => {
          fx(s, { family: 10, morale: 5 });
          return 'Mum made your favourite cake. Some things never change.';
        },
      },
      {
        label: 'Just another training day',
        hint: '+professionalism',
        auto: 0.5,
        apply: (s) => {
          fx(s, { prof: 2, morale: 1 });
          return 'Birthday or not, you put in the work.';
        },
      },
    ],
  },
  {
    id: 'friend_needs_help',
    category: 'social',
    trigger: 'evening',
    condition: (s) => peopleOf(s, 'friend').some((p) => p.affinity > 55),
    weight: () => 0.015,
    cooldown: 90,
    prepare: (s, rng) => {
      const list = peopleOf(s, 'friend').filter((p) => p.affinity > 55);
      const p = rng.pick(list);
      return { name: p.first, id: p.id, need: rng.pick(['lost his job', 'broke up with his girlfriend', 'needs money for rent', 'is going through a rough patch']) };
    },
    title: () => 'A friend in need',
    text: (_s, c) => `Your old friend ${c.name} ${c.need} and calls you late at night.`,
    choices: [
      {
        label: 'Be there for him',
        hint: '++friendship · −energy',
        auto: 2,
        apply: (s, c) => {
          const p = s.life.people.find((x) => x.id === c.id);
          if (p) p.affinity = clamp(p.affinity + 15, 0, 100);
          fx(s, { energy: -8, social: 4, sleep: 0.85 });
          return 'You talk until 1am. That is what friends are for.';
        },
      },
      {
        label: 'Lend him money',
        hint: '+friendship · costs money',
        available: (s) => (s.life.money > 2000 ? true : 'Not enough money'),
        auto: 1,
        apply: (s, c) => {
          const p = s.life.people.find((x) => x.id === c.id);
          if (p) p.affinity = clamp(p.affinity + 10, 0, 100);
          fx(s, { money: -2000, moneyLabel: `Loan to ${c.name}` });
          return 'He promises to pay you back. You will see.';
        },
      },
      {
        label: 'Not now, you need sleep',
        hint: '−friendship',
        auto: 0.4,
        apply: (s, c) => {
          const p = s.life.people.find((x) => x.id === c.id);
          if (p) p.affinity = clamp(p.affinity - 10, 0, 100);
          return 'He says he understands. He does not.';
        },
      },
    ],
  },
  {
    id: 'charity_request',
    category: 'social',
    trigger: 'weekly',
    condition: (s) => s.user.rep.local > 10,
    weight: () => 0.06,
    cooldown: 90,
    title: () => 'A letter from a hospital',
    text: (s) => `The children's ward at ${cityName(s)} General asks whether you could visit, or support their appeal.`,
    choices: [
      {
        label: 'Visit the ward',
        hint: '+local reputation, +morale',
        auto: 2,
        apply: (s) => {
          fx(s, { repLocal: 3, morale: 4, energy: -5 });
          s.life.charity.points += 3;
          return 'You leave with a drawing of you scoring a bicycle kick.';
        },
      },
      {
        label: 'Donate',
        hint: '+reputation · costs money',
        available: (s) => (s.life.money > 1500 ? true : 'Not enough money'),
        auto: 1,
        apply: (s) => {
          const amount = Math.round(Math.max(1000, s.life.money * 0.02));
          fx(s, { money: -amount, moneyLabel: 'Hospital donation', repLocal: 2 });
          s.life.charity.donated += amount;
          s.life.charity.points += 2;
          return `${formatMoney(s, amount)} for new equipment. The nurses send a thank-you card.`;
        },
      },
      {
        label: 'Politely decline',
        auto: 0.3,
        apply: () => 'You are busy. Maybe another time.',
      },
    ],
  },

  // ------------------------------------------------------------ romance (optional, tasteful)
  {
    id: 'romance_meet',
    category: 'romance',
    trigger: 'queued',
    condition: (s) => !partner(s),
    prepare: (_s, rng) => ({ place: rng.pick(['at the bar', 'in the queue', 'at a friend\'s table', 'on the dance floor', 'at the quiz']) }),
    title: () => 'Someone catches your eye',
    text: (_s, c) => `You get talking to someone ${c.place}. Funny, smart, and they have no idea who you are — which is refreshing.`,
    choices: [
      {
        label: 'Ask them out',
        hint: 'start dating',
        auto: 1.5,
        apply: (s, _c, rng) => {
          if (rng.chance(0.7)) {
            const p = startDating(s, rng);
            return `${p.first} says yes. Dinner on Thursday?`;
          }
          fx(s, { morale: -2 });
          return 'They are flattered but not interested. Ouch.';
        },
      },
      {
        label: 'Swap numbers, play it cool',
        auto: 1,
        apply: (s, _c, rng) => {
          if (rng.chance(0.5)) s.events.queue.push({ defId: 'romance_meet', day: s.day + rng.int(3, 10), ctx: { place: 'on a message thread' } });
          return 'You will see where it goes.';
        },
      },
      {
        label: 'Focus on football',
        auto: 0.5,
        apply: (s) => {
          fx(s, { prof: 1 });
          return 'Not the time for romance.';
        },
      },
    ],
  },
  {
    id: 'become_partners',
    category: 'romance',
    trigger: 'weekly',
    condition: (s) => {
      const p = partner(s);
      return !!p && p.stage === 'dating' && p.affinity >= 70 && s.day - p.since > 25;
    },
    weight: () => 0.5,
    title: () => 'Making it official',
    text: (s) => `${partner(s)?.first ?? 'Your date'} asks: "So… what are we?"`,
    choices: [
      {
        label: '"You are my partner."',
        hint: '+romance',
        auto: 2,
        apply: (s) => {
          const p = partner(s);
          if (!p) return 'The moment passed.';
          p.stage = 'partner';
          p.since = s.day;
          fx(s, { romance: 12, morale: 5 });
          addPost(s, { author: fullName(s.user), handle: `@${s.user.first.toLowerCase()}${s.user.last.toLowerCase()}`, text: '❤️', likes: Math.round(s.user.followers * 0.15), kind: 'self', mood: 1 });
          return 'Relationship status: taken.';
        },
      },
      {
        label: '"Let us keep it casual."',
        hint: '−romance',
        auto: 0.5,
        apply: (s) => {
          fx(s, { partner: -12 });
          return 'An awkward silence. Then a change of subject.';
        },
      },
    ],
  },
  {
    id: 'partner_neglected',
    category: 'romance',
    trigger: 'evening',
    condition: (s) => {
      const p = partner(s);
      return !!p && p.affinity < 40;
    },
    weight: () => 0.12,
    cooldown: 25,
    title: () => 'Feeling neglected',
    text: (s) => `${partner(s)?.first ?? 'Your partner'}: "You are always training, travelling or on your phone. Do you even have time for us?"`,
    choices: [
      {
        label: 'Plan a special weekend',
        hint: '++romance · costs money and energy',
        available: (s) => (s.life.money > 1000 ? true : 'Not enough money'),
        auto: 2,
        apply: (s) => {
          fx(s, { partner: 20, romance: 8, money: -Math.round(900 * city(s, s.life.cityId).cost), moneyLabel: 'Weekend away', energy: -5 });
          return 'A weekend away by the sea. You both needed it.';
        },
      },
      {
        label: 'Promise to make more time',
        hint: '+romance (for now)',
        auto: 1,
        apply: (s) => {
          fx(s, { partner: 8 });
          return 'Words are easy. Now keep the promise.';
        },
      },
      {
        label: '"Football comes first right now."',
        hint: '−−romance',
        auto: 0.3,
        apply: (s) => {
          fx(s, { partner: -15, romance: -8 });
          const p = partner(s);
          if (p && p.affinity < 15) s.events.queue.push({ defId: 'breakup', day: s.day + 3, ctx: {} });
          return 'The door closes a little harder than usual.';
        },
      },
    ],
  },
  {
    id: 'breakup',
    category: 'romance',
    trigger: 'evening',
    condition: (s) => {
      const p = partner(s);
      return !!p && p.affinity < 12;
    },
    weight: () => 0.3,
    cooldown: 20,
    title: () => 'It is over',
    text: (s) => `${partner(s)?.first ?? 'Your partner'} sits you down. "I cannot do this anymore. I am sorry."`,
    choices: [
      {
        label: 'Accept it',
        hint: '−morale, −romance',
        auto: 2,
        apply: (s) => {
          breakUp(s);
          return 'It hurts. Your friends rally round.';
        },
      },
      {
        label: 'Ask for one more chance',
        hint: 'maybe',
        auto: 1,
        apply: (s, _c, rng) => {
          if (rng.chance(0.4)) {
            fx(s, { partner: 25 });
            return 'After a long talk, you agree to try again.';
          }
          breakUp(s);
          return 'Their mind is made up.';
        },
      },
    ],
  },
  {
    id: 'move_in',
    category: 'romance',
    trigger: 'weekly',
    condition: (s) => {
      const p = partner(s);
      return !!p && p.stage === 'partner' && p.affinity >= 75 && s.day - p.since > 150 && ['apartment', 'house', 'villa'].includes(s.life.housing.kind);
    },
    weight: () => 0.3,
    title: () => 'Moving in?',
    text: (s) => `${partner(s)?.first ?? 'Your partner'} already has a toothbrush at yours. "Should we just… live together?"`,
    choices: [
      {
        label: 'Yes!',
        hint: '+romance, +home',
        auto: 2,
        apply: (s) => {
          const p = partner(s);
          if (!p) return 'The moment passed.';
          p.stage = 'living';
          p.since = s.day;
          fx(s, { romance: 10, home: 10, morale: 4 });
          return 'Boxes everywhere, and it feels like home.';
        },
      },
      {
        label: 'Not yet',
        hint: '−romance',
        auto: 0.5,
        apply: (s) => {
          fx(s, { partner: -8 });
          return '"OK. No pressure." There is a little pressure.';
        },
      },
    ],
  },
  {
    id: 'proposal',
    category: 'romance',
    trigger: 'weekly',
    condition: (s) => {
      const p = partner(s);
      return !!p && p.stage === 'living' && p.affinity >= 82 && s.day - p.since > 300;
    },
    weight: () => 0.2,
    title: () => 'The ring',
    text: (s) => `You have been together a long time and ${partner(s)?.first ?? 'your partner'} is the one. Your mum keeps dropping hints.`,
    choices: [
      {
        label: 'Propose',
        hint: 'engagement · costs a ring',
        available: (s) => (s.life.money > 5000 ? true : 'Save up for a ring first'),
        auto: 2,
        apply: (s, _c, rng) => {
          const ring = Math.round(Math.max(5000, s.life.money * 0.03));
          const p = partner(s);
          if (!p) return 'The moment passed.';
          fx(s, { money: -ring, moneyLabel: 'Engagement ring' });
          if (rng.chance(0.9)) {
            p.stage = 'engaged';
            p.since = s.day;
            fx(s, { romance: 15, family: 8, morale: 8, followers: 0.03 });
            s.events.queue.push({ defId: 'wedding', day: s.day + rng.int(150, 260), ctx: {} });
            return 'They say YES!';
          }
          fx(s, { partner: -20, morale: -10 });
          return '"I need more time." Not the answer you hoped for.';
        },
      },
      {
        label: 'Not yet',
        auto: 0.8,
        apply: () => 'There is no rush.',
      },
    ],
  },
  {
    id: 'wedding',
    category: 'romance',
    trigger: 'queued',
    condition: (s) => partner(s)?.stage === 'engaged',
    title: () => 'The big day',
    text: (s) => `The wedding with ${partner(s)?.first ?? 'your partner'} is coming up. How big do you want it?`,
    choices: [
      {
        label: 'A huge celebration',
        hint: '++followers, +family · very expensive',
        available: (s) => (s.life.money > 60000 ? true : 'Not enough money'),
        auto: 1,
        apply: (s) => {
          fx(s, { money: -60000, moneyLabel: 'Wedding', romance: 20, family: 12, followers: 0.08, morale: 10 });
          const p = partner(s);
          if (p) p.stage = 'married';
          addNotice(s, 'Just married! 💍', 'gold');
          return 'A day you will never forget. The photos are everywhere.';
        },
      },
      {
        label: 'Small ceremony with family',
        hint: '+romance, +family',
        auto: 2,
        apply: (s) => {
          fx(s, { money: -8000, moneyLabel: 'Wedding', romance: 18, family: 15, morale: 10 });
          const p = partner(s);
          if (p) p.stage = 'married';
          addNotice(s, 'Just married! 💍', 'gold');
          return 'Intimate, emotional and perfect.';
        },
      },
    ],
  },

  // ------------------------------------------------------------ health
  {
    id: 'injury_scare',
    category: 'health',
    trigger: 'morning',
    condition: (s) => !s.user.injury && s.user.energy < 45 && isSeason(s),
    weight: () => 0.06,
    cooldown: 30,
    title: () => 'A tight hamstring',
    text: () => 'In the warm-up your hamstring feels tight. Probably nothing… probably.',
    choices: [
      {
        label: 'Tell the physio and sit out',
        hint: 'miss today\'s session, avoid the risk',
        auto: 2,
        apply: (s) => {
          s.events.flags.skipTrainingDay = s.day;
          fx(s, { energy: 8, coach: -1 });
          return 'Ice, massage and a day of rest. It settles down.';
        },
      },
      {
        label: 'Train through it',
        hint: 'risky',
        auto: 0.6,
        apply: (s, _c, rng) => {
          if (rng.chance(0.3)) {
            startUserInjury(s, rng, 'training');
            return 'Twenty minutes in, it goes. You knew it.';
          }
          fx(s, { coach: 1, prof: 1 });
          return 'It loosens up. Close call.';
        },
      },
      {
        label: 'Pay for a sports massage',
        hint: 'costs money, reduces the risk',
        available: (s) => (s.life.money > 150 ? true : 'Not enough money'),
        auto: 1,
        apply: (s) => {
          fx(s, { money: -Math.round(120 * city(s, s.life.cityId).cost), moneyLabel: 'Sports massage', fitness: 1, energy: 5 });
          return 'Magic hands. Good as new.';
        },
      },
    ],
  },
  {
    id: 'rehab_choice',
    category: 'health',
    trigger: 'queued',
    condition: (s) => !!s.user.injury && s.user.injury.rehab === null,
    title: (s) => `Rehab plan: ${s.user.injury?.name ?? 'injury'}`,
    text: (s, c) => `The medical team estimate ${c.days} days out. How do you want to approach the recovery?`,
    choices: [
      {
        label: 'Standard rehab',
        hint: 'normal recovery time',
        auto: 2,
        apply: (s) => {
          applyRehabChoice(s, 'standard');
          return 'Patience. You follow the physios\' plan to the letter.';
        },
      },
      {
        label: 'Push to return early',
        hint: '~25% faster · risk of breaking down again',
        auto: 0.6,
        apply: (s) => {
          applyRehabChoice(s, 'aggressive');
          fx(s, { coach: 2 });
          return 'Double sessions and painkillers. You will be back sooner — hopefully in one piece.';
        },
      },
      {
        label: 'Private specialist',
        hint: '~20% faster and safer · costs money',
        available: (s) => (s.life.money >= specialistCost(s) ? true : `Costs ${formatMoney(s, specialistCost(s))}`),
        auto: 1,
        apply: (s) => {
          fx(s, { money: -specialistCost(s), moneyLabel: 'Private specialist' });
          applyRehabChoice(s, 'specialist');
          return 'A world-class clinic takes over your recovery.';
        },
      },
    ],
  },

  // ------------------------------------------------------------ education
  {
    id: 'school_exams',
    category: 'life',
    trigger: 'weekly',
    condition: (s) => !s.life.school.graduated && userAge(s) < 17.6 && [5, 6].includes(new Date(s.day * 86400000).getUTCMonth() + 1),
    weight: () => 0.35,
    cooldown: 300,
    title: () => 'Exam week',
    text: () => 'Final exams are next week. Your mum has printed a revision timetable and put it on the fridge.',
    choices: [
      {
        label: 'Revise properly',
        hint: '+family, +school · less extra training',
        auto: 2,
        apply: (s) => {
          s.life.school.attended += 15;
          fx(s, { family: 8, energy: -5, prof: 1 });
          return 'Long evenings with textbooks. You feel prepared.';
        },
      },
      {
        label: 'Wing it — football is your future',
        hint: 'risk failing',
        auto: 0.6,
        apply: (s, _c, rng) => {
          if (rng.chance(0.5)) {
            s.life.school.missed += 20;
            fx(s, { family: -8 });
            return 'The results are… not great. Your parents are disappointed.';
          }
          return 'Somehow you scrape through.';
        },
      },
    ],
  },
  {
    id: 'language_barrier',
    category: 'life',
    trigger: 'weekly',
    condition: (s) => {
      const c = club(s, s.user.clubId);
      return !!c && c.countryKey !== s.user.nat && !s.life.education.completed.includes('language') && s.life.education.enrolled !== 'language';
    },
    weight: () => 0.12,
    cooldown: 60,
    title: () => 'Lost in translation',
    text: (s) => `The lads joke in ${s.world.countries.find((c) => c.key === club(s, s.user.clubId)?.countryKey)?.language ?? 'the local language'} and you miss most of it. The coach's instructions too.`,
    choices: [
      {
        label: 'Enrol in a language course',
        hint: 'settle in faster (College)',
        auto: 2,
        apply: (s) => {
          const r = enrollCourse(s, 'language');
          return r ?? 'You start lessons next week. "Hola / Hallo / Olá…"';
        },
      },
      {
        label: 'Laugh along, you will pick it up',
        hint: '−home happiness',
        auto: 1,
        apply: (s) => {
          fx(s, { home: -4 });
          return 'Nodding and smiling works. Mostly.';
        },
      },
    ],
  },
  {
    id: 'coaching_badge_offer',
    category: 'career',
    trigger: 'weekly',
    condition: (s) => userAge(s) >= 24 && !s.life.education.completed.includes('coach_c') && !s.life.education.enrolled,
    weight: () => 0.04,
    cooldown: 365,
    title: () => 'Thinking about the future',
    text: () => 'The federation runs coaching courses for professional players. "Start your badges now and you will be ready when you hang up your boots."',
    choices: [
      {
        label: 'Enrol in Licence C',
        hint: 'opens coaching careers after retirement',
        auto: 1.5,
        apply: (s) => enrollCourse(s, 'coach_c') ?? 'You are enrolled. Study sessions at the College.',
      },
      {
        label: 'Maybe later',
        auto: 1,
        apply: () => 'You file the brochure away.',
      },
    ],
  },

  // ------------------------------------------------------------ money
  {
    id: 'investment_pitch',
    category: 'money',
    trigger: 'weekly',
    condition: (s) => s.life.money > 60000,
    weight: () => 0.05,
    cooldown: 180,
    prepare: (s, rng) => {
      const f = peopleOf(s, 'friend')[0];
      return { name: f?.first ?? 'An old classmate', idea: rng.pick(['a sports nutrition app', 'a padel club', 'a streetwear label', 'a coffee chain', 'football-boot recycling']) };
    },
    title: () => 'A business idea',
    text: (s, c) => `${c.name} pitches ${c.idea} and asks you to invest ${formatMoney(s, 20000)}. "It cannot fail!"`,
    choices: [
      {
        label: `Invest`,
        hint: 'high risk, high reward',
        auto: 0.6,
        apply: (s, c) => {
          invest(s, 'startup', 20000);
          const p = s.life.people.find((x) => x.first === c.name);
          if (p) p.affinity = clamp(p.affinity + 10, 0, 100);
          return 'You are officially an investor. Fingers crossed.';
        },
      },
      {
        label: 'Decline politely',
        auto: 1.5,
        apply: () => 'Friendship and money do not mix.',
      },
    ],
  },
  {
    id: 'car_temptation',
    category: 'money',
    trigger: 'weekly',
    condition: (s) => s.life.money > 250000 && userAge(s) >= 18 && ['bus', 'bike', 'used_car', 'car'].includes(s.life.transport),
    weight: () => 0.08,
    cooldown: 200,
    title: () => 'Dream car',
    text: () => 'A dealership invites you to test drive the new sports car. The salesman already knows your shirt number.',
    choices: [
      {
        label: 'Buy it',
        hint: '+status, +followers · costs a lot',
        auto: 0.7,
        apply: (s) => buyTransport(s, 'sports_car') ?? `You drive home in a ${TRANSPORT.find((t) => t.kind === 'sports_car')!.name.toLowerCase()}.`,
      },
      {
        label: 'Just a test drive',
        hint: '+morale',
        auto: 1.5,
        apply: (s) => {
          fx(s, { morale: 3 });
          return 'Fun for twenty minutes. Your bank account thanks you.';
        },
      },
    ],
  },

  // ------------------------------------------------------------ national team
  {
    id: 'club_vs_country',
    category: 'national',
    trigger: 'weekly',
    condition: (s) => s.user.national !== 'none' && hasClub(s) && s.user.energy < 60,
    weight: () => 0.05,
    cooldown: 150,
    title: () => 'Club versus country',
    text: (s) => `${coachName(s)} hints that he would prefer you to "feel a little knock" and skip the upcoming internationals.`,
    choices: [
      {
        label: 'Play for your country',
        hint: '+national reputation · −coach',
        auto: 2,
        apply: (s) => {
          fx(s, { repNat: 2, coach: -4 });
          return `Nothing beats wearing the ${nationName(s.user.nat)} shirt.`;
        },
      },
      {
        label: 'Withdraw from the squad',
        hint: '+coach, +energy · the federation may not call again',
        auto: 0.5,
        apply: (s) => {
          fx(s, { coach: 6, energy: 10, repNat: -3 });
          s.user.national = 'none';
          s.fixtures = s.fixtures.filter((f) => !(f.national && !f.played && f.day > s.day && s.nationalTeams.some((t) => (t.id === f.home || t.id === f.away) && t.nation === s.user.nat)));
          return 'The federation is not pleased.';
        },
      },
    ],
  },

  // ------------------------------------------------------------ the summer
  {
    id: 'holiday',
    category: 'life',
    trigger: 'morning',
    condition: (s) => {
      const t = new Date(s.day * 86400000);
      return t.getUTCMonth() + 1 === 6 && t.getUTCDate() >= 3 && !s.life.vacation && !s.fixtures.some((f) => !f.played && f.day >= s.day && f.national && s.nationalTeams.some((n) => (n.id === f.home || n.id === f.away) && n.nation === s.user.nat));
    },
    weight: () => 1,
    cooldown: 200,
    title: () => 'Summer break',
    text: () => 'The season is over. You have a few weeks off before pre-season. Where to?',
    choices: [
      {
        label: 'Beach resort',
        hint: '++morale, rest · −fitness, costs money',
        available: (s) => (s.life.money > 3000 ? true : 'Not enough money'),
        auto: 1.5,
        apply: (s) => {
          s.life.vacation = { until: s.day + 14, place: 'a beach resort' };
          fx(s, { money: -Math.round(3000 + s.user.contract.wage * 0.5), moneyLabel: 'Holiday', morale: 10, social: 8, romance: 8, fitness: -6 });
          return 'Two weeks of sun. Your agent says to keep your phone off.';
        },
      },
      {
        label: 'Back home with family',
        hint: '++family, cheap',
        auto: 1.5,
        apply: (s) => {
          s.life.vacation = { until: s.day + 14, place: 'home' };
          fx(s, { family: 18, morale: 6, fitness: -4, money: -400, moneyLabel: 'Travel home' });
          return 'Mum\'s cooking, old friends and your childhood bed.';
        },
      },
      {
        label: 'City trip with friends',
        hint: '++social',
        available: (s) => (s.life.money > 1500 ? true : 'Not enough money'),
        auto: 1,
        apply: (s) => {
          s.life.vacation = { until: s.day + 10, place: 'a city trip' };
          fx(s, { money: -1500, moneyLabel: 'City trip', social: 18, morale: 7, fitness: -5 });
          return 'Museums, rooftop bars and too many photos.';
        },
      },
      {
        label: 'Private training camp',
        hint: '+fitness, head start on pre-season · −morale',
        available: (s) => (s.life.money > 2500 ? true : 'Not enough money'),
        auto: (s) => (hasTrait(s.user, 'professional') ? 2 : 0.8),
        apply: (s) => {
          s.life.vacation = { until: s.day + 12, place: 'a training camp' };
          fx(s, { money: -2500, moneyLabel: 'Training camp', fitness: 8, morale: -2, prof: 3 });
          s.user.sharpness = clamp(s.user.sharpness + 10, 0, 100);
          return 'Altitude, sprints and ice baths. You will arrive at pre-season flying.';
        },
      },
    ],
  },
];

/** debugging / tests: all ids are unique */
export function eventIds(): string[] {
  return EVENT_DEFS.map((d) => d.id);
}

export type { EventCtx };
void COURSES;
void weekday;
void userOvr;
