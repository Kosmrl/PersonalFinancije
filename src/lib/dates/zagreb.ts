// Legal timestamps are stored in UTC and shown in Europe/Zagreb; business dates are calendar
// dates ("YYYY-MM-DD", no time zone). Everything here uses Intl only, with no date library.

const TIME_ZONE = 'Europe/Zagreb'

/** A calendar date in `YYYY-MM-DD` form that has been validated (leap years included). */
export type CalendarDate = string & { readonly __brand: 'CalendarDate' }

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

/** Type guard for a valid `YYYY-MM-DD` calendar date. `2028-02-29` is valid, `2027-02-29` is not. */
export function isCalendarDate(value: string): value is CalendarDate {
  const match = CALENDAR_DATE.exec(value)
  if (!match) return false
  const year = parseInt(match[1] ?? '', 10)
  const month = parseInt(match[2] ?? '', 10)
  const day = parseInt(match[3] ?? '', 10)
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

/** Parses a `YYYY-MM-DD` string; returns `null` when it is not a real calendar date. */
export function parseCalendarDate(value: string): CalendarDate | null {
  return isCalendarDate(value) ? value : null
}

const zagrebParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type ZagrebFields = { year: string; month: string; day: string; hour: string; minute: string }

/** Wall-clock fields of an instant in Europe/Zagreb. Throws RangeError for an invalid Date. */
function zagrebFields(instant: Date): ZagrebFields {
  const fields: Record<string, string> = {}
  for (const part of zagrebParts.formatToParts(instant)) {
    fields[part.type] = part.value
  }
  return {
    year: (fields.year ?? '').padStart(4, '0'),
    month: fields.month ?? '',
    day: fields.day ?? '',
    hour: fields.hour ?? '',
    minute: fields.minute ?? '',
  }
}

/** The Zagreb calendar date of an instant, e.g. `2026-12-31T23:30:00Z` -> `2027-01-01`. */
export function toZagrebCalendarDate(instant: Date): CalendarDate {
  const { year, month, day } = zagrebFields(instant)
  return `${year}-${month}-${day}` as CalendarDate
}

/** The Zagreb calendar year of an instant. Used for the invoice numbering year. */
export function zagrebYear(instant: Date): number {
  return parseInt(zagrebFields(instant).year, 10)
}

/** `09.10.2026. 14:05` in Europe/Zagreb. */
export function formatZagrebDateTime(instant: Date): string {
  const { year, month, day, hour, minute } = zagrebFields(instant)
  return `${day}.${month}.${year}. ${hour}:${minute}`
}

/** `2026-10-09` -> `09.10.2026.` */
export function formatCalendarDate(date: CalendarDate): string {
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}.`
}

/** Today's calendar date in Europe/Zagreb. `now` is injectable for tests. */
export function todayInZagreb(now: Date = new Date()): CalendarDate {
  return toZagrebCalendarDate(now)
}
