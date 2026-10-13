import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatCalendarDate,
  formatZagrebDateTime,
  isCalendarDate,
  parseCalendarDate,
  todayInZagreb,
  toZagrebCalendarDate,
  zagrebYear,
} from './zagreb'

afterEach(() => {
  vi.useRealTimers()
})

describe('Zagreb calendar date and year', () => {
  it.each([
    // Plan table
    ['2026-12-31T22:30:00Z', '2026-12-31', 2026],
    ['2026-12-31T23:30:00Z', '2027-01-01', 2027],
    ['2026-07-01T21:59:59Z', '2026-07-01', 2026],
    ['2026-07-01T22:00:00Z', '2026-07-02', 2026],
  ])('%s -> %s', (iso, date, year) => {
    expect(toZagrebCalendarDate(new Date(iso))).toBe(date)
    expect(zagrebYear(new Date(iso))).toBe(year)
  })

  it.each([
    // A transaction at 23:30 local time stays on its own calendar date (the UTC date differs
    // in neither season: 23:30 CET is 22:30Z, 23:30 CEST is 21:30Z).
    ['2026-01-15T22:30:00Z', '2026-01-15'], // 23:30 CET
    ['2026-07-15T21:30:00Z', '2026-07-15'], // 23:30 CEST
    ['2026-01-15T22:59:59Z', '2026-01-15'], // 23:59:59 CET
    ['2026-01-15T23:00:00Z', '2026-01-16'], // 00:00 CET: next day, though still 15 Jan in UTC
    ['2026-07-15T21:59:59Z', '2026-07-15'], // 23:59:59 CEST
    ['2026-07-15T22:00:00Z', '2026-07-16'], // 00:00 CEST
    ['2026-07-15T22:30:00Z', '2026-07-16'], // 00:30 CEST: next day, though 15 Jul in UTC
    ['2026-01-15T00:30:00Z', '2026-01-15'], // 01:30 CET
    ['2026-07-15T00:30:00Z', '2026-07-15'], // 02:30 CEST
    // Month boundaries
    ['2026-01-31T22:59:59Z', '2026-01-31'],
    ['2026-01-31T23:00:00Z', '2026-02-01'],
    ['2026-02-28T22:59:59Z', '2026-02-28'],
    ['2026-02-28T23:00:00Z', '2026-03-01'], // 2026 is not a leap year
    ['2026-03-31T21:59:59Z', '2026-03-31'], // CEST already
    ['2026-03-31T22:00:00Z', '2026-04-01'],
    ['2026-04-30T21:59:59Z', '2026-04-30'],
    ['2026-04-30T22:00:00Z', '2026-05-01'],
    ['2026-10-31T22:59:59Z', '2026-10-31'], // CET again
    ['2026-10-31T23:00:00Z', '2026-11-01'],
    // Year boundaries
    ['2026-12-31T22:59:59Z', '2026-12-31'],
    ['2026-12-31T23:00:00Z', '2027-01-01'],
    ['2027-01-01T00:00:00Z', '2027-01-01'],
    ['2026-01-01T00:00:00Z', '2026-01-01'],
    ['2025-12-31T23:00:00Z', '2026-01-01'],
    ['2025-12-31T22:59:59Z', '2025-12-31'],
    // Leap years
    ['2028-02-28T22:59:59Z', '2028-02-28'],
    ['2028-02-28T23:00:00Z', '2028-02-29'],
    ['2028-02-29T22:59:59Z', '2028-02-29'],
    ['2028-02-29T23:00:00Z', '2028-03-01'],
    ['2028-02-29T23:30:00Z', '2028-03-01'],
    ['2027-02-28T23:30:00Z', '2027-03-01'], // no 29 Feb in 2027
    ['2100-02-28T23:30:00Z', '2100-03-01'], // 2100 is not a leap year
    ['2000-02-28T23:30:00Z', '2000-02-29'], // 2000 is
    // Daylight saving time: the day it starts has 23 hours, the day it ends has 25
    ['2026-03-28T22:59:59Z', '2026-03-28'],
    ['2026-03-28T23:00:00Z', '2026-03-29'], // 00:00 CET
    ['2026-03-29T00:59:59Z', '2026-03-29'], // 01:59:59 CET
    ['2026-03-29T01:00:00Z', '2026-03-29'], // 03:00:00 CEST
    ['2026-03-29T21:59:59Z', '2026-03-29'], // 23:59:59 CEST
    ['2026-03-29T22:00:00Z', '2026-03-30'],
    ['2026-10-24T21:59:59Z', '2026-10-24'],
    ['2026-10-24T22:00:00Z', '2026-10-25'], // 00:00 CEST
    ['2026-10-25T00:30:00Z', '2026-10-25'], // 02:30 CEST
    ['2026-10-25T01:30:00Z', '2026-10-25'], // 02:30 CET, the repeated hour
    ['2026-10-25T22:59:59Z', '2026-10-25'], // 23:59:59 CET
    ['2026-10-25T23:00:00Z', '2026-10-26'],
  ])('%s is %s in Zagreb', (iso, date) => {
    expect(toZagrebCalendarDate(new Date(iso))).toBe(date)
  })

  it.each([
    ['2026-12-31T22:59:59Z', 2026],
    ['2026-12-31T23:00:00Z', 2027],
    ['2027-12-31T22:59:59Z', 2027],
    ['2027-12-31T23:00:00Z', 2028],
    ['2026-01-01T00:00:00Z', 2026],
    ['2025-12-31T23:00:00Z', 2026],
    ['2025-12-31T22:59:59Z', 2025],
    ['2028-12-31T23:30:00Z', 2029],
    ['2026-06-15T12:00:00Z', 2026],
  ])('the Zagreb year of %s is %i', (iso, year) => {
    expect(zagrebYear(new Date(iso))).toBe(year)
  })

  it('always returns a YYYY-MM-DD string and an integer year', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-09-09T09:09:09Z', '1999-12-31T23:59:59Z']) {
      expect(toZagrebCalendarDate(new Date(iso))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isInteger(zagrebYear(new Date(iso)))).toBe(true)
    }
    expect(toZagrebCalendarDate(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03-05') // zero padding
  })

  it('fails loudly for an invalid Date instead of returning a bogus date', () => {
    expect(() => toZagrebCalendarDate(new Date(Number.NaN))).toThrow(RangeError)
    expect(() => zagrebYear(new Date('not a date'))).toThrow(RangeError)
    expect(() => formatZagrebDateTime(new Date(Number.NaN))).toThrow(RangeError)
    expect(() => todayInZagreb(new Date(Number.NaN))).toThrow(RangeError)
  })

  it('does not depend on the time zone of the process', () => {
    const original = process.env.TZ
    try {
      const results: string[] = []
      for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/Zagreb']) {
        process.env.TZ = tz
        results.push(
          [
            toZagrebCalendarDate(new Date('2026-12-31T23:30:00Z')),
            String(zagrebYear(new Date('2026-12-31T23:30:00Z'))),
            toZagrebCalendarDate(new Date('2026-07-15T21:30:00Z')),
            formatZagrebDateTime(new Date('2026-10-09T12:05:00Z')),
          ].join('|'),
        )
      }
      expect(new Set(results).size).toBe(1)
      expect(results[0]).toBe('2027-01-01|2027|2026-07-15|09.10.2026. 14:05')
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
})

describe('todayInZagreb', () => {
  it('uses the injected clock', () => {
    expect(todayInZagreb(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
    expect(todayInZagreb(new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31')
    expect(todayInZagreb(new Date('2028-02-29T23:30:00Z'))).toBe('2028-03-01')
  })

  it('defaults to the current time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'))
    expect(todayInZagreb()).toBe('2027-01-01')
    vi.setSystemTime(new Date('2026-07-15T21:30:00Z'))
    expect(todayInZagreb()).toBe('2026-07-15')
  })
})

describe('formatting', () => {
  it('formats date and time in Zagreb time', () => {
    expect(formatZagrebDateTime(new Date('2026-10-09T12:05:00Z'))).toBe('09.10.2026. 14:05')
    expect(formatCalendarDate('2026-10-09' as never)).toBe('09.10.2026.')
  })

  it.each([
    ['2026-01-05T08:07:00Z', '05.01.2026. 09:07'], // zero padded day, month, hour and minute
    ['2026-01-15T22:30:00Z', '15.01.2026. 23:30'],
    ['2026-07-15T21:30:00Z', '15.07.2026. 23:30'],
    ['2026-07-15T22:00:00Z', '16.07.2026. 00:00'],
    ['2026-12-31T23:00:00Z', '01.01.2027. 00:00'], // never "24:00"
    ['2026-12-31T22:59:00Z', '31.12.2026. 23:59'],
    ['2028-02-29T11:00:00Z', '29.02.2028. 12:00'],
    ['2026-06-15T10:00:30Z', '15.06.2026. 12:00'], // seconds are dropped, not rounded
    ['2026-06-15T10:00:59.999Z', '15.06.2026. 12:00'],
  ])('formatZagrebDateTime(%s) = %s', (iso, expected) => {
    expect(formatZagrebDateTime(new Date(iso))).toBe(expected)
  })

  it('handles the DST changes', () => {
    expect(formatZagrebDateTime(new Date('2026-03-29T00:59:59Z'))).toBe('29.03.2026. 01:59')
    expect(formatZagrebDateTime(new Date('2026-03-29T01:00:00Z'))).toBe('29.03.2026. 03:00')
    // The repeated hour at the end of summer time shows 02:30 twice and does not throw.
    expect(formatZagrebDateTime(new Date('2026-10-25T00:30:00Z'))).toBe('25.10.2026. 02:30')
    expect(formatZagrebDateTime(new Date('2026-10-25T01:30:00Z'))).toBe('25.10.2026. 02:30')
  })

  it.each([
    // 2027 and 2028 move on different days than 2026 (last Sunday of March / October)
    ['2027-03-28T00:59:59Z', '28.03.2027. 01:59'],
    ['2027-03-28T01:00:00Z', '28.03.2027. 03:00'],
    ['2027-10-31T00:59:59Z', '31.10.2027. 02:59'],
    ['2027-10-31T01:00:00Z', '31.10.2027. 02:00'],
    ['2028-03-26T00:59:59Z', '26.03.2028. 01:59'],
    ['2028-03-26T01:00:00Z', '26.03.2028. 03:00'],
    ['2028-10-29T00:59:59Z', '29.10.2028. 02:59'],
    ['2028-10-29T01:00:00Z', '29.10.2028. 02:00'],
    // The hour 02:00-02:59 on the 2026 changeover day exists once in autumn and not in spring
    ['2026-10-25T00:00:00Z', '25.10.2026. 02:00'], // CEST
    ['2026-10-25T01:00:00Z', '25.10.2026. 02:00'], // CET, the same wall-clock time again
    ['2026-10-25T01:59:59Z', '25.10.2026. 02:59'],
    ['2026-10-25T02:00:00Z', '25.10.2026. 03:00'],
  ])('formatZagrebDateTime(%s) = %s', (iso, expected) => {
    expect(formatZagrebDateTime(new Date(iso))).toBe(expected)
  })

  it('formats a calendar date', () => {
    expect(formatCalendarDate(parseCalendarDate('2026-10-09') ?? ('' as never))).toBe('09.10.2026.')
    expect(formatCalendarDate(parseCalendarDate('2028-02-29') ?? ('' as never))).toBe('29.02.2028.')
    expect(formatCalendarDate(parseCalendarDate('2026-01-01') ?? ('' as never))).toBe('01.01.2026.')
    expect(formatCalendarDate(parseCalendarDate('2026-12-31') ?? ('' as never))).toBe('31.12.2026.')
  })
})

describe('CalendarDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(parseCalendarDate('2028-02-29')).toBe('2028-02-29')
    expect(parseCalendarDate('2027-02-29')).toBeNull()
    expect(parseCalendarDate('1900-02-29')).toBeNull()
    expect(parseCalendarDate('2000-02-29')).toBe('2000-02-29')
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-04-31')).toBe(false)
    expect(isCalendarDate('2026-4-1')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
  })

  it.each([
    '2026-01-01',
    '2026-12-31',
    '2026-01-31',
    '2026-03-31',
    '2026-04-30',
    '2026-05-31',
    '2026-06-30',
    '2026-07-31',
    '2026-08-31',
    '2026-09-30',
    '2026-10-31',
    '2026-11-30',
    '2026-02-28',
    '2028-02-29',
    '2000-02-29',
    '2400-02-29',
    '2096-02-29',
    '0001-01-01',
    '9999-12-31',
  ])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true)
    expect(parseCalendarDate(value)).toBe(value)
  })

  it.each([
    '2027-02-29',
    '2026-02-29',
    '2026-02-30',
    '2026-02-31',
    '1900-02-29',
    '2100-02-29',
    '2026-04-31',
    '2026-06-31',
    '2026-09-31',
    '2026-11-31',
    '2026-01-32',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '0000-01-01',
    '2026-1-01',
    '2026-01-1',
    '26-01-01',
    '20260-01-01',
    '2026/01/01',
    '2026.01.01',
    '01.01.2026',
    '01-01-2026',
    '2026-01-01T00:00:00Z',
    '2026-01-01 ',
    ' 2026-01-01',
    '2026-01-01\n',
    '2026-01-01\u0000',
    '２０２６-０１-０１', // full-width digits
    '٢٠٢٦-٠١-٠١', // Arabic-Indic digits
    '2026-01-0a',
    'abcd-ef-gh',
    '',
    ' ',
    '2026',
    '2026-01',
  ])('rejects %j', (value) => {
    expect(isCalendarDate(value)).toBe(false)
    expect(parseCalendarDate(value)).toBeNull()
  })

  it('accepts every real day of 2026-2029 and nothing in between', () => {
    // Walk with UTC arithmetic as an independent calendar: each real day is accepted, and the
    // days one past the end of each month are not.
    const start = Date.UTC(2026, 0, 1)
    const days = 4 * 365 + 1 // 2028 is a leap year
    for (let i = 0; i < days; i++) {
      const iso = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
      expect(isCalendarDate(iso), iso).toBe(true)
    }
    for (let year = 2026; year <= 2029; year++) {
      for (let month = 1; month <= 12; month++) {
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
        const mm = String(month).padStart(2, '0')
        expect(isCalendarDate(`${year}-${mm}-${String(lastDay).padStart(2, '0')}`)).toBe(true)
        expect(isCalendarDate(`${year}-${mm}-${String(lastDay + 1).padStart(2, '0')}`)).toBe(false)
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Cross-check against the EU daylight saving rule, computed independently with UTC arithmetic:
// CEST (UTC+2) from 01:00 UTC on the last Sunday of March until 01:00 UTC on the last Sunday of
// October, CET (UTC+1) otherwise.

function lastSundayAt0100Utc(year: number, monthIndex: number): number {
  const lastOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0))
  return Date.UTC(year, monthIndex, lastOfMonth.getUTCDate() - lastOfMonth.getUTCDay(), 1)
}

function expectedLocal(ms: number) {
  const year = new Date(ms).getUTCFullYear()
  const summer = ms >= lastSundayAt0100Utc(year, 2) && ms < lastSundayAt0100Utc(year, 9)
  const local = new Date(ms + (summer ? 2 : 1) * 3_600_000).toISOString() // wall clock as "UTC"
  return {
    date: local.slice(0, 10),
    year: parseInt(local.slice(0, 4), 10),
    dateTime: `${local.slice(8, 10)}.${local.slice(5, 7)}.${local.slice(0, 4)}. ${local.slice(11, 16)}`,
  }
}

describe('property: Intl agrees with the EU daylight saving rule', () => {
  it('matches around every changeover from 2024 to 2035, to the second', () => {
    for (let year = 2024; year <= 2035; year++) {
      for (const monthIndex of [2, 9]) {
        const change = lastSundayAt0100Utc(year, monthIndex)
        for (const offset of [
          -86_400_000, -3_601_000, -60_000, -1000, 0, 1000, 60_000, 3_599_000, 86_400_000,
        ]) {
          const instant = new Date(change + offset)
          const expected = expectedLocal(instant.getTime())
          const label = instant.toISOString()
          expect(toZagrebCalendarDate(instant), label).toBe(expected.date)
          expect(zagrebYear(instant), label).toBe(expected.year)
          expect(formatZagrebDateTime(instant), label).toBe(expected.dateTime)
        }
      }
    }
  })

  it('matches at a regular sample of 2025-2030 instants, around the clock', () => {
    const step = 47 * 60_000 + 13_000 // a step that does not line up with hours or days
    const end = Date.UTC(2031, 0, 1)
    for (let ms = Date.UTC(2025, 0, 1); ms < end; ms += step) {
      const instant = new Date(ms)
      const expected = expectedLocal(ms)
      if (toZagrebCalendarDate(instant) !== expected.date) {
        expect(toZagrebCalendarDate(instant), instant.toISOString()).toBe(expected.date)
      }
      if (formatZagrebDateTime(instant) !== expected.dateTime) {
        expect(formatZagrebDateTime(instant), instant.toISOString()).toBe(expected.dateTime)
      }
      if (zagrebYear(instant) !== expected.year) {
        expect(zagrebYear(instant), instant.toISOString()).toBe(expected.year)
      }
    }
  })

  it('assigns each instant to exactly one date, with dates never going backwards', () => {
    // Walk a year in 20-minute steps across both changeovers.
    let previous = ''
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 20 * 60_000) {
      const date = toZagrebCalendarDate(new Date(ms))
      expect(date >= previous, `${new Date(ms).toISOString()} -> ${date} after ${previous}`).toBe(
        true,
      )
      previous = date
    }
  })
})
