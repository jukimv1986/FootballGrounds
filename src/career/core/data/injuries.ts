// Injury catalogue: typical football injuries with duration ranges (days), how common they are,
// and their long-term cost. Severity drives rehab options and reputation for injury-proneness.

export interface InjuryDef {
  key: string;
  name: string;
  minDays: number;
  maxDays: number;
  weight: number;
  /** 0 .. 1 */
  severity: number;
  /** permanent stat loss on physical stats (fraction), rolled on occurrence */
  permanent?: number;
  /** "career-ending" chance for older players */
  careerEnding?: number;
}

export const INJURIES: InjuryDef[] = [
  { key: 'knock', name: 'Dead leg', minDays: 2, maxDays: 5, weight: 30, severity: 0.05 },
  { key: 'bruised_foot', name: 'Bruised foot', minDays: 3, maxDays: 8, weight: 16, severity: 0.08 },
  { key: 'calf', name: 'Calf strain', minDays: 7, maxDays: 21, weight: 14, severity: 0.2 },
  { key: 'hamstring', name: 'Hamstring strain', minDays: 12, maxDays: 40, weight: 14, severity: 0.3 },
  { key: 'groin', name: 'Groin strain', minDays: 10, maxDays: 30, weight: 8, severity: 0.25 },
  { key: 'ankle', name: 'Sprained ankle', minDays: 8, maxDays: 30, weight: 12, severity: 0.25 },
  { key: 'concussion', name: 'Concussion', minDays: 7, maxDays: 14, weight: 3, severity: 0.2 },
  { key: 'mcl', name: 'Knee ligament (MCL) sprain', minDays: 28, maxDays: 60, weight: 5, severity: 0.45 },
  { key: 'metatarsal', name: 'Broken metatarsal', minDays: 45, maxDays: 80, weight: 3, severity: 0.55 },
  { key: 'shoulder', name: 'Dislocated shoulder', minDays: 20, maxDays: 45, weight: 3, severity: 0.35 },
  { key: 'acl', name: 'Torn cruciate ligament (ACL)', minDays: 190, maxDays: 280, weight: 1.2, severity: 0.95, permanent: 0.035, careerEnding: 0.18 },
  { key: 'achilles', name: 'Ruptured Achilles tendon', minDays: 160, maxDays: 240, weight: 0.7, severity: 0.9, permanent: 0.04, careerEnding: 0.22 },
];

export const REHAB_OPTIONS = [
  { key: 'standard' as const, name: 'Standard rehab', desc: 'Follow the club physios. Normal recovery time.', speed: 1.0, reinjury: 1.0, cost: 0 },
  { key: 'aggressive' as const, name: 'Push to return early', desc: 'About 25% faster, but a real risk of breaking down again.', speed: 1.33, reinjury: 2.6, cost: 0 },
  { key: 'specialist' as const, name: 'Private specialist', desc: 'World-class clinic: ~20% faster and safer — at a price.', speed: 1.22, reinjury: 0.6, cost: 1 },
];
