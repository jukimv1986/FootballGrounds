// Calendar arithmetic. Career time is an integer day number (days since 1970-01-01, UTC) plus a
// slot of the day (morning / afternoon / evening). Plain integers keep saves small and make
// "days until" maths trivial; conversion to y/m/d goes through Date.UTC.

export type Slot = 0 | 1 | 2;
export const SLOT_NAMES = ['Morning', 'Afternoon', 'Evening'] as const;

export interface YMD {
  y: number;
  /** 1 .. 12 */
  m: number;
  /** 1 .. 31 */
  d: number;
  /** 0 = Monday .. 6 = Sunday */
  wd: number;
}

const MS_PER_DAY = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.substring(0, 3));
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS_SHORT = WEEKDAYS.map((d) => d.substring(0, 3));

export function dayOf(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function ymd(day: number): YMD {
  const date = new Date(day * MS_PER_DAY);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), wd: (date.getUTCDay() + 6) % 7 };
}

export function weekday(day: number): number {
  // 1970-01-01 was a Thursday (wd 3)
  return (((day + 3) % 7) + 7) % 7;
}

/** first day >= `day` that falls on weekday `wd` */
export function nextWeekday(day: number, wd: number): number {
  return day + ((wd - weekday(day) + 7) % 7);
}

export function formatDate(day: number, withWeekday = false): string {
  const t = ymd(day);
  const base = `${t.d} ${MONTHS_SHORT[t.m - 1]} ${t.y}`;
  return withWeekday ? `${WEEKDAYS_SHORT[t.wd]} ${base}` : base;
}

export function formatDateLong(day: number): string {
  const t = ymd(day);
  return `${WEEKDAYS[t.wd]}, ${t.d} ${MONTHS[t.m - 1]} ${t.y}`;
}

export function monthName(m: number, short = false): string {
  return short ? MONTHS_SHORT[m - 1] : MONTHS[m - 1];
}

/** age in (fractional) years between a birth day and a day */
export function ageAt(birthDay: number, day: number): number {
  return (day - birthDay) / 365.25;
}

/** whole years of age */
export function ageYears(birthDay: number, day: number): number {
  const b = ymd(birthDay);
  const t = ymd(day);
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age--;
  return age;
}

/** football season a day belongs to: the year the season starts (July 1st .. June 30th) */
export function seasonOf(day: number): number {
  const t = ymd(day);
  return t.m >= 7 ? t.y : t.y - 1;
}

export function seasonLabel(season: number): string {
  return `${season}/${String((season + 1) % 100).padStart(2, '0')}`;
}

export function seasonStart(season: number): number {
  return dayOf(season, 7, 1);
}

export function seasonEnd(season: number): number {
  return dayOf(season + 1, 6, 30);
}
