// Season rollover (July 1st): the user's season record, trophies and awards, world history
// (champions, top scorers, players of the season), promotion and relegation, continental
// qualification, club reputation and finances, coach changes, contracts, the NPC summer market,
// and the new season's competitions.

import { continentalCompId, createSeason, cupCompId, leagueCompId, standings, teamName } from './competitions';
import { dayOf, formatDate } from './dates';
import { fullName, potentialOvr, refreshMarketValue, statsCopy, userAge, userOvr } from './footballer';
import { club, comp, fixturesOf, getIndex, invalidateSquads, npc } from './index';
import { refreshClubPeople } from './life';
import { addMessage, addNotice, addTimeline } from './messages';
import { refreshNationalStrengths, tournamentName } from './national';
import { avgRating, emptyLine, npcName } from './players';
import { Rng, clamp } from './rng';
import { makeCoach } from './world';
import { npcSummerMarket, seasonEndContracts } from './contracts';
import type { CareerState, Id, SeasonRecord } from './types';

export interface SeasonAward {
  name: string;
  winner: string;
  club: string;
  user: boolean;
  value?: string;
}

/** awards of the user's league (or any league) based on season stats */
export function leagueAwards(state: CareerState, leagueId: Id): SeasonAward[] {
  const lg = state.world.leagues[leagueId];
  const clubs = new Set(lg.clubIds);
  const idx = getIndex(state);
  const players = state.world.npcs.filter((n) => clubs.has(n.clubId) && n.squad === 'first');
  const u = state.user;
  const userHere = clubs.has(u.clubId);
  // NPC season lines count every competitive club match: compare like with like
  const ul = sumLines([u.season.league, u.season.cup, u.season.continental]);
  const awards: SeasonAward[] = [];
  // top scorer
  let best = players.reduce((m, n) => (n.season.goals > (m?.season.goals ?? -1) ? n : m), players[0]);
  if (userHere && ul.goals > (best?.season.goals ?? 0)) awards.push({ name: 'Golden Boot', winner: fullName(u), club: club(state, u.clubId)!.name, user: true, value: `${ul.goals} goals` });
  else if (best) awards.push({ name: 'Golden Boot', winner: npcName(best), club: club(state, best.clubId)!.name, user: false, value: `${best.season.goals} goals` });
  // player of the season: best average rating with enough games
  const minApps = Math.round(lg.clubIds.length * 2 * 0.55);
  const eligible = players.filter((n) => n.season.apps >= minApps);
  best = eligible.reduce((m, n) => (avgRating(n.season) + n.season.goals * 0.02 > (m ? avgRating(m.season) + m.season.goals * 0.02 : 0) ? n : m), eligible[0]);
  const userScore = ul.apps >= minApps ? avgRating(ul) + ul.goals * 0.02 : 0;
  if (userHere && userScore > (best ? avgRating(best.season) + best.season.goals * 0.02 : 0)) awards.push({ name: 'Player of the Season', winner: fullName(u), club: club(state, u.clubId)!.name, user: true, value: avgRating(ul).toFixed(2) });
  else if (best) awards.push({ name: 'Player of the Season', winner: npcName(best), club: club(state, best.clubId)!.name, user: false, value: avgRating(best.season).toFixed(2) });
  // young player of the season (<= 21)
  const young = eligible.filter((n) => (state.day - n.born) / 365.25 <= 21.9);
  best = young.reduce((m, n) => (avgRating(n.season) > (m ? avgRating(m.season) : 0) ? n : m), young[0]);
  if (userHere && userAge(state) <= 21.9 && ul.apps >= minApps * 0.7 && avgRating(ul) > (best ? avgRating(best.season) : 0)) awards.push({ name: 'Young Player of the Season', winner: fullName(u), club: club(state, u.clubId)!.name, user: true, value: avgRating(ul).toFixed(2) });
  else if (best) awards.push({ name: 'Young Player of the Season', winner: npcName(best), club: club(state, best.clubId)!.name, user: false, value: avgRating(best.season).toFixed(2) });
  void idx;
  return awards;
}

function sumLines(a: ReturnType<typeof emptyLine>[]): ReturnType<typeof emptyLine> {
  const out = emptyLine();
  for (const l of a) for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] += l[k];
  return out;
}

/** called on July 1st: closes season `state.season` and opens the next */
export function rolloverSeason(state: CareerState, rng: Rng): void {
  const season = state.season;
  const u = state.user;
  const userClub = club(state, u.clubId);
  const trophies: string[] = [];
  const awards: string[] = [];
  const played = sumLines([u.season.league, u.season.cup, u.season.continental]).apps;

  // --- world history & trophies
  const champions: { comp: string; club: string }[] = [];
  for (const lg of state.world.leagues) {
    const table = standings(state, leagueCompId(lg.id, season));
    if (table.length === 0) continue;
    const winner = table[0].clubId;
    champions.push({ comp: lg.name, club: state.world.clubs[winner].name });
    if (lg.tier === 1) state.world.clubs[winner].reputation = clamp(state.world.clubs[winner].reputation + 2, 0, 99);
    if (winner === u.clubId && u.season.league.apps >= 5) trophies.push(`${lg.name} champion`);
  }
  for (const c of state.comps) {
    if ((c.type === 'cup' || c.type === 'continental' || c.id.startsWith('TOUR-')) && c.winnerId !== null && c.winnerId !== undefined) {
      champions.push({ comp: c.name, club: teamName(state, c.winnerId) });
      const userWon = c.id.startsWith('TOUR-') ? state.nationalTeams.some((t) => t.id === c.winnerId && t.nation === u.nat) && u.national === 'senior' : c.winnerId === u.clubId && (c.type === 'cup' ? u.season.cup.apps : u.season.continental.apps) > 0;
      if (userWon) trophies.push(c.name);
    }
  }
  const leagueId = userClub?.leagueId;
  let leaguePos = 0;
  let topScorer: { name: string; club: string; goals: number } | undefined;
  let pots: { name: string; club: string } | undefined;
  let finalTable: [string, number, number, number][] | undefined;
  if (leagueId !== undefined) {
    const table = standings(state, leagueCompId(leagueId, season));
    leaguePos = table.findIndex((r) => r.clubId === u.clubId) + 1;
    finalTable = table.map((r) => [state.world.clubs[r.clubId].name, r.p, r.gf - r.ga, r.pts]);
    for (const a of leagueAwards(state, leagueId)) {
      if (a.user) awards.push(a.name);
      if (a.name === 'Golden Boot') topScorer = { name: a.winner, club: a.club, goals: parseInt(a.value ?? '0', 10) };
      if (a.name === 'Player of the Season') pots = { name: a.winner, club: a.club };
    }
  }
  // continental / world awards for the very best
  if (u.rep.world > 70 && avgRating(u.season.league) > 7.4 && u.season.league.apps > 20) awards.push('World Player of the Year nominee');
  state.history.unshift({ season, champions, topScorer, playerOfSeason: pots });
  if (state.history.length > 40) state.history.length = 40;

  // --- the user's season record
  const record: SeasonRecord = {
    season,
    clubId: u.clubId,
    clubName: userClub?.name ?? 'Free agent',
    leagueName: leagueId !== undefined ? state.world.leagues[leagueId].name : '—',
    leaguePos,
    squad: u.squad,
    league: { ...u.season.league },
    cup: { ...u.season.cup },
    continental: { ...u.season.continental },
    youth: { ...u.season.youth },
    international: { ...u.season.international },
    ovrStart: Math.round(ovrOfStats(state, u.seasonStartStats)),
    ovrEnd: Math.round(userOvr(u)),
    wage: u.contract.wage,
    value: u.marketValue,
    trophies,
    awards,
    loan: u.contract.kind === 'loan',
    table: finalTable,
  };
  u.history.push(record);
  for (const t of trophies) u.trophies.push({ season, name: t, clubName: t.includes('Championship') ? teamName(state, state.nationalTeams.find((n) => n.nation === u.nat && n.level === 'senior')!.id) : userClub?.name ?? '' });
  for (const a of awards) u.awards.push({ season, name: a });
  if (trophies.length) {
    addNotice(state, `Trophies this season: ${trophies.join(', ')}`, 'gold');
    u.rep.national = clamp(u.rep.national + trophies.length * 3, 0, 100);
    u.rep.world = clamp(u.rep.world + trophies.length * 1.5, 0, 100);
  }
  for (const a of awards) {
    addNotice(state, `Award: ${a}!`, 'gold');
    u.rep.national = clamp(u.rep.national + 5, 0, 100);
    u.rep.world = clamp(u.rep.world + 3, 0, 100);
  }

  // --- promotion / relegation and continental qualification
  const qualified: Id[] = [];
  const thirds: Id[] = [];
  for (const country of state.world.countries) {
    const [topId, secondId] = country.leagueIds;
    const top = state.world.leagues[topId];
    const second = state.world.leagues[secondId];
    const topTable = standings(state, leagueCompId(topId, season));
    const secTable = standings(state, leagueCompId(secondId, season));
    if (topTable.length >= 3) {
      qualified.push(topTable[0].clubId, topTable[1].clubId);
      thirds.push(topTable[2].clubId);
    }
    const down = topTable.slice(-3).map((r) => r.clubId);
    const up = secTable.slice(0, 3).map((r) => r.clubId);
    top.clubIds = top.clubIds.filter((id) => !down.includes(id)).concat(up);
    second.clubIds = second.clubIds.filter((id) => !up.includes(id)).concat(down);
    for (const id of up) {
      state.world.clubs[id].leagueId = topId;
      state.world.clubs[id].reputation = clamp(state.world.clubs[id].reputation + 6, 0, 99);
      state.world.clubs[id].balance += 25_000_000;
    }
    for (const id of down) {
      state.world.clubs[id].leagueId = secondId;
      state.world.clubs[id].reputation = clamp(state.world.clubs[id].reputation - 6, 0, 99);
    }
    if (u.clubId >= 0 && up.includes(u.clubId) && u.season.league.apps >= 5) {
      // promotion counts as an honour unless he already has the second-tier title for it (the
      // trophies above were already copied into the career list: record it there too)
      if (!trophies.includes(`${second.name} champion`)) {
        trophies.push(`Promotion from ${second.name}`);
        u.trophies.push({ season, name: `Promotion from ${second.name}`, clubName: userClub?.name ?? '' });
      }
      addNotice(state, `Promoted to the ${top.name}!`, 'gold');
    }
    if (u.clubId >= 0 && down.includes(u.clubId)) addNotice(state, `Relegated to the ${second.name}…`, 'bad');
    // reputation drift from final positions and prize money
    [topTable, secTable].forEach((table, tier) => {
      table.forEach((r, i) => {
        const c = state.world.clubs[r.clubId];
        const expected = tier === 0 ? 90 - i * 2.5 : 50 - i * 1.5;
        c.reputation = clamp(c.reputation + (expected - c.reputation) * 0.05, 15, 99);
        c.balance += Math.round((tier === 0 ? 60_000_000 : 8_000_000) * (1 - i / table.length) + c.fans * 40);
      });
    });
  }
  thirds.sort((a, b) => state.world.clubs[b].reputation - state.world.clubs[a].reputation);
  state.continentalQualified = [...qualified, ...thirds.slice(0, 16 - qualified.length)];
  const eu = comp(state, continentalCompId(season));
  if (eu?.winnerId !== null && eu?.winnerId !== undefined) state.world.clubs[eu.winnerId].reputation = clamp(state.world.clubs[eu.winnerId].reputation + 3, 0, 99);

  // --- coaches: underachievers are replaced
  for (const c of state.world.clubs) {
    const lg = state.world.leagues[c.leagueId];
    const table = standings(state, leagueCompId(lg.id, season));
    const pos = table.findIndex((r) => r.clubId === c.id);
    const expectedPos = Math.round((1 - c.reputation / 100) * table.length);
    if (pos >= 0 && pos > expectedPos + 6 && rng.chance(0.6)) replaceCoach(state, c.id, rng, 'end of season');
  }

  // --- contracts, market, resets
  seasonEndContracts(state, rng);
  for (const n of state.world.npcs) {
    n.season = emptyLine();
    n.yellows = 0;
    n.banned = 0;
  }
  u.season = { league: emptyLine(), cup: emptyLine(), continental: emptyLine(), youth: emptyLine(), international: emptyLine() };
  u.yellows = 0;
  u.banned = 0;
  state.season = season + 1;
  npcSummerMarket(state, rng);
  refreshNationalStrengths(state);
  u.seasonStartStats = statsCopy(u.stats);
  refreshMarketValue(state);
  state.offers = state.offers.filter((o) => o.status === 'pending' && o.expiresDay >= state.day);
  state.reports = state.reports.slice(0, 6);

  // the development squad moves on for over-19s
  if (u.squad === 'youth' && userAge(state) >= 19) {
    u.squad = 'first';
    addNotice(state, 'Too old for the U19s: you train with the first team now.', 'info');
  }
  createSeason(state, state.season, rng);
  addTimeline(state, `Season ${season}/${String((season + 1) % 100).padStart(2, '0')} complete${leaguePos ? ` — ${userClub?.name} finished ${ordinal(leaguePos)}` : ''}`, 'info');
  addMessage(state, {
    from: 'Career',
    kind: 'system',
    subject: `Season review ${season}/${String((season + 1) % 100).padStart(2, '0')}`,
    body: `${record.clubName}: ${leaguePos ? `${ordinal(leaguePos)} in the ${record.leagueName}. ` : ''}You made ${played} appearances (${record.league.goals + record.cup.goals + record.continental.goals} goals). Rating ${record.ovrStart} → ${record.ovrEnd}.${trophies.length ? ` Trophies: ${trophies.join(', ')}.` : ''}${awards.length ? ` Awards: ${awards.join(', ')}.` : ''}`,
    actions: [{ label: 'Season review', action: 'open_season_review', data: { season } }],
  });
  state.events.flags.seasonReview = season;
  void dayOf;
  void formatDate;
  void potentialOvr;
  void npc;
  void cupCompId;
  void fixturesOf;
  void invalidateSquads;
  void tournamentName;
}

export function replaceCoach(state: CareerState, clubId: Id, rng: Rng, reason: string): void {
  const c = state.world.clubs[clubId];
  const old = state.world.coaches.find((x) => x.id === c.coachId);
  const coach = makeCoach(state.world, rng, c.countryKey, c.reputation);
  coach.clubId = clubId;
  coach.hiredDay = state.day;
  c.coachId = coach.id;
  if (old) old.clubId = -1;
  // drop unemployed coaches so the list does not grow forever
  state.world.coaches = state.world.coaches.filter((x) => x.clubId >= 0);
  if (clubId === state.user.clubId) {
    addNotice(state, `${c.name} have appointed a new coach: ${coach.first} ${coach.last} (${reason}).`, 'info');
    addMessage(state, { from: c.name, kind: 'club', subject: 'New head coach', body: `${old ? `${old.first} ${old.last} has left the club. ` : ''}${coach.first} ${coach.last} takes charge. Style: ${coach.style}, favoured formation ${coach.formation}. Everyone starts from zero — impress him.` });
    refreshClubPeople(state, rng);
    state.events.queue.push({ defId: 'new_coach', day: state.day + 1, ctx: { coach: `${coach.first} ${coach.last}`, style: coach.style, formation: coach.formation, youthFaith: Math.round(coach.youthFaith * 100) } });
  }
}

function ovrOfStats(state: CareerState, stats: CareerState['user']['stats']): number {
  const tmp = { ...state.user, stats };
  return userOvr(tmp);
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** mid-season sackings (called monthly) */
export function midSeasonCoachChanges(state: CareerState, rng: Rng): void {
  const m = new Date(state.day * 86400000).getUTCMonth() + 1;
  if (!(m >= 10 || m <= 3)) return;
  for (const lg of state.world.leagues) {
    const table = standings(state, leagueCompId(lg.id, state.season));
    if (table.length === 0 || table[0].p < 8) continue;
    for (const r of table.slice(-3)) {
      const c = state.world.clubs[r.clubId];
      const coach = state.world.coaches.find((x) => x.id === c.coachId);
      if (!coach || state.day - coach.hiredDay < 120) continue;
      const pressure = (state.events.flags.coachUnderPressure ?? -999) > state.day - 60 && c.id === state.user.clubId ? 0.25 : 0;
      if (rng.chance(0.18 + pressure + (c.reputation > 70 ? 0.15 : 0))) replaceCoach(state, c.id, rng, 'poor results');
    }
  }
}
