// World generation: countries, cities with districts, two league tiers per country, clubs with
// identity (name, colors, kit pattern, stadium, reputation, finances, facilities), a coach with a
// personality per club and a full first-team squad per club.
//
// The shipped database's 8 clubs and 144 players are imported as-is (names, profiles, abilities,
// appearance) into their country's top tier; every other club is generated deterministically from
// the career seed. The engine database is NOT modified here; generated clubs are only registered
// into GetDB() right before a 3D match (see engine/bridge.ts).

import type { DatabaseTables } from '../../game/data/database';
import { parseProfileXml, positionFromRoleString, type Position } from './attributes';
import { dayOf, seasonOf } from './dates';
import { COUNTRIES, DB_CLUB_CITY, districtsFor, NATIONS, type CountryDef } from './data/geography';
import { CLUB_SPONSORS } from './data/lifestyle';
import { IMPORT_NATIONS, randomName } from './data/names';
import { SQUAD_TEMPLATE, YOUTH_TEMPLATE, createNpc, emptyLine, expectedWage, refreshNpc } from './players';
import { Rng, clamp, hashString } from './rng';
import type { City, Club, Coach, CoachStyle, Country, FormationKey, Id, KitPattern, League, NPC, RGB, World } from './types';

export const TOP_TIER_SIZE = 18;
export const SECOND_TIER_SIZE = 16;

const PALETTE: { name: string; rgb: RGB }[] = [
  { name: 'Reds', rgb: [200, 20, 30] },
  { name: 'Blues', rgb: [20, 60, 170] },
  { name: 'Sky Blues', rgb: [110, 180, 235] },
  { name: 'Whites', rgb: [245, 245, 245] },
  { name: 'Blacks', rgb: [25, 25, 25] },
  { name: 'Yellows', rgb: [250, 205, 20] },
  { name: 'Greens', rgb: [20, 130, 60] },
  { name: 'Claret', rgb: [120, 20, 45] },
  { name: 'Oranges', rgb: [245, 120, 20] },
  { name: 'Navy', rgb: [15, 30, 75] },
  { name: 'Purples', rgb: [100, 40, 150] },
  { name: 'Maroons', rgb: [110, 25, 25] },
];

const KIT_PATTERNS: KitPattern[] = ['plain', 'plain', 'plain', 'stripes', 'hoops', 'halves', 'sash', 'sleeves', 'pinstripes', 'chevron'];
const FORMATIONS: FormationKey[] = ['4-4-2', '4-3-3', '4-2-3-1', '4-4-1-1', '3-5-2', '4-1-4-1'];
const STYLES: CoachStyle[] = ['possession', 'counter', 'pressing', 'direct', 'balanced'];

const STADIUM_PATTERNS: Record<string, string[]> = {
  ENG: ['{c} Park', '{c} Road', 'The {c} Ground', '{c} Lane', 'Victoria Park', 'The Old Foundry', 'Riverside Stadium', 'Kingsway'],
  GER: ['{c} Arena', 'Stadion {c}', 'Waldstadion', 'Parkstadion', 'Volksparkstadion', 'Stadion am Fluss'],
  NED: ['Stadion {c}', '{c} Arena', 'Het Kasteel', 'De Kuip van {c}', 'Sportpark {c}'],
  ESP: ['Estadio de {c}', 'Estadio Municipal', 'Nuevo Estadio {c}', 'Campo de {c}', 'Estadio La Rosaleda'],
  ITA: ['Stadio {c}', 'Stadio Comunale', 'Stadio del Mare', 'Arena {c}', 'Stadio San Marco'],
  FRA: ['Stade de {c}', 'Stade Municipal', 'Parc des Sports', 'Stade du Moulin', 'Stade {c}'],
  POR: ['Estádio de {c}', 'Estádio Municipal', 'Estádio do Mar', 'Estádio da Luz Nova', 'Estádio {c}'],
};

// Database clubs: reputation (they are the continent's giants) and club nicknames.
const DB_CLUB_REP: Record<number, number> = { 8: 94, 3: 93, 4: 92, 6: 90, 2: 88, 5: 86, 1: 84, 7: 81 };
const DB_CLUB_NICK: Record<number, string> = { 1: 'The Sons of the Gods', 2: 'The Gunners', 3: 'Blaugrana', 4: 'The Bavarians', 5: 'Die Gelben', 6: 'The Red Devils', 7: 'The Farmers', 8: 'Los Blancos' };

function parseColor(s: string): RGB {
  const parts = s.split(',').map((x) => Math.round(parseFloat(x)));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function colorDistance(a: RGB, b: RGB): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

export interface GenerateOptions {
  seed: number;
  startSeason: number;
  db: DatabaseTables | null;
}

export function generateWorld(opts: GenerateOptions): World {
  const rng = new Rng(opts.seed ^ 0x51f15e);
  const day = dayOf(opts.startSeason, 7, 1);
  const world: World = { countries: [], cities: [], leagues: [], clubs: [], coaches: [], npcs: [], nextNpcId: 1, nextCoachId: 1 };

  for (const def of COUNTRIES) generateCountry(world, def, rng, opts, day);

  // rivals: same city first, else the closest reputation in the league
  for (const club of world.clubs) {
    const same = world.clubs.filter((c) => c.id !== club.id && c.cityId === club.cityId);
    if (same.length) club.rivalId = same[0].id;
    else {
      const lg = world.leagues[club.leagueId];
      const others = lg.clubIds.filter((id) => id !== club.id).map((id) => world.clubs[id]);
      others.sort((a, b) => Math.abs(a.reputation - club.reputation) - Math.abs(b.reputation - club.reputation));
      club.rivalId = others[0]?.id ?? club.id;
    }
  }
  for (const n of world.npcs) refreshNpc(n, day);
  return world;
}

function generateCountry(world: World, def: CountryDef, rng: Rng, opts: GenerateOptions, day: number): void {
  const country: Country = {
    key: def.key,
    name: def.name,
    demonym: def.demonym,
    leagueIds: [],
    cupName: def.cupName,
    strength: def.strength,
    winterBreak: def.winterBreak,
    tax: def.tax,
    currency: def.currency,
    colors: def.colors,
    language: def.language,
    dbCountryId: def.dbCountryId,
  };
  world.countries.push(country);

  const cities: City[] = def.cities.map((c) => {
    const city: City = {
      id: world.cities.length,
      name: c.name,
      countryKey: def.key,
      cost: c.cost,
      size: c.size,
      coastal: !!c.coastal,
      blurb: c.blurb,
      districts: districtsFor(def, c),
    };
    world.cities.push(city);
    return city;
  });

  const dbLeague = def.dbCountryId !== undefined ? opts.db?.leagues.find((l) => l.country_id === def.dbCountryId) : undefined;
  const top: League = { id: world.leagues.length, countryKey: def.key, tier: 1, name: def.leagueNames[0], clubIds: [], dbLeagueId: dbLeague?.id, logoUrl: dbLeague?.logo_url };
  world.leagues.push(top);
  const second: League = { id: world.leagues.length, countryKey: def.key, tier: 2, name: def.leagueNames[1], clubIds: [] };
  world.leagues.push(second);
  country.leagueIds = [top.id, second.id];

  // city capacity for clubs
  const capacity = new Map<Id, number>();
  for (const c of cities) capacity.set(c.id, Math.max(1, Math.floor(1 + c.size * 2.6)));
  const usedNames = new Set<string>();
  const usedShort = new Set<string>();

  // database clubs
  const dbTeams = dbLeague ? opts.db!.teams.filter((t) => t.league_id === dbLeague.id) : [];
  const dbClubs: Club[] = [];
  for (const t of dbTeams) {
    const cityName = DB_CLUB_CITY[t.id];
    const city = cities.find((c) => c.name === cityName) ?? cities[0];
    capacity.set(city.id, (capacity.get(city.id) ?? 1) - 1);
    const rep = DB_CLUB_REP[t.id] ?? 82;
    const c = makeClub(world, rng, def, city, top.id, rep, {
      name: t.name,
      shortName: t.shortname || t.name.substring(0, 3).toUpperCase(),
      colors: [parseColor(t.color1), parseColor(t.color2)],
      dbTeamId: t.id,
      logoUrl: t.logo_url,
      kitUrl: t.kit_url,
      nickname: DB_CLUB_NICK[t.id],
    });
    usedNames.add(c.name);
    usedShort.add(c.shortName);
    dbClubs.push(c);
    top.clubIds.push(c.id);
  }

  // generated clubs: bigger cities are more likely to host top-flight football
  const slots: City[] = [];
  const cityOrder = [...cities].sort((a, b) => b.size - a.size + rng.gauss(0, 0.12));
  const wanted = TOP_TIER_SIZE + SECOND_TIER_SIZE - dbClubs.length;
  // big cities host several clubs; once their capacity is used up, towns get a second club
  for (let round = 0; round < 12 && slots.length < wanted; round++) {
    for (const c of cityOrder) {
      if ((capacity.get(c.id) ?? 0) > round || (round >= 3 && slots.filter((s) => s === c).length < 3)) slots.push(c);
      if (slots.length >= wanted) break;
    }
  }
  const nTop = TOP_TIER_SIZE - dbClubs.length;
  const strengthScale = 0.72 + 0.28 * def.strength;
  for (let i = 0; i < slots.length; i++) {
    const tierTop = i < nTop;
    const rank = tierTop ? i : i - nTop;
    const rep = tierTop
      ? clamp((78 - rank * (30 / Math.max(1, nTop))) * strengthScale + 8 * (1 - strengthScale) + rng.gauss(0, 3), 40, 88)
      : clamp((52 - rank * 1.6) * (0.85 + 0.15 * def.strength) + rng.gauss(0, 3), 22, 60);
    const city = slots[i];
    const name = uniqueClubName(rng, def, city.name, usedNames);
    const short = uniqueShortName(city.name, name, usedShort);
    const c = makeClub(world, rng, def, city, tierTop ? top.id : second.id, rep, { name, shortName: short });
    (tierTop ? top : second).clubIds.push(c.id);
  }

  // squads
  const season = seasonOf(day);
  for (const clubId of [...top.clubIds, ...second.clubIds]) {
    const club = world.clubs[clubId];
    if (club.dbTeamId !== undefined && opts.db) importDbSquad(world, rng, club, opts.db, day, season);
    generateSquad(world, rng, club, day, season);
  }
}

function uniqueClubName(rng: Rng, def: CountryDef, city: string, used: Set<string>): string {
  const patterns = rng.shuffle([...def.clubPatterns]);
  for (const p of patterns) {
    const name = p.replace('{c}', city);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const name = `${city} ${used.size}`;
  used.add(name);
  return name;
}

function uniqueShortName(city: string, name: string, used: Set<string>): string {
  const letters = city.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
  const words = name.normalize('NFD').replace(/[^A-Za-z ]/g, '').toUpperCase().split(' ').filter(Boolean);
  const candidates = [letters.substring(0, 3), letters[0] + letters.substring(2, 4), words.map((w) => w[0]).join('').substring(0, 3), letters.substring(0, 2) + (words[words.length - 1] ?? 'X')[0], letters[0] + letters[letters.length - 1] + letters[1]];
  for (const c of candidates) {
    if (c.length === 3 && !used.has(c)) {
      used.add(c);
      return c;
    }
  }
  let i = 1;
  while (used.has(letters.substring(0, 2) + i)) i++;
  const s = letters.substring(0, 2) + i;
  used.add(s);
  return s;
}

interface ClubOverrides {
  name: string;
  shortName: string;
  colors?: [RGB, RGB];
  dbTeamId?: number;
  logoUrl?: string;
  kitUrl?: string;
  nickname?: string;
}

function makeClub(world: World, rng: Rng, def: CountryDef, city: City, leagueId: Id, rep: number, o: ClubOverrides): Club {
  let colors = o.colors;
  if (!colors) {
    const cityClubs = world.clubs.filter((c) => c.cityId === city.id);
    const primary = rng.weighted(PALETTE, (p) => (cityClubs.some((c) => colorDistance(c.colors[0], p.rgb) < 120) ? 0.05 : 1));
    const secondary = rng.weighted(PALETTE, (p) => (colorDistance(p.rgb, primary.rgb) < 250 ? 0 : p.name === 'Whites' || p.name === 'Blacks' ? 3 : 1));
    colors = [primary.rgb, secondary.rgb];
  }
  const primaryName = PALETTE.reduce((best, p) => (colorDistance(p.rgb, colors![0]) < colorDistance(best.rgb, colors![0]) ? p : best)).name;
  const stadiumPatterns = STADIUM_PATTERNS[def.key] ?? ['{c} Stadium'];
  const coach = makeCoach(world, rng, def.key, rep);
  const club: Club = {
    id: world.clubs.length,
    name: o.name,
    shortName: o.shortName,
    nickname: o.nickname ?? `The ${primaryName}`,
    cityId: city.id,
    countryKey: def.key,
    leagueId,
    colors,
    kitPattern: o.dbTeamId !== undefined ? 'plain' : rng.pick(KIT_PATTERNS),
    reputation: Math.round(rep),
    balance: Math.round(rep * rep * 18000 * rng.range(0.7, 1.3)),
    facilities: clamp(0.25 + rep * 0.0068 + rng.gauss(0, 0.06), 0.15, 1),
    youthFacilities: clamp(0.2 + rep * 0.006 + rng.gauss(0, 0.12), 0.1, 1),
    youthRating: clamp(0.3 + rep * 0.0035 + rng.gauss(0, 0.04), 0.3, 0.72),
    stadium: rng.pick(stadiumPatterns).replace('{c}', city.name),
    capacity: Math.round((4000 + rep * rep * 8.5 * rng.range(0.75, 1.2)) / 100) * 100,
    fans: Math.round(rep * rep * rep * 3 * rng.range(0.6, 1.4)),
    founded: rng.int(1870, 1935),
    coachId: coach.id,
    sponsor: rng.pick(CLUB_SPONSORS),
    rivalId: -1,
    dbTeamId: o.dbTeamId,
    logoUrl: o.logoUrl,
    kitUrl: o.kitUrl,
  };
  coach.clubId = club.id;
  world.clubs.push(club);
  return club;
}

export function makeCoach(world: World, rng: Rng, nation: string, rep: number): Coach {
  const nat = rng.chance(0.75) ? nation : rng.pick([...COUNTRIES.map((c) => c.key), ...NATIONS.map((n) => n.key)]);
  const name = randomName(rng, nat);
  const age = rng.int(38, 66);
  const coach: Coach = {
    id: world.nextCoachId++,
    first: name.first,
    last: name.last,
    nat,
    born: dayOf(2026 - age, rng.int(1, 12), rng.int(1, 28)),
    style: rng.pick(STYLES),
    formation: rng.pick(FORMATIONS),
    discipline: clamp(rng.gauss(0.55, 0.2), 0.1, 1),
    youthFaith: clamp(rng.gauss(0.5, 0.22), 0.05, 1),
    temper: clamp(rng.gauss(0.45, 0.22), 0.05, 1),
    quality: clamp(0.4 + rep * 0.005 + rng.gauss(0, 0.08), 0.3, 1),
    reputation: Math.round(clamp(rep + rng.gauss(0, 8), 20, 99)),
    clubId: -1,
    hiredDay: 0,
  };
  world.coaches.push(coach);
  return coach;
}

/** squad target ability (peak mean stat) for a club reputation */
export function clubLevel(rep: number): number {
  return 0.4 + rep * 0.0042;
}

function pickNation(rng: Rng, countryKey: string, importShare: number): string {
  if (!rng.chance(importShare)) return countryKey;
  return rng.pick(IMPORT_NATIONS[countryKey] ?? ['ENG']);
}

function randomBirth(rng: Rng, day: number, age: number): number {
  return day - Math.round(age * 365.25) - rng.int(0, 364);
}

function importDbSquad(world: World, rng: Rng, club: Club, db: DatabaseTables, day: number, season: number): void {
  for (const p of db.players.filter((x) => x.team_id === club.dbTeamId)) {
    const pos: Position = positionFromRoleString(p.role);
    const peak = p.base_stat * 1.2;
    const profile = parseProfileXml(p.profile_xml);
    const n: NPC = {
      id: world.nextNpcId++,
      first: p.firstname,
      last: p.lastname,
      nat: pickNation(new Rng(hashString(`${p.id}:${p.lastname}`)), club.countryKey, 0.4),
      clubId: club.id,
      squad: 'first',
      pos,
      foot: p.role.includes(' L') && !p.role.includes('R') ? 'L' : rng.chance(0.2) ? 'L' : 'R',
      born: randomBirth(rng, day, p.age),
      peak,
      bloom: 0,
      seed: rng.seed(),
      profile,
      ability: 0,
      ovr: 0,
      form: 65,
      injuredUntil: 0,
      banned: 0,
      yellows: 0,
      contractEnd: season + rng.int(1, 4),
      wage: 0,
      skin: p.skincolor,
      hair: p.hairstyle,
      hairColor: p.haircolor,
      height: p.height,
      weight: p.weight,
      season: emptyLine(),
      careerApps: 0,
      careerGoals: 0,
      caps: 0,
    };
    refreshNpc(n, day);
    n.wage = expectedWage(n.ovr, club.reputation, p.age);
    world.npcs.push(n);
  }
}

/** fills a club's first-team squad up to the template */
export function generateSquad(world: World, rng: Rng, club: Club, day: number, season: number): void {
  const have = world.npcs.filter((n) => n.clubId === club.id && n.squad === 'first');
  const need = [...SQUAD_TEMPLATE];
  for (const n of have) {
    const i = need.indexOf(n.pos);
    if (i >= 0) need.splice(i, 1);
  }
  const level = clubLevel(club.reputation);
  const importShare = club.reputation > 70 ? 0.4 : club.reputation > 50 ? 0.28 : 0.15;
  need.forEach((pos, i) => {
    const age = clamp(Math.round(rng.gauss(25, 4.2)), 17, 35);
    const starterBoost = i % 2 === 0 ? 0.02 : -0.02;
    const youngBoost = age < 22 ? (22 - age) * 0.008 : 0;
    const n = createNpc(rng, {
      id: world.nextNpcId++,
      nat: pickNation(rng, club.countryKey, importShare),
      pos,
      clubId: club.id,
      squad: 'first',
      born: randomBirth(rng, day, age),
      peak: level + starterBoost + youngBoost + rng.gauss(0, 0.04),
      day,
      contractEnd: season + rng.int(0, 4),
      wage: 0,
    });
    n.wage = expectedWage(n.ovr, club.reputation, age);
    world.npcs.push(n);
  });
}

/** generates the development squad (U19 / reserves) of a club: only done for clubs the user joins */
export function generateYouthSquad(world: World, rng: Rng, club: Club, day: number, season: number): NPC[] {
  const out: NPC[] = [];
  const level = clubLevel(club.reputation) * (0.92 + club.youthFacilities * 0.12);
  for (const pos of YOUTH_TEMPLATE) {
    const age = rng.int(15, 18);
    const n = createNpc(rng, {
      id: world.nextNpcId++,
      nat: pickNation(rng, club.countryKey, 0.15),
      pos,
      clubId: club.id,
      squad: 'youth',
      born: randomBirth(rng, day, age),
      peak: level + rng.gauss(0, 0.055),
      day,
      contractEnd: season + 2,
      wage: 0,
    });
    n.wage = expectedWage(n.ovr, club.reputation, age);
    world.npcs.push(n);
    out.push(n);
  }
  return out;
}

/** a new youngster promoted into a first team (yearly intake) */
export function generateIntakePlayer(world: World, rng: Rng, club: Club, pos: Position, day: number, season: number): NPC {
  const age = rng.int(17, 19);
  const level = clubLevel(club.reputation) * (0.93 + club.youthFacilities * 0.12);
  const n = createNpc(rng, {
    id: world.nextNpcId++,
    nat: pickNation(rng, club.countryKey, 0.2),
    pos,
    clubId: club.id,
    squad: 'first',
    born: randomBirth(rng, day, age),
    peak: level + rng.gauss(0.01, 0.05),
    day,
    contractEnd: season + 3,
    wage: 0,
  });
  n.wage = expectedWage(n.ovr, club.reputation, age);
  world.npcs.push(n);
  return n;
}
