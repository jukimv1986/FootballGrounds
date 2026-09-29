// Career state. Everything in CareerState is plain JSON (no classes, no Maps) so a save is a
// straight JSON.stringify; lookups that need speed go through runtime indexes (see index.ts)
// which are rebuilt from the state on demand.

import type { Slot } from './dates';
import type { Position, Stats } from './attributes';

export type Id = number;
export type RGB = [number, number, number];

// ----- world

export interface District {
  name: string;
  prestige: number;
  commute: number;
  fun: number;
  calm: number;
  blurb: string;
}

export interface City {
  id: Id;
  name: string;
  countryKey: string;
  cost: number;
  size: number;
  coastal: boolean;
  blurb: string;
  districts: District[];
}

export interface Country {
  key: string;
  name: string;
  demonym: string;
  leagueIds: Id[];
  cupName: string;
  strength: number;
  winterBreak: boolean;
  tax: number;
  currency: string;
  colors: [RGB, RGB];
  language: string;
  dbCountryId?: number;
}

export interface League {
  id: Id;
  countryKey: string;
  tier: 1 | 2;
  name: string;
  clubIds: Id[];
  dbLeagueId?: number;
  logoUrl?: string;
}

export type KitPattern = 'plain' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'sleeves' | 'pinstripes' | 'chevron';
export type FormationKey = '4-4-2' | '4-3-3' | '4-2-3-1' | '4-4-1-1' | '3-5-2' | '4-1-4-1';
export type CoachStyle = 'possession' | 'counter' | 'pressing' | 'direct' | 'balanced';

export interface Club {
  id: Id;
  name: string;
  shortName: string;
  nickname: string;
  cityId: Id;
  countryKey: string;
  leagueId: Id;
  colors: [RGB, RGB];
  kitPattern: KitPattern;
  /** 0 .. 100 */
  reputation: number;
  /** club bank balance */
  balance: number;
  /** 0 .. 1 training facilities */
  facilities: number;
  /** 0 .. 1 academy facilities */
  youthFacilities: number;
  /** 0 .. 1 strength of the youth/development side */
  youthRating: number;
  stadium: string;
  capacity: number;
  fans: number;
  founded: number;
  coachId: Id;
  sponsor: string;
  rivalId: Id;
  /** set for the clubs of the shipped database (real logo/kit images exist) */
  dbTeamId?: number;
  logoUrl?: string;
  kitUrl?: string;
}

export interface Coach {
  id: Id;
  first: string;
  last: string;
  nat: string;
  born: number;
  style: CoachStyle;
  formation: FormationKey;
  /** 0 .. 1: strict about attendance, lifestyle and discipline */
  discipline: number;
  /** 0 .. 1: willingness to play youngsters */
  youthFaith: number;
  /** 0 .. 1: how volatile he is with the media and players */
  temper: number;
  /** 0 .. 1: coaching quality, multiplies training gains */
  quality: number;
  reputation: number;
  clubId: Id;
  hiredDay: number;
}

export interface StatLine {
  apps: number;
  starts: number;
  mins: number;
  goals: number;
  assists: number;
  ratingSum: number;
  rated: number;
  yellows: number;
  reds: number;
  motm: number;
  cleanSheets: number;
}

export interface NPC {
  id: Id;
  first: string;
  last: string;
  nat: string;
  /** club id, or -1 when a free agent */
  clubId: Id;
  squad: 'first' | 'youth';
  pos: Position;
  foot: 'L' | 'R';
  born: number;
  /** peak mean ability (engine agedBase at peak, ~0.45 .. 0.9) */
  peak: number;
  /** development timing offset in years (+ late bloomer) */
  bloom: number;
  /** seed of the stat profile (profile derived deterministically) */
  seed: number;
  /** explicit profile (imported database players) */
  profile?: number[];
  /** cached current mean ability */
  ability: number;
  /** cached rating in own position */
  ovr: number;
  /** 0 .. 100 */
  form: number;
  injuredUntil: number;
  banned: number;
  yellows: number;
  /** last season of the contract */
  contractEnd: number;
  wage: number;
  skin: number;
  hair: string;
  hairColor: string;
  height: number;
  weight: number;
  season: StatLine;
  careerApps: number;
  careerGoals: number;
  caps: number;
}

export interface World {
  countries: Country[];
  cities: City[];
  leagues: League[];
  clubs: Club[];
  coaches: Coach[];
  npcs: NPC[];
  nextNpcId: Id;
  nextCoachId: Id;
}

// ----- competitions

export type CompType = 'league' | 'cup' | 'continental' | 'youth' | 'international' | 'friendly';

export interface Competition {
  id: string;
  type: CompType;
  name: string;
  shortName: string;
  season: number;
  countryKey?: string;
  leagueId?: Id;
  tier?: number;
  /** participating club ids (national team ids for internationals) */
  teamIds: Id[];
  /** knockout: current round index and round names */
  round: number;
  roundNames: string[];
  /** knockout: teams still alive */
  alive: Id[];
  finished: boolean;
  winnerId: Id | null;
  runnerUpId?: Id | null;
  /** two-legged knockout ties */
  twoLegs?: boolean;
  /** knockout: day of each round (first leg) */
  roundDays: number[];
  /** knockout: day of each round's second leg (two-legged ties; 0 = single match) */
  legDays?: number[];
  /** national team level (internationals) */
  level?: NationalLevel;
}

export interface Fixture {
  id: Id;
  compId: string;
  round: number;
  day: number;
  /** 1 afternoon, 2 evening */
  slot: Slot;
  home: Id;
  away: Id;
  hg: number;
  ag: number;
  played: boolean;
  /** penalty shoot-out score (knockout) */
  pens?: [number, number];
  /** second leg: id of the first leg */
  firstLeg?: Id;
  /** youth/development fixture */
  youth?: boolean;
  /** national team fixture (home/away are national team ids) */
  national?: boolean;
}

// ----- the footballer

export type TraitKey =
  | 'ambitious'
  | 'loyal'
  | 'professional'
  | 'party'
  | 'leader'
  | 'humble'
  | 'hothead'
  | 'family'
  | 'media'
  | 'introvert'
  | 'flair'
  | 'resilient';

export type SquadRole = 'youth' | 'prospect' | 'rotation' | 'regular' | 'key' | 'star';

export interface Contract {
  clubId: Id;
  kind: 'youth' | 'pro' | 'loan';
  /** wage per week */
  wage: number;
  startDay: number;
  /** last season of the deal (expires June 30th of season+1) */
  endSeason: number;
  role: SquadRole;
  appearanceBonus: number;
  goalBonus: number;
  releaseClause: number;
  /** for loans: parent club and the parent contract to return to */
  parentClubId?: Id;
  parent?: Contract;
}

export interface Injury {
  key: string;
  name: string;
  /** day the player is fit again */
  until: number;
  startDay: number;
  severity: number;
  rehab: 'standard' | 'aggressive' | 'specialist' | null;
}

export interface SeasonRecord {
  season: number;
  clubId: Id;
  clubName: string;
  leagueName: string;
  leaguePos: number;
  squad: 'youth' | 'first';
  league: StatLine;
  cup: StatLine;
  continental: StatLine;
  youth: StatLine;
  international: StatLine;
  ovrStart: number;
  ovrEnd: number;
  wage: number;
  value: number;
  trophies: string[];
  awards: string[];
  loan?: boolean;
  /** final league table of his league: [club, played, goal difference, points] */
  table?: [string, number, number, number][];
}

export interface Trophy {
  season: number;
  name: string;
  clubName: string;
}

export type NationalLevel = 'none' | 'U17' | 'U19' | 'U21' | 'senior';

export interface Footballer {
  first: string;
  last: string;
  nat: string;
  born: number;
  pos: Position;
  foot: 'L' | 'R';
  height: number;
  weight: number;
  skin: number;
  hair: string;
  hairColor: string;
  shirt: number;
  traits: TraitKey[];
  stats: Stats;
  /** stats at the start of the season (growth indicators) */
  seasonStartStats: Stats;
  /** stats a week ago (short-term growth indicators) */
  weekStartStats: Stats;
  /** personal stat profile (natural strengths, average 0.5) */
  profile: number[];
  /** peak mean ability reachable with ideal development */
  potential: number;
  form: number;
  morale: number;
  fitness: number;
  energy: number;
  sharpness: number;
  professionalism: number;
  rep: { local: number; national: number; world: number };
  followers: number;
  injury: Injury | null;
  injuryHistory: { name: string; day: number; days: number }[];
  banned: number;
  yellows: number;
  clubId: Id;
  squad: 'youth' | 'first';
  contract: Contract;
  season: { league: StatLine; cup: StatLine; continental: StatLine; youth: StatLine; international: StatLine };
  totals: StatLine;
  ratings: number[];
  history: SeasonRecord[];
  trophies: Trophy[];
  awards: { season: number; name: string }[];
  caps: number;
  intlGoals: number;
  national: NationalLevel;
  /** rolling 0..1 attendance and effort at club training (coach sees this) */
  attendance: number;
  effort: number;
  marketValue: number;
  transferRequest: boolean;
  /** season index from which he may retire voluntarily */
  retireOffered: boolean;
}

// ----- life outside football

export type HousingKind = 'digs' | 'shared' | 'apartment' | 'house' | 'villa' | 'family';
export type TransportKind = 'bus' | 'bike' | 'used_car' | 'car' | 'sports_car' | 'luxury';
export type DietKind = 'junk' | 'normal' | 'balanced' | 'nutritionist';
export type SleepKind = 'early' | 'normal' | 'late';

export type PersonRole = 'mother' | 'father' | 'sibling' | 'teammate' | 'friend' | 'partner' | 'agent' | 'mentor' | 'coach' | 'journalist';
export type RomanceStage = 'dating' | 'partner' | 'living' | 'engaged' | 'married';

export interface Person {
  id: Id;
  first: string;
  last: string;
  role: PersonRole;
  /** 0 .. 100 */
  affinity: number;
  lastContact: number;
  since: number;
  /** linked NPC footballer (teammates) */
  npcId?: Id;
  /** romance progress */
  stage?: RomanceStage;
  /** free-form flavour: job, city, hobby */
  job?: string;
  cityId?: Id;
  /** agent: 0..1 negotiation skill, fee fraction, network reach */
  skill?: number;
  fee?: number;
  reach?: number;
  gone?: boolean;
}

export interface SponsorDeal {
  id: Id;
  brand: string;
  category: string;
  /** per month */
  monthly: number;
  startDay: number;
  endDay: number;
  /** evenings per month the brand needs */
  duties: number;
  dutiesDone: number;
}

export interface Investment {
  key: string;
  name: string;
  amount: number;
  /** 0 .. 1 risk */
  risk: number;
  since: number;
}

export interface Property {
  kind: HousingKind;
  cityId: Id;
  district: number;
  value: number;
  boughtDay: number;
}

export interface LedgerEntry {
  day: number;
  label: string;
  amount: number;
}

export type ActivityKey = string;
/** weekly default plan: 7 days (Mon..Sun) x 3 slots; null = club/automatic */
export type WeekPlan = (ActivityKey | null)[][];

export interface Life {
  cityId: Id;
  /** where his family lives */
  hometown: Id;
  district: number;
  school: { attended: number; missed: number; graduated: boolean };
  /** overnight recovery multiplier set by the evening's activity */
  sleepMult: number;
  housing: { kind: HousingKind; owned: boolean; weekly: number; since: number };
  properties: Property[];
  transport: TransportKind;
  diet: DietKind;
  sleep: SleepKind;
  money: number;
  investments: Investment[];
  ledger: LedgerEntry[];
  happiness: { football: number; social: number; romance: number; family: number; home: number; money: number };
  people: Person[];
  nextPersonId: Id;
  agentId: Id | null;
  partnerId: Id | null;
  sponsors: SponsorDeal[];
  education: { enrolled: string | null; progress: Record<string, number>; completed: string[] };
  hobbies: Record<string, number>;
  charity: { donated: number; points: number; foundation: boolean };
  plan: WeekPlan;
  /** club training intensity the player brings: 0 light, 1 normal, 2 hard */
  clubIntensity: 0 | 1 | 2;
  /** personal focus during club sessions (part of the session's XP goes here) */
  clubFocus: string | null;
  /** extra-session intensity */
  extraIntensity: 0 | 1 | 2;
  /** one-off plan overrides for specific day/slot: key `${day}:${slot}` */
  overrides: Record<string, ActivityKey>;
  vacation: { until: number; place: string } | null;
  /** the fun/social need accumulates when neglected */
  fatigueMental: number;
  lastActivity: { day: number; slot: Slot; key: string; summary: string } | null;
}

// ----- messages, social, offers

export interface MessageAction {
  label: string;
  action: string;
  data?: Record<string, unknown>;
}

export interface Message {
  id: Id;
  day: number;
  from: string;
  subject: string;
  body: string;
  kind: 'club' | 'agent' | 'family' | 'media' | 'sponsor' | 'system' | 'offer' | 'friend' | 'national';
  read: boolean;
  actions?: MessageAction[];
  resolved?: boolean;
}

export interface Post {
  id: Id;
  day: number;
  author: string;
  handle: string;
  text: string;
  likes: number;
  kind: 'fan' | 'journalist' | 'club' | 'self' | 'teammate' | 'rival' | 'brand';
  mood: -1 | 0 | 1;
}

export interface Notice {
  id: Id;
  day: number;
  text: string;
  tone: 'good' | 'bad' | 'info' | 'gold';
}

export type OfferKind = 'youth' | 'pro' | 'renewal' | 'transfer' | 'loan' | 'free';

export interface ContractOffer {
  id: Id;
  clubId: Id;
  kind: OfferKind;
  wage: number;
  years: number;
  role: SquadRole;
  signingBonus: number;
  releaseClause: number;
  appearanceBonus: number;
  goalBonus: number;
  /** transfer fee the clubs agreed (transfer) */
  fee: number;
  expiresDay: number;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  rounds: number;
  /** 0 .. 1: how much more haggling the club tolerates */
  patience: number;
  note: string;
}

// ----- narrative events

export interface EventInstance {
  defId: string;
  day: number;
  ctx: Record<string, string | number>;
}

export interface EventState {
  pending: EventInstance | null;
  queue: EventInstance[];
  log: Record<string, number>;
  counts: Record<string, number>;
  flags: Record<string, number>;
}

// ----- matches

export type MatchRole = 'start' | 'bench' | 'out';

export interface PendingMatch {
  fixtureId: Id;
  role: MatchRole;
  /** slot the user plays in (engine formation order) */
  lineupPos: Position;
}

export interface ReportEvent {
  minute: number;
  type: 'goal' | 'owngoal' | 'yellow' | 'red' | 'sub_on' | 'sub_off' | 'injury' | 'chance' | 'save' | 'penalty_miss';
  side: 0 | 1;
  name: string;
  assist?: string;
  user?: boolean;
  text?: string;
}

export interface UserMatchStats {
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  passes: number;
  passesCompleted: number;
  keyPasses: number;
  dribbles: number;
  tackles: number;
  interceptions: number;
  saves: number;
  /** ball touches (3D matches) */
  touches?: number;
  fouls: number;
  yellow: number;
  red: number;
  rating: number;
  motm: boolean;
}

export interface MatchReport {
  fixtureId: Id;
  day: number;
  compName: string;
  homeName: string;
  awayName: string;
  home: Id;
  away: Id;
  hg: number;
  ag: number;
  pens?: [number, number];
  /** decided after extra time */
  aet?: boolean;
  userSide: 0 | 1;
  events: ReportEvent[];
  user: UserMatchStats | null;
  role: MatchRole;
  played3D: boolean;
  possession: number;
  shots: [number, number];
  motmName: string;
  headline: string;
  youth?: boolean;
  national?: boolean;
}

// ----- history

export interface SeasonSummaryWorld {
  season: number;
  champions: { comp: string; club: string }[];
  topScorer?: { name: string; club: string; goals: number };
  playerOfSeason?: { name: string; club: string };
}

export interface Legacy {
  retiredDay: number;
  age: number;
  reason: string;
  next: string;
  nextDetail: string;
  score: number;
}

export interface CareerSettings {
  romance: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
  /** fraction of a real match (engine match_duration override); null = config default */
  matchDuration: number | null;
}

export interface CareerState {
  version: number;
  id: string;
  seed: number;
  rng: number;
  createdAt: number;
  savedAt: number;
  day: number;
  slot: Slot;
  season: number;
  startSeason: number;
  world: World;
  comps: Competition[];
  fixtures: Fixture[];
  nextFixtureId: Id;
  user: Footballer;
  life: Life;
  inbox: Message[];
  feed: Post[];
  notices: Notice[];
  nextMsgId: Id;
  offers: ContractOffer[];
  events: EventState;
  pendingMatch: PendingMatch | null;
  reports: MatchReport[];
  history: SeasonSummaryWorld[];
  retired: Legacy | null;
  settings: CareerSettings;
  /** national team ids -> nation key and level (for internationals) */
  nationalTeams: { id: Id; nation: string; level: NationalLevel; strength: number }[];
  /** qualified clubs for next season's continental cup */
  continentalQualified: Id[];
  /** log of what happened in each slot recently (hub timeline) */
  timeline: { day: number; slot: Slot; text: string; tone?: 'good' | 'bad' | 'info' }[];
}
