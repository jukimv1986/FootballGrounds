// Static world data: countries (the 4 of the shipped database plus a few more), their cities
// with character (cost of living, vibe, districts) and competition names. Cities are real places
// but every club name in the career is fictional.

export interface DistrictDef {
  name: string;
  /** 0 (tough) .. 1 (exclusive): drives housing prices and prestige */
  prestige: number;
  /** minutes to the training ground (average) */
  commute: number;
  /** 0 .. 1: nightlife and things to do */
  fun: number;
  /** 0 .. 1: calm, sleep quality */
  calm: number;
  blurb: string;
}

export interface CityDef {
  name: string;
  /** relative cost of living (1 = average) */
  cost: number;
  /** 0..1 how big / cosmopolitan (venue variety, media pressure) */
  size: number;
  coastal?: boolean;
  blurb: string;
  districts?: DistrictDef[];
}

export interface CountryDef {
  key: string;
  name: string;
  /** database country id when the country comes from the shipped database */
  dbCountryId?: number;
  demonym: string;
  /** club naming patterns, {c} = city */
  clubPatterns: string[];
  leagueNames: [string, string];
  cupName: string;
  /** relative league strength (1 = strongest) */
  strength: number;
  /** winter break (weeks with no football around new year) */
  winterBreak: boolean;
  /** tax rate on wages */
  tax: number;
  currency: string;
  cities: CityDef[];
  /** national team kit colors */
  colors: [[number, number, number], [number, number, number]];
  language: string;
}

/** countries that only exist as nationalities / national teams (no league simulated) */
export interface NationDef {
  key: string;
  name: string;
  demonym: string;
  /** national team strength 0..1 */
  strength: number;
  colors: [[number, number, number], [number, number, number]];
}

// Generic district archetypes, renamed per city for flavour.
const DISTRICT_TEMPLATES: Omit<DistrictDef, 'name'>[] = [
  { prestige: 0.2, commute: 25, fun: 0.55, calm: 0.35, blurb: 'Working-class streets near the old ground. Cheap, loud and loyal.' },
  { prestige: 0.45, commute: 30, fun: 0.9, calm: 0.2, blurb: 'The lively centre: bars, clubs, restaurants — and paparazzi.' },
  { prestige: 0.6, commute: 15, fun: 0.35, calm: 0.8, blurb: 'Leafy suburbs close to the training ground. Quiet and sensible.' },
  { prestige: 0.95, commute: 35, fun: 0.5, calm: 0.9, blurb: 'Gated villas and private drives where the stars live.' },
];

const DISTRICT_NAMES: Record<string, string[]> = {
  default: ['Old Town', 'City Centre', 'Parkside', 'The Hills'],
  England: ['Eastgate', 'Soho Quarter', 'Greenfields', 'Kingsmere'],
  Germany: ['Altstadt', 'Mitte', 'Grünwald', 'Villenviertel'],
  Holland: ['Oude Wijk', 'Centrum', 'Buitenveld', 'Het Gooi'],
  Spain: ['Barrio Viejo', 'Centro', 'Las Arboledas', 'La Moraleja'],
  Italy: ['Borgo Vecchio', 'Centro Storico', 'I Giardini', 'Collina d\'Oro'],
  France: ['Vieux Quartier', 'Centre-Ville', 'Les Jardins', 'Les Hauts'],
  Portugal: ['Bairro Antigo', 'Baixa', 'Jardins', 'Quinta Alta'],
};

export function districtsFor(country: CountryDef, city: CityDef): DistrictDef[] {
  if (city.districts) return city.districts;
  const names = DISTRICT_NAMES[country.name] ?? DISTRICT_NAMES.default;
  return DISTRICT_TEMPLATES.map((t, i) => ({ ...t, name: names[i] }));
}

export const COUNTRIES: CountryDef[] = [
  {
    key: 'ENG',
    name: 'England',
    dbCountryId: 1,
    demonym: 'English',
    clubPatterns: ['{c} United', '{c} City', '{c} Town', '{c} Rovers', '{c} Athletic', '{c} Albion', '{c} Wanderers', 'AFC {c}', '{c} County', '{c} Borough'],
    leagueNames: ["King's League", 'The Championship'],
    cupName: 'Kingdom Cup',
    strength: 1.0,
    winterBreak: false,
    tax: 0.45,
    currency: '£',
    colors: [[255, 255, 255], [30, 40, 110]],
    language: 'English',
    cities: [
      { name: 'London', cost: 1.6, size: 1, blurb: 'A megacity with a club on every corner and a tabloid on every newsstand.' },
      { name: 'Manchester', cost: 1.1, size: 0.8, blurb: 'Rain, music and football — a city that breathes the game.' },
      { name: 'Liverpool', cost: 1.0, size: 0.7, coastal: true, blurb: 'A proud port city with deafening terraces.' },
      { name: 'Birmingham', cost: 1.0, size: 0.75, blurb: 'The Midlands giant: canals, curry mile and derby-day tension.' },
      { name: 'Leeds', cost: 0.95, size: 0.6, blurb: 'A Yorkshire city that never forgets the good old days.' },
      { name: 'Newcastle', cost: 0.9, size: 0.55, coastal: true, blurb: 'One-club passion, bridges and a famous night out.' },
      { name: 'Bristol', cost: 1.05, size: 0.55, coastal: true, blurb: 'Creative, hilly and harbour-side.' },
      { name: 'Sheffield', cost: 0.85, size: 0.55, blurb: 'Steel city: hills, parks and the oldest football traditions.' },
      { name: 'Nottingham', cost: 0.9, size: 0.5, blurb: 'Castle, caves and a trophy cabinet older than most.' },
      { name: 'Southampton', cost: 1.0, size: 0.45, coastal: true, blurb: 'A south-coast port that develops great youngsters.' },
      { name: 'Brighton', cost: 1.2, size: 0.45, coastal: true, blurb: 'Seaside, pier and a laid-back crowd.' },
      { name: 'Leicester', cost: 0.9, size: 0.5, blurb: 'A city that believes in fairy tales.' },
      { name: 'Norwich', cost: 0.9, size: 0.35, blurb: 'Quiet cathedral city with a canary-yellow heart.' },
      { name: 'Ipswich', cost: 0.85, size: 0.3, blurb: 'A small town with big footballing memories.' },
      { name: 'Portsmouth', cost: 0.9, size: 0.4, coastal: true, blurb: 'Navy town with the loudest drum in England.' },
      { name: 'Hull', cost: 0.75, size: 0.35, coastal: true, blurb: 'A windswept estuary city, gritty and warm.' },
      { name: 'Derby', cost: 0.8, size: 0.35, blurb: 'Railway town, rams and a fierce rivalry up the road.' },
      { name: 'Coventry', cost: 0.8, size: 0.4, blurb: 'Rebuilt spires and a sky-blue spirit.' },
      { name: 'Plymouth', cost: 0.8, size: 0.3, coastal: true, blurb: 'A far-flung naval city by the sea.' },
      { name: 'Reading', cost: 1.1, size: 0.35, blurb: 'Commuter town with a royal feel.' },
      { name: 'Sunderland', cost: 0.75, size: 0.35, coastal: true, blurb: 'Shipbuilders, sea air and red-and-white stripes.' },
      { name: 'Stoke', cost: 0.75, size: 0.3, blurb: 'Pottery town where cold wet nights are a tactic.' },
      { name: 'Bolton', cost: 0.75, size: 0.3, blurb: 'A proud Lancashire mill town.' },
      { name: 'Blackburn', cost: 0.7, size: 0.25, blurb: 'Small town, big former glory.' },
    ],
  },
  {
    key: 'GER',
    name: 'Germany',
    dbCountryId: 2,
    demonym: 'German',
    clubPatterns: ['FC {c}', 'SV {c}', 'VfB {c}', 'Eintracht {c}', 'Fortuna {c}', 'SpVgg {c}', '1. FC {c}', 'TSV {c}', 'VfL {c}', 'Union {c}'],
    leagueNames: ['Fussball League', '2. Fussball League'],
    cupName: 'Pokal',
    strength: 0.95,
    winterBreak: true,
    tax: 0.42,
    currency: '€',
    colors: [[255, 255, 255], [20, 20, 20]],
    language: 'German',
    cities: [
      { name: 'Munich', cost: 1.45, size: 0.8, blurb: 'Beer gardens, Alps on the horizon and a hunger for trophies.' },
      { name: 'Dortmund', cost: 0.95, size: 0.55, blurb: 'Coal, steel and the famous yellow wall.' },
      { name: 'Berlin', cost: 1.2, size: 1, blurb: 'Capital of techno, history and a football scene finding itself.' },
      { name: 'Hamburg', cost: 1.25, size: 0.8, coastal: true, blurb: 'Harbour city with a legendary nightlife district.' },
      { name: 'Cologne', cost: 1.1, size: 0.7, blurb: 'Cathedral, carnival and goats.' },
      { name: 'Frankfurt', cost: 1.3, size: 0.7, blurb: 'Skyscrapers, bankers and wild European nights.' },
      { name: 'Stuttgart', cost: 1.25, size: 0.6, blurb: 'Cars, hills and Swabian thrift.' },
      { name: 'Düsseldorf', cost: 1.2, size: 0.6, blurb: 'Fashion, old-town bars and the Rhine.' },
      { name: 'Bremen', cost: 1.0, size: 0.5, coastal: true, blurb: 'A Hanseatic city of musicians and green-white hearts.' },
      { name: 'Leipzig', cost: 0.9, size: 0.55, blurb: 'Young, cheap and fast-rising.' },
      { name: 'Hannover', cost: 1.0, size: 0.5, blurb: 'Trade fairs and a lake at the heart of it all.' },
      { name: 'Nuremberg', cost: 1.0, size: 0.5, blurb: 'Gingerbread, castles and a proud old club culture.' },
      { name: 'Freiburg', cost: 1.05, size: 0.35, blurb: 'Sunny, green, a university town in the Black Forest.' },
      { name: 'Mainz', cost: 1.0, size: 0.3, blurb: 'Carnival capital with a cosy stadium.' },
      { name: 'Bochum', cost: 0.85, size: 0.35, blurb: 'Ruhr grit and loyal terraces.' },
      { name: 'Kaiserslautern', cost: 0.8, size: 0.25, blurb: 'A small town on a hill with a huge footballing soul.' },
      { name: 'Karlsruhe', cost: 0.95, size: 0.35, blurb: 'A fan-shaped city of lawyers and engineers.' },
      { name: 'Augsburg', cost: 0.95, size: 0.35, blurb: 'Bavaria\'s quieter, older sibling.' },
      { name: 'Bielefeld', cost: 0.85, size: 0.3, blurb: 'Does it even exist? The fans insist it does.' },
      { name: 'Rostock', cost: 0.8, size: 0.25, coastal: true, blurb: 'Baltic sea breeze and a hard-nosed crowd.' },
    ],
  },
  {
    key: 'NED',
    name: 'Holland',
    dbCountryId: 3,
    demonym: 'Dutch',
    clubPatterns: ['FC {c}', 'SC {c}', 'VV {c}', 'Sparta {c}', '{c} Boys', 'Go Ahead {c}', 'RKC {c}', 'SV {c}', 'Quick {c}', 'Vitesse {c}'],
    leagueNames: ['Voetbalcompetitie', 'Eerste Divisie'],
    cupName: 'Beker',
    strength: 0.78,
    winterBreak: true,
    tax: 0.49,
    currency: '€',
    colors: [[255, 120, 0], [255, 255, 255]],
    language: 'Dutch',
    cities: [
      { name: 'Amsterdam', cost: 1.45, size: 0.8, blurb: 'Canals, bikes and the most famous academy philosophy in the world.' },
      { name: 'Eindhoven', cost: 1.05, size: 0.45, blurb: 'Tech city built around a light-bulb factory and its club.' },
      { name: 'Rotterdam', cost: 1.1, size: 0.7, coastal: true, blurb: 'Port city of no-nonsense workers and bold architecture.' },
      { name: 'The Hague', cost: 1.15, size: 0.6, coastal: true, blurb: 'Diplomats, dunes and a fierce local crowd.' },
      { name: 'Utrecht', cost: 1.2, size: 0.5, blurb: 'A student city of canals and cafés.' },
      { name: 'Groningen', cost: 0.95, size: 0.4, blurb: 'The northern student capital.' },
      { name: 'Enschede', cost: 0.85, size: 0.35, blurb: 'Eastern city with a proud red-shirted club.' },
      { name: 'Alkmaar', cost: 1.0, size: 0.3, blurb: 'Cheese markets and a punchy footballing side.' },
      { name: 'Arnhem', cost: 0.95, size: 0.35, blurb: 'Green hills and a stadium with a sliding pitch.' },
      { name: 'Heerenveen', cost: 0.85, size: 0.2, blurb: 'A small Frisian town that punches above its weight.' },
      { name: 'Nijmegen', cost: 0.9, size: 0.35, blurb: 'The oldest city in Holland.' },
      { name: 'Tilburg', cost: 0.9, size: 0.35, blurb: 'Former textile town, now a festival hub.' },
      { name: 'Breda', cost: 0.95, size: 0.3, blurb: 'Southern charm and a castle.' },
      { name: 'Zwolle', cost: 0.9, size: 0.25, blurb: 'Hanseatic town with a growing club.' },
      { name: 'Maastricht', cost: 1.0, size: 0.3, blurb: 'Burgundian lifestyle at the southern tip.' },
      { name: 'Leeuwarden', cost: 0.85, size: 0.25, blurb: 'Frisian capital, quiet and proud.' },
      { name: 'Deventer', cost: 0.85, size: 0.2, blurb: 'A riverside book-market town.' },
      { name: 'Haarlem', cost: 1.2, size: 0.3, coastal: true, blurb: 'Charming city near the beach.' },
    ],
  },
  {
    key: 'ESP',
    name: 'Spain',
    dbCountryId: 4,
    demonym: 'Spanish',
    clubPatterns: ['Real {c}', '{c} CF', 'Atlético {c}', 'CD {c}', 'UD {c}', 'Deportivo {c}', 'Racing {c}', 'SD {c}', 'Sporting {c}', 'CF {c}'],
    leagueNames: ['La Liga', 'Segunda'],
    cupName: 'Copa de la Corona',
    strength: 0.98,
    winterBreak: false,
    tax: 0.45,
    currency: '€',
    colors: [[200, 20, 30], [255, 200, 0]],
    language: 'Spanish',
    cities: [
      { name: 'Madrid', cost: 1.3, size: 1, blurb: 'The capital: late dinners, royal expectations and white-hot pressure.' },
      { name: 'Barcelona', cost: 1.35, size: 0.9, coastal: true, blurb: 'Beaches, Gaudí and a club that is more than a club.' },
      { name: 'Valencia', cost: 1.0, size: 0.65, coastal: true, blurb: 'Paella, fireworks and a steep, roaring stadium.' },
      { name: 'Seville', cost: 0.95, size: 0.65, blurb: 'Flamenco, heat and the fiercest derby in Spain.' },
      { name: 'Bilbao', cost: 1.1, size: 0.5, coastal: true, blurb: 'Basque pride and a cathedral of football.' },
      { name: 'Málaga', cost: 1.0, size: 0.5, coastal: true, blurb: 'Sunshine coast and seaside promenades.' },
      { name: 'Zaragoza', cost: 0.85, size: 0.5, blurb: 'A big river city between Madrid and Barcelona.' },
      { name: 'Vigo', cost: 0.85, size: 0.4, coastal: true, blurb: 'Galician fishing port with Atlantic spirit.' },
      { name: 'San Sebastián', cost: 1.3, size: 0.35, coastal: true, blurb: 'Pintxos, surf and a famous academy.' },
      { name: 'Villarreal', cost: 0.75, size: 0.15, blurb: 'A tiny town with a yellow submarine.' },
      { name: 'Gijón', cost: 0.8, size: 0.3, coastal: true, blurb: 'Asturian coast, cider and loyal fans.' },
      { name: 'Santander', cost: 0.9, size: 0.3, coastal: true, blurb: 'Elegant northern bay city.' },
      { name: 'Valladolid', cost: 0.8, size: 0.35, blurb: 'Castilian city of wine and history.' },
      { name: 'Granada', cost: 0.8, size: 0.35, blurb: 'The Alhambra and free tapas.' },
      { name: 'Las Palmas', cost: 0.9, size: 0.4, coastal: true, blurb: 'Island football with year-round sun.' },
      { name: 'Cádiz', cost: 0.8, size: 0.25, coastal: true, blurb: 'Carnival and the oldest city in Western Europe.' },
      { name: 'Pamplona', cost: 0.9, size: 0.25, blurb: 'Bulls, fiestas and a stubborn club.' },
      { name: 'Oviedo', cost: 0.8, size: 0.25, blurb: 'A quiet, elegant Asturian capital.' },
      { name: 'Elche', cost: 0.75, size: 0.25, blurb: 'Palm groves and warm nights.' },
      { name: 'Córdoba', cost: 0.75, size: 0.3, blurb: 'Patios, mosques and summer heat.' },
    ],
  },
  {
    key: 'ITA',
    name: 'Italy',
    demonym: 'Italian',
    clubPatterns: ['AC {c}', '{c} Calcio', 'US {c}', 'SS {c}', 'Unione {c}', 'Virtus {c}', 'FC {c}', 'Atletico {c}', 'Sporting {c}', 'Real {c}'],
    leagueNames: ['Serie Alfa', 'Serie Beta'],
    cupName: 'Coppa Nazionale',
    strength: 0.92,
    winterBreak: true,
    tax: 0.43,
    currency: '€',
    colors: [[20, 80, 200], [255, 255, 255]],
    language: 'Italian',
    cities: [
      { name: 'Milan', cost: 1.4, size: 0.9, blurb: 'Fashion capital with a cathedral of a stadium shared by rivals.' },
      { name: 'Turin', cost: 1.1, size: 0.7, blurb: 'Elegant, industrial and obsessed with winning.' },
      { name: 'Rome', cost: 1.25, size: 1, blurb: 'The eternal city: history, passion and a derby that stops everything.' },
      { name: 'Naples', cost: 0.9, size: 0.8, coastal: true, blurb: 'Volcanic passion, pizza and worship of number tens.' },
      { name: 'Florence', cost: 1.2, size: 0.5, blurb: 'Renaissance art and purple pride.' },
      { name: 'Genoa', cost: 1.0, size: 0.55, coastal: true, blurb: 'Italy\'s oldest football city by the sea.' },
      { name: 'Bologna', cost: 1.05, size: 0.5, blurb: 'Porticoes, food and red-blue loyalty.' },
      { name: 'Bergamo', cost: 1.0, size: 0.3, blurb: 'Hilltop old town and a relentless academy.' },
      { name: 'Verona', cost: 1.0, size: 0.4, blurb: 'Romeo, Juliet and a Roman arena.' },
      { name: 'Palermo', cost: 0.8, size: 0.55, coastal: true, blurb: 'Sicilian markets and pink shirts.' },
      { name: 'Bari', cost: 0.8, size: 0.45, coastal: true, blurb: 'Southern port with a spaceship stadium.' },
      { name: 'Udine', cost: 0.9, size: 0.25, blurb: 'Quiet north-east town and a smart scouting club.' },
      { name: 'Parma', cost: 1.0, size: 0.3, blurb: 'Ham, cheese and a famous 90s side.' },
      { name: 'Cagliari', cost: 0.85, size: 0.35, coastal: true, blurb: 'Sardinian island life.' },
      { name: 'Lecce', cost: 0.75, size: 0.25, blurb: 'Baroque gem in the heel of the boot.' },
      { name: 'Empoli', cost: 0.85, size: 0.15, blurb: 'A small town that produces big talents.' },
      { name: 'Brescia', cost: 0.95, size: 0.35, blurb: 'Lombardy industry and blue shirts.' },
      { name: 'Salerno', cost: 0.8, size: 0.3, coastal: true, blurb: 'Amalfi coast gateway with loud stands.' },
    ],
  },
  {
    key: 'FRA',
    name: 'France',
    demonym: 'French',
    clubPatterns: ['{c} FC', 'Olympique {c}', 'AS {c}', 'Stade {c}', 'Racing {c}', 'US {c}', 'SC {c}', 'FC {c}', 'En Avant {c}', 'Girondins {c}'],
    leagueNames: ['Ligue Première', 'Ligue Seconde'],
    cupName: 'Coupe Nationale',
    strength: 0.88,
    winterBreak: true,
    tax: 0.47,
    currency: '€',
    colors: [[20, 40, 140], [255, 255, 255]],
    language: 'French',
    cities: [
      { name: 'Paris', cost: 1.55, size: 1, blurb: 'The city of light, glamour and ruthless ambition.' },
      { name: 'Marseille', cost: 1.0, size: 0.8, coastal: true, blurb: 'Mediterranean fire: the most passionate crowd in France.' },
      { name: 'Lyon', cost: 1.1, size: 0.7, blurb: 'Gastronomy capital with a production-line academy.' },
      { name: 'Lille', cost: 0.95, size: 0.55, blurb: 'Flemish charm and cold, loud nights.' },
      { name: 'Bordeaux', cost: 1.05, size: 0.55, blurb: 'Wine country and an elegant riverfront.' },
      { name: 'Nice', cost: 1.3, size: 0.45, coastal: true, blurb: 'Riviera sun, yachts and promenades.' },
      { name: 'Nantes', cost: 0.95, size: 0.5, blurb: 'Mechanical elephants and yellow canaries.' },
      { name: 'Rennes', cost: 0.95, size: 0.45, blurb: 'Breton capital with a sharp academy.' },
      { name: 'Saint-Étienne', cost: 0.75, size: 0.35, blurb: 'Mining town with a green cauldron of a stadium.' },
      { name: 'Montpellier', cost: 0.95, size: 0.45, blurb: 'Sunny student city in the south.' },
      { name: 'Strasbourg', cost: 1.0, size: 0.45, blurb: 'Half French, half German, all blue.' },
      { name: 'Lens', cost: 0.75, size: 0.2, blurb: 'Tiny mining town, one of the best atmospheres in Europe.' },
      { name: 'Toulouse', cost: 0.95, size: 0.55, blurb: 'The pink city of rugby and rockets.' },
      { name: 'Reims', cost: 0.9, size: 0.3, blurb: 'Champagne and a legendary 50s side.' },
      { name: 'Brest', cost: 0.85, size: 0.25, coastal: true, blurb: 'Atlantic storms at the end of the world.' },
      { name: 'Le Havre', cost: 0.85, size: 0.3, coastal: true, blurb: 'France\'s oldest club and a concrete port.' },
      { name: 'Auxerre', cost: 0.8, size: 0.15, blurb: 'A Burgundy village with a famous academy.' },
      { name: 'Metz', cost: 0.85, size: 0.3, blurb: 'Garrison town with a gothic cathedral.' },
    ],
  },
  {
    key: 'POR',
    name: 'Portugal',
    demonym: 'Portuguese',
    clubPatterns: ['Sporting {c}', 'FC {c}', 'SC {c}', 'CD {c}', 'União {c}', 'Desportivo {c}', 'Vitória {c}', 'Académica {c}', 'Atlético {c}', 'GD {c}'],
    leagueNames: ['Liga Portuguesa', 'Segunda Liga'],
    cupName: 'Taça Nacional',
    strength: 0.8,
    winterBreak: false,
    tax: 0.4,
    currency: '€',
    colors: [[200, 20, 40], [0, 110, 50]],
    language: 'Portuguese',
    cities: [
      { name: 'Lisbon', cost: 1.15, size: 0.9, coastal: true, blurb: 'Hills, trams, fado and a fierce city rivalry.' },
      { name: 'Porto', cost: 1.0, size: 0.7, coastal: true, blurb: 'Port wine, bridges and dragons.' },
      { name: 'Braga', cost: 0.8, size: 0.35, blurb: 'A religious city with a stadium carved into a quarry.' },
      { name: 'Guimarães', cost: 0.75, size: 0.25, blurb: 'The birthplace of Portugal, fanatical support.' },
      { name: 'Coimbra', cost: 0.8, size: 0.3, blurb: 'Ancient university town of black capes.' },
      { name: 'Funchal', cost: 0.9, size: 0.25, coastal: true, blurb: 'Madeiran island city of sun and cliffs.' },
      { name: 'Faro', cost: 0.95, size: 0.2, coastal: true, blurb: 'Algarve gateway, beaches and tourists.' },
      { name: 'Setúbal', cost: 0.85, size: 0.25, coastal: true, blurb: 'Fishing port with dolphins in the bay.' },
      { name: 'Aveiro', cost: 0.8, size: 0.2, coastal: true, blurb: 'The Portuguese Venice.' },
      { name: 'Vila do Conde', cost: 0.8, size: 0.15, coastal: true, blurb: 'Seaside shipbuilding town.' },
      { name: 'Barcelos', cost: 0.7, size: 0.1, blurb: 'Rooster town with a stubborn little club.' },
      { name: 'Chaves', cost: 0.7, size: 0.1, blurb: 'Mountain spa town near the border.' },
      { name: 'Leiria', cost: 0.75, size: 0.2, blurb: 'Castle town between Lisbon and Porto.' },
      { name: 'Viseu', cost: 0.7, size: 0.15, blurb: 'Wine region heartland.' },
      { name: 'Estoril', cost: 1.2, size: 0.2, coastal: true, blurb: 'Casino, beaches and old money.' },
      { name: 'Portimão', cost: 0.85, size: 0.15, coastal: true, blurb: 'Algarve resort town.' },
    ],
  },
];

export const NATIONS: NationDef[] = [
  { key: 'BRA', name: 'Brazil', demonym: 'Brazilian', strength: 0.86, colors: [[255, 220, 0], [20, 60, 160]] },
  { key: 'ARG', name: 'Argentina', demonym: 'Argentine', strength: 0.86, colors: [[120, 190, 240], [255, 255, 255]] },
  { key: 'BEL', name: 'Belgium', demonym: 'Belgian', strength: 0.8, colors: [[200, 20, 30], [20, 20, 20]] },
  { key: 'CRO', name: 'Croatia', demonym: 'Croatian', strength: 0.76, colors: [[220, 30, 40], [255, 255, 255]] },
  { key: 'URU', name: 'Uruguay', demonym: 'Uruguayan', strength: 0.74, colors: [[110, 170, 230], [20, 20, 20]] },
  { key: 'NGA', name: 'Nigeria', demonym: 'Nigerian', strength: 0.66, colors: [[0, 140, 70], [255, 255, 255]] },
  { key: 'SEN', name: 'Senegal', demonym: 'Senegalese', strength: 0.68, colors: [[255, 255, 255], [0, 130, 60]] },
  { key: 'USA', name: 'USA', demonym: 'American', strength: 0.64, colors: [[255, 255, 255], [20, 40, 100]] },
  { key: 'JPN', name: 'Japan', demonym: 'Japanese', strength: 0.66, colors: [[20, 40, 140], [255, 255, 255]] },
  { key: 'SWE', name: 'Sweden', demonym: 'Swedish', strength: 0.66, colors: [[255, 210, 0], [20, 70, 160]] },
  { key: 'POL', name: 'Poland', demonym: 'Polish', strength: 0.66, colors: [[255, 255, 255], [220, 20, 40]] },
  { key: 'MAR', name: 'Morocco', demonym: 'Moroccan', strength: 0.7, colors: [[190, 20, 30], [0, 110, 60]] },
];

export function nationName(key: string): string {
  return COUNTRIES.find((c) => c.key === key)?.name ?? NATIONS.find((n) => n.key === key)?.name ?? key;
}

export function nationDemonym(key: string): string {
  return COUNTRIES.find((c) => c.key === key)?.demonym ?? NATIONS.find((n) => n.key === key)?.demonym ?? key;
}

export const ALL_NATION_KEYS = [...COUNTRIES.map((c) => c.key), ...NATIONS.map((n) => n.key)];

/** cities the shipped database clubs belong to (database team id -> city) */
export const DB_CLUB_CITY: Record<number, string> = {
  1: 'Amsterdam',
  2: 'London',
  3: 'Barcelona',
  4: 'Munich',
  5: 'Dortmund',
  6: 'Manchester',
  7: 'Eindhoven',
  8: 'Madrid',
};

/**
 * Generated club names are "pattern + real city", which regularly lands on the name of a real
 * club (or a close variant of it). The world is fictional, so those combinations are skipped.
 * Compared after stripping accents and case (see realClubKey).
 */
const REAL_CLUB_NAMES = [
  // England
  'Manchester United', 'Manchester City', 'Leeds United', 'Leeds City', 'Newcastle United', 'Newcastle Town', 'Bristol City', 'Bristol Rovers', 'Sheffield United',
  'Birmingham City', 'Leicester City', 'Norwich City', 'Norwich United', 'Ipswich Town', 'Hull City', 'Derby County', 'Coventry City', 'Coventry United', 'Stoke City',
  'Bolton Wanderers', 'Blackburn Rovers', 'Brighton Albion', 'Brighton Town', 'Plymouth Argyle', 'Reading Town', 'AFC Liverpool', 'AFC Sunderland', 'London City',
  'Portsmouth Town', 'Southampton Town', 'Liverpool City', 'Sunderland Albion',
  // Germany (English city names included: FC Cologne, 1. FC Nuremberg...)
  'FC Cologne', '1. FC Cologne', 'Fortuna Cologne', 'SV Cologne', 'FC Nuremberg', '1. FC Nuremberg', 'FC Kaiserslautern', '1. FC Kaiserslautern', 'VfB Stuttgart',
  'Eintracht Frankfurt', 'FC Frankfurt', '1. FC Frankfurt', 'SV Frankfurt', 'Fortuna Düsseldorf', 'Union Berlin', '1. FC Berlin', 'FC Berlin', 'SV Bremen', 'FC Augsburg', 'VfL Bochum',
  'FC Rostock', 'TSV Munich', 'FC Munich', '1. FC Munich', 'SV Hamburg', 'VfB Leipzig', 'FC Leipzig', '1. FC Leipzig', 'SV Mainz', 'FC Freiburg', 'SV Hannover', 'VfB Karlsruhe', 'FC Karlsruhe',
  'SpVgg Bielefeld', 'VfL Hamburg', 'SV Stuttgart', 'Eintracht Braunschweig',
  // Netherlands
  'FC Utrecht', 'FC Groningen', 'FC Enschede', 'SC Enschede', 'SC Heerenveen', 'FC Eindhoven', 'FC Zwolle', 'FC The Hague', 'Sparta Rotterdam', 'Go Ahead Deventer',
  'Vitesse Arnhem', 'FC Amsterdam', 'FC Haarlem', 'Quick The Hague', 'Quick Nijmegen', 'VV Maastricht', 'SC Leeuwarden', 'SC Rotterdam', 'FC Alkmaar', 'SC Cambuur',
  // Spain
  'Real Madrid', 'Atlético Madrid', 'Madrid CF', 'CF Madrid', 'Racing Madrid', 'CF Barcelona', 'Barcelona CF', 'Barcelona SC', 'Valencia CF', 'CF Valencia', 'Seville CF', 'CF Seville',
  'Atlético Bilbao', 'Málaga CF', 'CF Málaga', 'CD Málaga', 'Atlético Málaga', 'Real Zaragoza', 'CD Zaragoza', 'Real Vigo', 'Real San Sebastián', 'Villarreal CF', 'CF Villarreal', 'CD Villarreal',
  'Sporting Gijón', 'Real Gijón', 'Racing Santander', 'Real Santander', 'Real Valladolid', 'Granada CF', 'CF Granada', 'UD Las Palmas', 'Atlético Las Palmas', 'Cádiz CF', 'CF Cádiz',
  'Real Oviedo', 'Deportivo Oviedo', 'Elche CF', 'CF Elche', 'Córdoba CF', 'CF Córdoba', 'Atlético Pamplona', 'Real Sevilla', 'Atlético Seville',
  // Italy
  'AC Milan', 'Milan Calcio', 'FC Milan', 'Turin Calcio', 'FC Turin', 'AC Turin', 'Atletico Rome', 'SS Rome', 'AC Rome', 'Real Rome', 'SS Naples', 'AC Naples', 'Naples Calcio',
  'AC Florence', 'Florence Calcio', 'Genoa Calcio', 'FC Genoa', 'AC Genoa', 'Unione Genoa', 'FC Bologna', 'Bologna Calcio', 'AC Bologna', 'Virtus Bergamo', 'Virtus Verona',
  'AC Verona', 'Verona Calcio', 'US Palermo', 'FC Palermo', 'Palermo Calcio', 'SS Bari', 'FC Bari', 'AC Bari', 'Udine Calcio', 'Parma Calcio', 'FC Parma', 'AC Parma',
  'Cagliari Calcio', 'US Lecce', 'Lecce Calcio', 'FC Empoli', 'Empoli Calcio', 'Brescia Calcio', 'FC Brescia', 'US Salerno', 'Salerno Calcio',
  // France
  'Paris FC', 'FC Paris', 'Racing Paris', 'Stade Paris', 'Olympique Marseille', 'US Marseille', 'Olympique Lyon', 'FC Lyon', 'Lyon FC', 'Olympique Lille', 'Lille FC', 'SC Lille',
  'Girondins Bordeaux', 'FC Bordeaux', 'Olympique Nice', 'FC Nice', 'FC Nantes', 'Nantes FC', 'Stade Rennes', 'AS Saint-Étienne', 'Montpellier FC', 'Racing Strasbourg', 'FC Strasbourg',
  'Racing Lens', 'Toulouse FC', 'FC Toulouse', 'Stade Reims', 'Stade Brest', 'Le Havre FC', 'Stade Auxerre', 'AS Auxerre', 'FC Metz', 'Metz FC', 'AS Nancy',
  // Portugal
  'Sporting Lisbon', 'FC Porto', 'SC Porto', 'Sporting Braga', 'SC Braga', 'Vitória Guimarães', 'Vitória Setúbal', 'Académica Coimbra', 'União Leiria', 'Desportivo Chaves',
  'GD Chaves', 'GD Estoril', 'Académica Viseu', 'União Funchal', 'Atlético Lisbon', 'SC Faro', 'SC Portimão', 'União Lisbon', 'FC Porto B',
];

/** normalised lookup key: no accents, lower case */
export function realClubKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const REAL_CLUB_KEYS = new Set(REAL_CLUB_NAMES.map(realClubKey));

/** true when a generated name matches (or nearly matches) a real club */
export function isRealClubName(name: string): boolean {
  return REAL_CLUB_KEYS.has(realClubKey(name));
}
