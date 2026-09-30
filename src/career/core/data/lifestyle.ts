// Life outside football: the catalogue of housing, transport, diets, city venues and the
// activities each venue offers for the free slots of a day, plus courses, hobbies and brands.
//
// Activities are data: energy cost, money cost (scaled by the city's cost of living) and a set
// of effects. Effects feed the interlocking meters: energy (today), fitness/sharpness (body),
// morale (mood), the happiness components (football, social, romance, family, home, money),
// professionalism (what coaches see), reputation/followers (fame) and training XP.

import type { DietKind, HousingKind, SleepKind, TransportKind } from '../types';

export interface HousingDef {
  kind: HousingKind;
  name: string;
  desc: string;
  /** weekly rent at cost-of-living 1.0 in an average district */
  rent: number;
  /** purchase price at cost 1.0 (0 = cannot buy) */
  price: number;
  /** 0 .. 100 comfort -> home happiness, sleep */
  comfort: number;
  /** status/fame bump */
  status: number;
  minAge?: number;
}

export const HOUSING: HousingDef[] = [
  { kind: 'digs', name: 'Academy digs', desc: 'A small room at the academy lodge. Free, a curfew, and a landlady who knows everything.', rent: 0, price: 0, comfort: 38, status: 0 },
  { kind: 'family', name: 'Family home', desc: 'Your old bedroom. Mum\'s cooking, dad\'s advice, zero privacy.', rent: 0, price: 0, comfort: 60, status: 0 },
  { kind: 'shared', name: 'Shared flat', desc: 'Two bedrooms, three flatmates, one working shower.', rent: 160, price: 0, comfort: 48, status: 3, minAge: 17 },
  { kind: 'apartment', name: 'City apartment', desc: 'Your own place: modern kitchen, a balcony and peace and quiet.', rent: 750, price: 320000, comfort: 66, status: 12, minAge: 18 },
  { kind: 'house', name: 'Family house', desc: 'Garden, garage, room for visitors and a home gym.', rent: 2000, price: 950000, comfort: 82, status: 30, minAge: 18 },
  { kind: 'villa', name: 'Luxury villa', desc: 'Pool, cinema room, security gate. The dream.', rent: 7500, price: 4200000, comfort: 96, status: 60, minAge: 19 },
];

export interface TransportDef {
  kind: TransportKind;
  name: string;
  desc: string;
  price: number;
  weekly: number;
  /** commute energy multiplier */
  commute: number;
  status: number;
  minAge: number;
}

export const TRANSPORT: TransportDef[] = [
  { kind: 'bus', name: 'Bus pass', desc: 'Slow, crowded, and fans recognise you.', price: 0, weekly: 25, commute: 1.45, status: 0, minAge: 0 },
  { kind: 'bike', name: 'Bicycle', desc: 'Cheap, healthy, and a little dangerous in the rain.', price: 450, weekly: 3, commute: 1.2, status: 2, minAge: 0 },
  { kind: 'used_car', name: 'Second-hand hatchback', desc: 'It gets you there. Usually.', price: 7000, weekly: 70, commute: 1.0, status: 6, minAge: 18 },
  { kind: 'car', name: 'New saloon', desc: 'Heated seats and a sound system worth the money.', price: 38000, weekly: 110, commute: 0.9, status: 18, minAge: 18 },
  { kind: 'sports_car', name: 'Sports car', desc: 'Loud, fast and very photographable.', price: 185000, weekly: 320, commute: 0.85, status: 45, minAge: 18 },
  { kind: 'luxury', name: 'Luxury car + chauffeur', desc: 'You nap on the way to training.', price: 420000, weekly: 1400, commute: 0.65, status: 70, minAge: 18 },
];

export interface DietDef {
  kind: DietKind;
  name: string;
  desc: string;
  weekly: number;
  /** multiplier on overnight recovery */
  recovery: number;
  /** multiplier on injury risk */
  injury: number;
  /** daily fitness drift */
  fitness: number;
  morale: number;
}

export const DIETS: DietDef[] = [
  { kind: 'junk', name: 'Takeaways & snacks', desc: 'Tasty, cheap, and your body notices.', weekly: 60, recovery: 0.9, injury: 1.15, fitness: -0.15, morale: 0.15 },
  { kind: 'normal', name: 'Home cooking', desc: 'Decent food, mostly.', weekly: 120, recovery: 1.0, injury: 1.0, fitness: 0, morale: 0 },
  { kind: 'balanced', name: 'Balanced plan', desc: 'Meal-prepped protein, veg and carbs.', weekly: 260, recovery: 1.07, injury: 0.9, fitness: 0.08, morale: -0.05 },
  { kind: 'nutritionist', name: 'Personal nutritionist', desc: 'A chef and a scientist plan every bite.', weekly: 1300, recovery: 1.14, injury: 0.8, fitness: 0.15, morale: 0 },
];

export interface SleepDef {
  kind: SleepKind;
  name: string;
  desc: string;
  recovery: number;
  social: number;
}

export const SLEEP: SleepDef[] = [
  { kind: 'early', name: 'Early to bed', desc: 'Lights out at 22:00. Your body thanks you; your friends don\'t.', recovery: 1.1, social: -0.3 },
  { kind: 'normal', name: 'Normal hours', desc: 'Around midnight, like everyone.', recovery: 1.0, social: 0 },
  { kind: 'late', name: 'Night owl', desc: 'Series, games and chats until 2am.', recovery: 0.88, social: 0.25 },
];

// ----- venues & activities

export type VenueKey =
  | 'home'
  | 'training'
  | 'gym'
  | 'park'
  | 'restaurant'
  | 'nightclub'
  | 'cafe'
  | 'mall'
  | 'school'
  | 'agent'
  | 'clinic'
  | 'community'
  | 'beach'
  | 'stadium'
  | 'golf'
  | 'culture'
  | 'family';

export interface VenueDef {
  key: VenueKey;
  name: string;
  desc: string;
  /** minimum city size (0..1) for the venue to exist */
  minSize?: number;
  coastal?: boolean;
  glyph: string;
}

export const VENUES: VenueDef[] = [
  { key: 'home', name: 'Home', desc: 'Rest, recover, call home, play games.', glyph: '⌂' },
  { key: 'training', name: 'Training Ground', desc: 'Extra sessions, video analysis, rehab.', glyph: '⚽' },
  { key: 'gym', name: 'Performance Gym', desc: 'Weights, cardio and classes.', glyph: '⚡' },
  { key: 'park', name: 'City Park', desc: 'Runs, walks and kickabouts with locals.', glyph: '❀' },
  { key: 'restaurant', name: 'Restaurant Row', desc: 'Team dinners, dates and fine dining.', glyph: '✦' },
  { key: 'nightclub', name: 'Nightlife District', desc: 'Clubs, bars and bright lights.', glyph: '♫' },
  { key: 'cafe', name: 'Café Corner', desc: 'Coffee with friends, quiz nights.', glyph: '☕' },
  { key: 'mall', name: 'Shopping Centre', desc: 'Clothes, gadgets and gifts.', glyph: '◈' },
  { key: 'school', name: 'College', desc: 'School, courses, languages and coaching badges.', glyph: '✎' },
  { key: 'agent', name: 'Agent Office', desc: 'Contracts, interest from clubs, sponsors.', glyph: '✉' },
  { key: 'clinic', name: 'Clinic & Spa', desc: 'Physio, cryotherapy and massage.', glyph: '✚' },
  { key: 'community', name: 'Community Centre', desc: 'Charity work and coaching kids.', glyph: '♥' },
  { key: 'beach', name: 'Beach', desc: 'Sun, sea and a surfboard.', coastal: true, glyph: '≈' },
  { key: 'stadium', name: 'Stadium', desc: 'Fan events and watching other games.', glyph: '◎' },
  { key: 'golf', name: 'Golf Club', desc: 'Eighteen holes with teammates.', minSize: 0.3, glyph: '⛳' },
  { key: 'culture', name: 'Cinema & Culture', desc: 'Films, museums and concerts.', minSize: 0.2, glyph: '✧' },
  { key: 'family', name: 'Family', desc: 'Your parents\' place — or a trip back home.', glyph: '❦' },
];

export type TrainingKey =
  | 'fitness'
  | 'speed'
  | 'strength'
  | 'ballcontrol'
  | 'passing'
  | 'finishing'
  | 'defending'
  | 'goalkeeping'
  | 'tactical'
  | 'setpieces'
  | 'recovery';

export interface ActivityEffects {
  energy?: number;
  morale?: number;
  fitness?: number;
  sharpness?: number;
  professionalism?: number;
  social?: number;
  romance?: number;
  family?: number;
  home?: number;
  moneyHappy?: number;
  football?: number;
  repLocal?: number;
  followers?: number;
  /** relieves accumulated mental fatigue */
  relax?: number;
  /** extra training XP by session type (scaled like a session) */
  train?: Partial<Record<TrainingKey, number>>;
  /** probability of a small knock */
  injuryRisk?: number;
  /** overnight recovery multiplier for the following night */
  sleepPenalty?: number;
  coach?: number;
  teammates?: number;
}

export interface ActivityDef {
  key: string;
  name: string;
  venue: VenueKey;
  desc: string;
  /** allowed slots (0 morning, 1 afternoon, 2 evening) */
  slots: (0 | 1 | 2)[];
  /** money at cost-of-living 1.0 */
  cost: number;
  effects: ActivityEffects;
  /** handled by custom code in life.ts */
  special?:
    | 'extra_training'
    | 'rehab'
    | 'study'
    | 'school'
    | 'call_family'
    | 'visit_family'
    | 'date'
    | 'partner_time'
    | 'teammates'
    | 'friends'
    | 'post'
    | 'agent'
    | 'charity'
    | 'sponsor'
    | 'hobby'
    | 'party'
    | 'night_out'
    | 'meet_people'
    | 'fan_event'
    | 'shopping';
  /** requirement tag checked in life.ts */
  requires?: 'injured' | 'fit' | 'partner' | 'dating' | 'agent' | 'enrolled' | 'student' | 'house' | 'fame' | 'sponsor' | 'adult' | 'hobby' | 'hometown' | 'away' | 'kids';
}

export const ACTIVITIES: ActivityDef[] = [
  // home
  { key: 'rest', name: 'Rest & recover', venue: 'home', desc: 'Feet up. Recovers energy.', slots: [0, 1, 2], cost: 0, effects: { energy: -16, relax: 6, morale: 0.5 } },
  { key: 'nap', name: 'Afternoon nap', venue: 'home', desc: 'Forty minutes that change the day.', slots: [1], cost: 0, effects: { energy: -22, relax: 2 } },
  { key: 'early_night', name: 'Early night', venue: 'home', desc: 'Sleep is the best supplement.', slots: [2], cost: 0, effects: { energy: -10, professionalism: 0.4, sleepPenalty: 1.12, social: -0.5 } },
  { key: 'gaming', name: 'Gaming session', venue: 'home', desc: 'Online with the lads. "One more game."', slots: [1, 2], cost: 0, effects: { energy: -4, morale: 2.5, social: 2, relax: 8, sleepPenalty: 0.95 } },
  { key: 'footage', name: 'Study match footage', venue: 'home', desc: 'Watch your last games and the next opponent.', slots: [1, 2], cost: 0, effects: { energy: 3, professionalism: 0.5, train: { tactical: 0.45 }, coach: 0.3 } },
  { key: 'cook', name: 'Cook a healthy meal', venue: 'home', desc: 'Proper fuel, made by you.', slots: [1, 2], cost: 15, effects: { energy: 2, fitness: 0.4, professionalism: 0.2, morale: 0.5 } },
  { key: 'call_family', name: 'Call your family', venue: 'home', desc: 'A long chat with home.', slots: [1, 2], cost: 0, effects: { energy: -2, family: 9, morale: 1.5, relax: 3 }, special: 'call_family' },
  { key: 'social_post', name: 'Post on social media', venue: 'home', desc: 'Share a moment with your followers.', slots: [0, 1, 2], cost: 0, effects: { energy: 1 }, special: 'post' },
  { key: 'hobby', name: 'Practise your hobby', venue: 'home', desc: 'Guitar, chess, painting — whatever keeps you sane.', slots: [1, 2], cost: 5, effects: { energy: 2, morale: 2, relax: 10 }, special: 'hobby', requires: 'hobby' },
  { key: 'host_party', name: 'Host a party', venue: 'home', desc: 'Your place, your playlist, your neighbours\' complaints.', slots: [2], cost: 400, effects: { energy: 18, social: 12, morale: 4, professionalism: -1.5, sleepPenalty: 0.75, teammates: 3, followers: 0.002 }, special: 'party', requires: 'house' },
  { key: 'family_time', name: 'Time with the kids', venue: 'home', desc: 'Building blocks, cartoons, bath time and one more bedtime story.', slots: [1, 2], cost: 10, effects: { energy: 4, family: 10, morale: 3, relax: 9, romance: 2 }, requires: 'kids' },
  { key: 'partner_night', name: 'Quiet night with your partner', venue: 'home', desc: 'Dinner, a series and each other.', slots: [2], cost: 20, effects: { energy: -6, romance: 8, morale: 2, relax: 8 }, special: 'partner_time', requires: 'partner' },

  // family
  { key: 'visit_family', name: 'Visit your family', venue: 'family', desc: 'Dinner at your parents\' place.', slots: [1, 2], cost: 20, effects: { energy: 2, family: 14, morale: 3, relax: 10 }, special: 'visit_family', requires: 'hometown' },
  { key: 'trip_home', name: 'Trip back home', venue: 'family', desc: 'Train or flight home for a few hours with family and old friends.', slots: [1], cost: 180, effects: { energy: 14, family: 18, social: 6, morale: 4, relax: 12 }, special: 'visit_family', requires: 'away' },

  // training ground
  { key: 'extra_training', name: 'Extra training session', venue: 'training', desc: 'Choose a focus and put in the work.', slots: [1], cost: 0, effects: {}, special: 'extra_training', requires: 'fit' },
  { key: 'analysis', name: 'Video analysis with coaches', venue: 'training', desc: 'The staff love a player who asks questions.', slots: [1], cost: 0, effects: { energy: 4, train: { tactical: 0.7 }, coach: 1.2, professionalism: 0.6 } },
  { key: 'rehab', name: 'Rehab session', venue: 'training', desc: 'Physio-led recovery work.', slots: [0, 1], cost: 0, effects: { energy: 6, professionalism: 0.4 }, special: 'rehab', requires: 'injured' },
  { key: 'set_piece_practice', name: 'Stay behind: set pieces', venue: 'training', desc: 'Free kicks and corners after everyone left.', slots: [1], cost: 0, effects: { energy: 10, train: { setpieces: 0.9 }, coach: 0.4 }, requires: 'fit' },

  // gym
  { key: 'gym_strength', name: 'Weights session', venue: 'gym', desc: 'Squats, deadlifts and core.', slots: [0, 1, 2], cost: 12, effects: { energy: 16, train: { strength: 0.9 } }, requires: 'fit' },
  { key: 'gym_cardio', name: 'Cardio & conditioning', venue: 'gym', desc: 'Intervals on the bike and rower.', slots: [0, 1, 2], cost: 12, effects: { energy: 17, train: { fitness: 0.9 }, fitness: 0.6 }, requires: 'fit' },
  { key: 'personal_trainer', name: 'Personal trainer', venue: 'gym', desc: 'One-to-one, tailored, expensive.', slots: [1, 2], cost: 120, effects: { energy: 18, train: { speed: 0.6, strength: 0.6 }, professionalism: 0.4 }, requires: 'fit' },
  { key: 'yoga', name: 'Yoga class', venue: 'gym', desc: 'Flexibility, breathing, balance.', slots: [0, 1, 2], cost: 15, effects: { energy: 4, train: { recovery: 0.8 }, relax: 8, morale: 1 } },

  // park
  { key: 'park_run', name: 'Run in the park', venue: 'park', desc: 'Easy kilometres in fresh air.', slots: [0, 1], cost: 0, effects: { energy: 10, train: { fitness: 0.5 }, relax: 4 }, requires: 'fit' },
  { key: 'kickabout', name: 'Kickabout with locals', venue: 'park', desc: 'Jumpers for goalposts. The kids will never forget it.', slots: [1], cost: 0, effects: { energy: 9, train: { ballcontrol: 0.35 }, morale: 3, repLocal: 0.6, followers: 0.001, injuryRisk: 0.008 }, requires: 'fit' },
  { key: 'walk', name: 'Walk in the park', venue: 'park', desc: 'Headphones in, head clear.', slots: [0, 1, 2], cost: 0, effects: { energy: -3, relax: 10, morale: 1.5 } },

  // restaurant
  { key: 'team_dinner', name: 'Dinner with teammates', venue: 'restaurant', desc: 'Pasta, stories and dressing-room bonding.', slots: [2], cost: 60, effects: { energy: 3, social: 6, morale: 2, teammates: 3 }, special: 'teammates' },
  { key: 'dinner_date', name: 'Dinner date', venue: 'restaurant', desc: 'Candles, conversation, a nervous tip.', slots: [2], cost: 90, effects: { energy: 3, romance: 10, morale: 3 }, special: 'date', requires: 'dating' },
  { key: 'fine_dining', name: 'Fine dining', venue: 'restaurant', desc: 'Tasting menu at the place everyone posts about.', slots: [2], cost: 300, effects: { energy: 2, morale: 3, followers: 0.001, moneyHappy: -0.5 } },

  // nightlife
  { key: 'night_out', name: 'Night out', venue: 'nightclub', desc: 'Dancing until late. What could go wrong?', slots: [2], cost: 150, effects: { energy: 26, social: 12, morale: 5, professionalism: -2.2, fitness: -1.2, sleepPenalty: 0.6, relax: 14, teammates: 1 }, special: 'night_out', requires: 'adult' },
  { key: 'vip_night', name: 'VIP table', venue: 'nightclub', desc: 'Bottles, celebrities and cameras.', slots: [2], cost: 1500, effects: { energy: 24, social: 10, morale: 5, professionalism: -3, fitness: -1.2, sleepPenalty: 0.6, followers: 0.004, relax: 12 }, special: 'night_out', requires: 'fame' },
  { key: 'bar', name: 'Drinks at a quiet bar', venue: 'nightclub', desc: 'A couple of drinks and good company.', slots: [2], cost: 50, effects: { energy: 8, social: 6, morale: 2, professionalism: -0.5, sleepPenalty: 0.9, relax: 8 }, special: 'meet_people', requires: 'adult' },

  // cafe
  { key: 'coffee_friends', name: 'Coffee with friends', venue: 'cafe', desc: 'Catch up with your mates outside football.', slots: [0, 1, 2], cost: 12, effects: { energy: 1, social: 7, morale: 2, relax: 6 }, special: 'friends' },
  { key: 'quiz_night', name: 'Quiz night', venue: 'cafe', desc: 'Your team is called "Offside Trap".', slots: [2], cost: 20, effects: { energy: 4, social: 6, morale: 2, relax: 6 }, special: 'meet_people' },

  // mall
  { key: 'shopping', name: 'Go shopping', venue: 'mall', desc: 'New trainers, new jacket, new you.', slots: [1, 2], cost: 250, effects: { energy: 5, morale: 3, relax: 4 }, special: 'shopping' },
  { key: 'gift', name: 'Buy a gift for someone', venue: 'mall', desc: 'Something for family or your partner.', slots: [1, 2], cost: 150, effects: { energy: 3, family: 4, romance: 5, morale: 1 } },

  // school / college
  { key: 'school', name: 'Attend school', venue: 'school', desc: 'Maths, languages and a teacher who supports the rivals.', slots: [1], cost: 0, effects: { energy: 8, professionalism: 0.3, family: 1 }, special: 'school', requires: 'student' },
  { key: 'study', name: 'Study your course', venue: 'school', desc: 'Lectures and assignments for your enrolled course.', slots: [1, 2], cost: 25, effects: { energy: 7 }, special: 'study', requires: 'enrolled' },

  // agent / media
  { key: 'sponsor_duty', name: 'Sponsor appearance', venue: 'agent', desc: 'Photo shoot or launch event for your sponsor.', slots: [1, 2], cost: 0, effects: { energy: 9, followers: 0.003 }, special: 'sponsor', requires: 'sponsor' },
  { key: 'podcast', name: 'Guest on a podcast', venue: 'agent', desc: 'An hour of chat about football and life.', slots: [1, 2], cost: 0, effects: { energy: 5, followers: 0.004, repLocal: 0.4 }, requires: 'fame' },
  { key: 'meet_agent', name: 'Meet your agent', venue: 'agent', desc: 'Talk contracts, clubs and sponsors.', slots: [1], cost: 0, effects: { energy: 3 }, special: 'agent', requires: 'agent' },

  // clinic
  { key: 'physio', name: 'Physio & massage', venue: 'clinic', desc: 'Loosen up and prevent injuries.', slots: [0, 1, 2], cost: 80, effects: { energy: -8, fitness: 0.8, relax: 4, train: { recovery: 0.5 } } },
  { key: 'cryo', name: 'Cryotherapy', venue: 'clinic', desc: 'Three minutes at -110°C.', slots: [0, 1], cost: 150, effects: { energy: -12, fitness: 0.5, train: { recovery: 0.6 } } },
  { key: 'spa', name: 'Spa afternoon', venue: 'clinic', desc: 'Sauna, pool and a very soft robe.', slots: [1, 2], cost: 180, effects: { energy: -14, morale: 3, relax: 16 } },

  // community
  { key: 'hospital_visit', name: 'Visit a children\'s hospital', venue: 'community', desc: 'Signed shirts and brave kids. Puts everything in perspective.', slots: [1], cost: 0, effects: { energy: 5, morale: 3, repLocal: 1.5, followers: 0.002, professionalism: 0.3 }, special: 'charity' },
  { key: 'coach_kids', name: 'Coach a youth team', venue: 'community', desc: 'Grassroots football with local kids.', slots: [1, 2], cost: 0, effects: { energy: 7, morale: 2, repLocal: 1, train: { tactical: 0.2 } }, special: 'charity' },

  // beach
  { key: 'beach_day', name: 'Beach afternoon', venue: 'beach', desc: 'Sand, sea, ice cream.', slots: [1], cost: 20, effects: { energy: -6, morale: 4, relax: 14, social: 2 } },
  { key: 'surf', name: 'Surf lesson', venue: 'beach', desc: 'Balance and humility.', slots: [0, 1], cost: 60, effects: { energy: 12, morale: 3, relax: 8, train: { speed: 0.2 }, injuryRisk: 0.012 }, requires: 'fit' },

  // stadium
  { key: 'fan_event', name: 'Club fan event', venue: 'stadium', desc: 'Autographs and selfies with supporters.', slots: [1, 2], cost: 0, effects: { energy: 6, repLocal: 1.2, followers: 0.003, morale: 1.5 }, special: 'fan_event' },
  { key: 'watch_game', name: 'Watch a live match', venue: 'stadium', desc: 'Scout the league from the stands.', slots: [2], cost: 30, effects: { energy: 4, train: { tactical: 0.35 }, social: 2, relax: 5 } },

  // golf
  { key: 'golf', name: 'Round of golf', venue: 'golf', desc: 'Four hours, too many shots, great chat.', slots: [1], cost: 120, effects: { energy: 7, morale: 3, social: 4, relax: 12, teammates: 2 }, special: 'teammates' },

  // culture
  { key: 'cinema', name: 'Cinema', venue: 'culture', desc: 'The big new blockbuster.', slots: [2], cost: 20, effects: { energy: 1, morale: 2, relax: 8, social: 2 } },
  { key: 'concert', name: 'Concert', venue: 'culture', desc: 'Live music, loud crowd — the other kind.', slots: [2], cost: 90, effects: { energy: 10, morale: 4, social: 5, relax: 10, sleepPenalty: 0.9 }, special: 'meet_people' },
  { key: 'museum', name: 'Museum visit', venue: 'culture', desc: 'Culture, quiet and inspiration.', slots: [0, 1], cost: 15, effects: { energy: 4, morale: 2, relax: 10 } },
];

export function activityDef(key: string): ActivityDef | undefined {
  return ACTIVITIES.find((a) => a.key === key);
}

// ----- club training (morning sessions set by the coach)

export interface TrainingDef {
  key: TrainingKey;
  name: string;
  desc: string;
  /** stat weights (indices into STAT_NAMES) */
  stats: [string, number][];
  energy: number;
  injury: number;
  sharpness: number;
  fitness: number;
}

export const TRAINING: TrainingDef[] = [
  { key: 'fitness', name: 'Fitness & endurance', desc: 'Intervals, long runs and conditioning games.', stats: [['physical_stamina', 1], ['mental_workrate', 0.5], ['mental_resilience', 0.3]], energy: 22, injury: 1.0, sharpness: 1, fitness: 2.2 },
  { key: 'speed', name: 'Speed & agility', desc: 'Sprints, ladders, cones and reaction drills.', stats: [['physical_acceleration', 1], ['physical_velocity', 0.8], ['physical_agility', 0.8], ['physical_reaction', 0.5]], energy: 20, injury: 1.25, sharpness: 1.5, fitness: 1 },
  { key: 'strength', name: 'Strength & gym', desc: 'Weights, core and power work.', stats: [['physical_balance', 1], ['physical_shotpower', 0.7], ['technical_header', 0.3], ['mental_resilience', 0.2]], energy: 18, injury: 0.9, sharpness: 0.5, fitness: 1.2 },
  { key: 'ballcontrol', name: 'Ball control & dribbling', desc: 'Rondos, first touch and 1v1 work.', stats: [['technical_ballcontrol', 1], ['technical_dribble', 0.9], ['physical_agility', 0.3], ['mental_calmness', 0.2]], energy: 14, injury: 0.8, sharpness: 2, fitness: 0.6 },
  { key: 'passing', name: 'Passing & vision', desc: 'Passing patterns, switches and through balls.', stats: [['technical_shortpass', 1], ['technical_highpass', 0.8], ['mental_vision', 0.8], ['technical_ballcontrol', 0.2]], energy: 12, injury: 0.6, sharpness: 2, fitness: 0.5 },
  { key: 'finishing', name: 'Finishing', desc: 'Shooting drills, volleys and runs into the box.', stats: [['technical_shot', 1], ['technical_volley', 0.7], ['physical_shotpower', 0.5], ['mental_offensivepositioning', 0.5], ['mental_calmness', 0.3]], energy: 15, injury: 0.8, sharpness: 2, fitness: 0.5 },
  { key: 'defending', name: 'Defending', desc: 'Tackling, blocking, marking and shape.', stats: [['technical_standingtackle', 1], ['technical_slidingtackle', 0.8], ['mental_defensivepositioning', 0.8], ['technical_header', 0.4], ['physical_balance', 0.2]], energy: 17, injury: 1.1, sharpness: 1.8, fitness: 0.8 },
  { key: 'goalkeeping', name: 'Goalkeeping', desc: 'Shot-stopping, handling, distribution and positioning.', stats: [['physical_reaction', 1], ['physical_agility', 0.7], ['mental_defensivepositioning', 0.8], ['technical_highpass', 0.4], ['physical_balance', 0.3]], energy: 15, injury: 0.9, sharpness: 2, fitness: 0.6 },
  { key: 'tactical', name: 'Tactical', desc: 'Shape, pressing triggers and movement off the ball.', stats: [['mental_offensivepositioning', 0.8], ['mental_defensivepositioning', 0.8], ['mental_vision', 0.6], ['mental_workrate', 0.4], ['mental_calmness', 0.3]], energy: 9, injury: 0.4, sharpness: 1.2, fitness: 0.3 },
  { key: 'setpieces', name: 'Set pieces', desc: 'Free kicks, corners, penalties and routines.', stats: [['technical_shot', 0.6], ['technical_highpass', 0.7], ['technical_header', 0.6], ['technical_volley', 0.4], ['mental_calmness', 0.5]], energy: 8, injury: 0.4, sharpness: 1, fitness: 0.2 },
  { key: 'recovery', name: 'Recovery', desc: 'Pool, stretching, massage. Light and restorative.', stats: [['mental_resilience', 0.3], ['physical_balance', 0.1]], energy: -12, injury: 0.2, sharpness: -0.3, fitness: 0.8 },
];

export function trainingDef(key: TrainingKey): TrainingDef {
  return TRAINING.find((t) => t.key === key)!;
}

export const INTENSITY_NAMES = ['Light', 'Normal', 'Hard'] as const;
export const INTENSITY: { xp: number; energy: number; injury: number; coach: number }[] = [
  { xp: 0.6, energy: 0.6, injury: 0.5, coach: -0.4 },
  { xp: 1.0, energy: 1.0, injury: 1.0, coach: 0.1 },
  { xp: 1.4, energy: 1.45, injury: 1.9, coach: 0.5 },
];

// ----- education

export interface CourseDef {
  key: string;
  name: string;
  desc: string;
  sessions: number;
  costPerSession: number;
  minAge: number;
  requires?: string;
  unlocks: string;
}

export const COURSES: CourseDef[] = [
  { key: 'sports_science', name: 'Sports Science diploma', desc: 'Physiology, nutrition and training theory. +5% training efficiency once completed.', sessions: 60, costPerSession: 40, minAge: 16, unlocks: 'fitness coach / physio' },
  { key: 'business', name: 'Business Management', desc: 'Finance, marketing and entrepreneurship. Better investment returns.', sessions: 70, costPerSession: 60, minAge: 17, unlocks: 'business career' },
  { key: 'media', name: 'Media & Communication', desc: 'Interviews, broadcasting and social media strategy.', sessions: 50, costPerSession: 50, minAge: 17, unlocks: 'pundit / broadcaster' },
  { key: 'language', name: 'Language course', desc: 'Learn the local language — settling abroad gets much easier.', sessions: 40, costPerSession: 30, minAge: 15, unlocks: 'settled abroad' },
  { key: 'coach_c', name: 'Coaching Licence C', desc: 'Grassroots coaching fundamentals.', sessions: 30, costPerSession: 30, minAge: 18, unlocks: 'youth coaching' },
  { key: 'coach_b', name: 'Coaching Licence B', desc: 'Session design and team management.', sessions: 45, costPerSession: 60, minAge: 21, requires: 'coach_c', unlocks: 'assistant coach' },
  { key: 'coach_a', name: 'Coaching Licence A', desc: 'Senior tactics, leadership and analysis.', sessions: 60, costPerSession: 110, minAge: 25, requires: 'coach_b', unlocks: 'head coach (lower leagues)' },
  { key: 'coach_pro', name: 'Pro Licence', desc: 'The top badge: manage anywhere in the world.', sessions: 80, costPerSession: 200, minAge: 29, requires: 'coach_a', unlocks: 'head coach (top flight)' },
];

// ----- hobbies

export interface HobbyDef {
  key: string;
  name: string;
  desc: string;
  /** micro stat xp per session: [stat, amount] */
  stat?: [string, number];
  followers?: number;
  price: number;
}

export const HOBBIES: HobbyDef[] = [
  { key: 'guitar', name: 'Guitar', desc: 'Strum away the nerves.', stat: ['mental_calmness', 0.0006], price: 300 },
  { key: 'chess', name: 'Chess', desc: 'Think three moves ahead — on and off the pitch.', stat: ['mental_vision', 0.0007], price: 40 },
  { key: 'painting', name: 'Painting', desc: 'Canvas, colours and quiet hours.', stat: ['mental_resilience', 0.0005], price: 150 },
  { key: 'cooking', name: 'Cooking', desc: 'Become your own nutritionist.', price: 200 },
  { key: 'photography', name: 'Photography', desc: 'Your feed has never looked better.', followers: 0.004, price: 900 },
  { key: 'fishing', name: 'Fishing', desc: 'Patience, water and silence.', stat: ['mental_calmness', 0.0005], price: 250 },
  { key: 'dj', name: 'DJing', desc: 'Decks in the living room, dreams of a festival set.', followers: 0.003, price: 700 },
  { key: 'esports', name: 'Competitive gaming', desc: 'Grind the rankings, stream to your fans.', followers: 0.005, price: 1200 },
];

// ----- brands (sponsorship) and agents

export const BRANDS: { brand: string; category: string; tier: number }[] = [
  { brand: 'Stryde', category: 'Boots', tier: 3 },
  { brand: 'Volta Energy', category: 'Energy drink', tier: 2 },
  { brand: 'Kinetik Sportswear', category: 'Sportswear', tier: 3 },
  { brand: 'Aurum Watches', category: 'Watches', tier: 4 },
  { brand: 'Helix Mobile', category: 'Telecom', tier: 2 },
  { brand: 'Nimbus Gaming', category: 'Gaming', tier: 2 },
  { brand: 'Brava Burgers', category: 'Fast food', tier: 1 },
  { brand: 'Pioneer Motors', category: 'Cars', tier: 4 },
  { brand: 'Maison Lune', category: 'Fashion', tier: 4 },
  { brand: 'ZipBet', category: 'Betting', tier: 2 },
  { brand: 'Crestline Headphones', category: 'Audio', tier: 3 },
  { brand: 'FreshFuel', category: 'Nutrition', tier: 1 },
  { brand: 'Local Motors Garage', category: 'Local business', tier: 0 },
  { brand: 'Corner Bakery', category: 'Local business', tier: 0 },
];

export const CLUB_SPONSORS = ['Aurum Bank', 'Helix Mobile', 'Solaris Air', 'Pioneer Motors', 'Nimbus Cloud', 'Vertex Insurance', 'Orbit Telecom', 'Lumen Tech', 'Titan Tyres', 'Marlin Foods', 'Harbour Freight', 'Quasar Games', 'Brava Beer', 'Northwind Energy', 'Crimson Coffee', 'Atlas Logistics', 'Evergreen Bank', 'Summit Paints', 'Coral Cruises', 'Keystone Builders'];

export const INVESTMENTS: { key: string; name: string; risk: number; desc: string }[] = [
  { key: 'savings', name: 'Savings account', risk: 0.02, desc: 'Safe and dull. ~2% a year.' },
  { key: 'index', name: 'Index fund', risk: 0.15, desc: 'The whole market. ~6% a year, with bumps.' },
  { key: 'property_fund', name: 'Property fund', risk: 0.2, desc: 'Bricks and mortar. Steady-ish.' },
  { key: 'startup', name: 'Friend\'s start-up', risk: 0.6, desc: 'A mate from school swears it is the next big thing.' },
  { key: 'crypto', name: 'Crypto coins', risk: 0.9, desc: 'To the moon. Or not.' },
];
