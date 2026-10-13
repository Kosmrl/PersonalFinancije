import { describe, expect, it } from 'vitest'
import {
  FAKE_IBAN_LENGTHS,
  createRng,
  fakeHrIban,
  fakeIban,
  ibanCheckDigits,
  mutateCharAt,
  randomDigits,
  swapAdjacent,
  testSeed,
} from '../../../tests/helpers/fake'
import { formatIban, ibanCountryCode, isValidIban, normalizeIban } from './iban'

const NBSP = ' '
const COUNTRIES = Object.keys(FAKE_IBAN_LENGTHS)

/** A made-up IBAN with a given BBAN, valid checksum. */
const iban = (country: string, bban: string) => country + ibanCheckDigits(country, bban) + bban

describe('test helper sanity (the oracle the validators are tested against)', () => {
  it('computes the check digits of the published example IBANs', () => {
    // Example IBANs published in the SWIFT IBAN registry and in the standard's documentation;
    // they are not real accounts.
    expect(ibanCheckDigits('GB', 'WEST12345698765432')).toBe('82')
    expect(ibanCheckDigits('DE', '370400440532013000')).toBe('89')
    expect(ibanCheckDigits('HR', '10010051863000160')).toBe('12')
  })

  it('generates HR IBANs of 21 characters', () => {
    const rng = createRng(5)
    for (let i = 0; i < 50; i++) expect(fakeHrIban(rng)).toMatch(/^HR\d{19}$/)
  })

  it('is reproducible for a seed and different for another seed', () => {
    const take = (seed: number) => {
      const rng = createRng(seed)
      return Array.from({ length: 5 }, () => fakeHrIban(rng))
    }
    expect(take(42)).toEqual(take(42))
    expect(take(42)).not.toEqual(take(43))
  })
})

describe('isValidIban: accepted', () => {
  const hr = iban('HR', '10010051863000160')

  it('accepts a valid HR IBAN, in lower case and with spaces', () => {
    expect(hr).toHaveLength(21)
    expect(isValidIban(hr)).toBe(true)
    expect(isValidIban(hr.toLowerCase())).toBe(true)
    expect(isValidIban(formatIban(hr))).toBe(true)
  })

  it('accepts surrounding and inner whitespace of every kind, and mixed case', () => {
    expect(isValidIban(`  ${hr}  `)).toBe(true)
    expect(isValidIban(`\t${hr}\n`)).toBe(true)
    expect(isValidIban(`${NBSP}${formatIban(hr).replace(/ /g, NBSP)}${NBSP}`)).toBe(true)
    expect(isValidIban(hr.slice(0, 2).toLowerCase() + hr.slice(2))).toBe(true)
    expect(isValidIban(hr.toLowerCase().replace(/(.{4})/g, '$1 '))).toBe(true)
    expect(isValidIban(hr.split('').join(' '))).toBe(true)
  })

  it('accepts a valid non-HR IBAN', () => {
    const de = iban('DE', '370400440532013000')
    expect(isValidIban(de)).toBe(true)
    expect(ibanCountryCode(de)).toBe('DE')
  })

  it('accepts IBANs whose BBAN contains letters', () => {
    // Letters count as 10..35 in the mod-97 check; GB, NL, IE, MT and others use them.
    expect(isValidIban(iban('GB', 'WEST12345698765432'))).toBe(true)
    expect(isValidIban('GB82WEST12345698765432')).toBe(true)
    expect(isValidIban('gb82 west 1234 5698 7654 32')).toBe(true)
    expect(isValidIban(iban('NL', 'ABNA0417164300'))).toBe(true)
    expect(isValidIban(iban('MT', 'MALT011000012345MTLCAST001S'))).toBe(true)
    expect(isValidIban(iban('IE', 'AIBK93115212345678'))).toBe(true)
  })

  it.each(COUNTRIES)('accepts a generated %s IBAN of the registry length', (country) => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < 25; i++) {
      const value = fakeIban(rng, country)
      expect(value, `seed ${seed}`).toHaveLength(FAKE_IBAN_LENGTHS[country] ?? -1)
      expect(isValidIban(value), `seed ${seed}, IBAN ${value}`).toBe(true)
    }
  })

  it('covers at least HR and the whole EU/EEA set', () => {
    const euEea = [
      'AT',
      'BE',
      'BG',
      'HR',
      'CY',
      'CZ',
      'DK',
      'EE',
      'FI',
      'FR',
      'DE',
      'GR',
      'HU',
      'IE',
      'IT',
      'LV',
      'LT',
      'LU',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SK',
      'SI',
      'ES',
      'SE', // EU
      'IS',
      'LI',
      'NO', // EEA
    ]
    const rng = createRng(2)
    for (const country of euEea) {
      expect(isValidIban(fakeIban(rng, country)), country).toBe(true)
    }
  })
})

describe('isValidIban: rejected', () => {
  const hr = iban('HR', '10010051863000160')

  it('rejects a wrong checksum and wrong HR lengths', () => {
    const wrongCheck =
      hr.slice(0, 2) +
      String((parseInt(hr.slice(2, 4), 10) + 1) % 100).padStart(2, '0') +
      hr.slice(4)
    expect(isValidIban(wrongCheck)).toBe(false)
    expect(isValidIban(iban('HR', '1001005186300016'))).toBe(false) // 20 characters
    expect(isValidIban(iban('HR', '100100518630001600'))).toBe(false) // 22 characters
    expect(isValidIban('XX00123')).toBe(false)
    expect(isValidIban('')).toBe(false)
  })

  it.each(COUNTRIES)('rejects a %s IBAN that is one character short or long', (country) => {
    // The checksum is valid in both cases; only the length is wrong.
    const length = FAKE_IBAN_LENGTHS[country] ?? 0
    const rng = createRng()
    for (const wrong of [length - 1, length + 1, length - 4, length + 4]) {
      const value = iban(country, randomDigits(rng, wrong - 4))
      expect(value).toHaveLength(wrong)
      expect(isValidIban(value), `${country}, length ${wrong}`).toBe(false)
    }
  })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['country code only', 'HR'],
    ['country code and check digits only', 'HR12'],
    ['no country code', '1210010051863000160'],
    ['digits instead of a country', '211210010051863000160'],
    ['one-letter country', 'H12100100518630001600'],
    ['letters in the check digits', 'HRAB10010051863000160'],
    ['a letter in the check digits', 'HR1A10010051863000160'],
    ['hyphens', 'HR12-1001-0051-8630-0016-0'],
    ['dots', 'HR12.1001.0051.8630.0016.0'],
    ['a symbol', 'HR1210010051863000160!'],
    ['a plus sign', '+HR1210010051863000160'],
    ['full-width digits', 'HR１２10010051863000160'],
    ['non-ASCII letters', 'HŘ1210010051863000160'],
    ['zero-width space inside', 'HR1210010051​863000160'],
    ['NUL inside', 'HR12100100518\u00006300016'],
    ['unknown country XX', iban('XX', randomDigits(createRng(1), 17))],
    ['a country without IBAN, US', iban('US', randomDigits(createRng(1), 17))],
    ['a country without IBAN, CA', iban('CA', randomDigits(createRng(1), 17))],
    ['a valid IBAN followed by garbage', hr + 'X'],
    ['a valid IBAN followed by a digit', hr + '0'],
    ['a valid IBAN with a character removed', hr.slice(0, 10) + hr.slice(11)],
  ])('rejects %s', (_name, input) => {
    expect(isValidIban(input)).toBe(false)
  })

  it('rejects the check digits 00, 01 and 99, which ISO 13616 does not allow (02-98)', () => {
    // BUG (low severity): mod-97 alone accepts them. Generation is 98 - (n mod 97), which gives
    // 02..98; but 00, 01 and 99 are congruent to 97, 98 and 2 modulo 97, so a number whose correct
    // check digits are 97, 98 or 02 also passes with 00, 01 or 99.
    const rng = createRng()
    const wanted: Record<string, string> = { '97': '00', '98': '01', '02': '99' }
    const found = new Set<string>()
    for (let tries = 0; tries < 20_000 && found.size < 3; tries++) {
      const bban = randomDigits(rng, 17)
      const correct = ibanCheckDigits('HR', bban)
      const forbidden = wanted[correct]
      if (forbidden !== undefined && !found.has(forbidden)) {
        found.add(forbidden)
        expect(isValidIban(`HR${correct}${bban}`), `HR${correct}${bban}`).toBe(true)
        expect(isValidIban(`HR${forbidden}${bban}`), `HR${forbidden}${bban}`).toBe(false)
      }
    }
    expect(found.size).toBe(3)
  })
})

describe('property: generated IBANs and single-character corruption', () => {
  const COUNT = 1000

  it('1,000 generated HR IBANs are all valid', () => {
    const rng = createRng()
    const seed = testSeed()
    const seen = new Set<string>()
    for (let i = 0; i < COUNT; i++) {
      const value = fakeHrIban(rng)
      expect(value, `seed ${seed}, iteration ${i}`).toMatch(/^HR\d{19}$/)
      expect(isValidIban(value), `seed ${seed}, IBAN ${value}`).toBe(true)
      expect(isValidIban(formatIban(value)), `seed ${seed}, IBAN ${value}, formatted`).toBe(true)
      expect(isValidIban(value.toLowerCase()), `seed ${seed}, IBAN ${value}, lower`).toBe(true)
      seen.add(value)
    }
    expect(seen.size).toBe(COUNT)
  })

  it('a single wrong digit or letter is always rejected (1,000 random HR mutations)', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < COUNT; i++) {
      const value = fakeHrIban(rng)
      const index = Math.floor(rng() * 21)
      const delta = 1 + Math.floor(rng() * 9)
      const corrupted = mutateCharAt(value, index, delta)
      expect(corrupted).not.toBe(value)
      expect(
        isValidIban(corrupted),
        `seed ${seed}, IBAN ${value}, position ${index}, delta ${delta} -> ${corrupted}`,
      ).toBe(false)
    }
  })

  it('every single-character error is rejected, exhaustively for 20 IBANs per country', () => {
    // Mod 97 detects every single-digit substitution (97 is prime), and every single-letter one
    // (letters are 10..35, so two different letters never differ by a multiple of 97).
    const rng = createRng()
    const seed = testSeed()
    for (const country of COUNTRIES) {
      for (let i = 0; i < 20; i++) {
        const value = fakeIban(rng, country)
        for (let index = 0; index < value.length; index++) {
          for (let delta = 1; delta <= 9; delta++) {
            const corrupted = mutateCharAt(value, index, delta)
            if (isValidIban(corrupted)) {
              expect.fail(
                `seed ${seed}, IBAN ${value}, position ${index}, delta ${delta} -> ${corrupted}`,
              )
            }
          }
        }
      }
    }
  })

  it('every single-character error is rejected in an IBAN with letters in the BBAN', () => {
    const value = iban('GB', 'WEST12345698765432')
    expect(isValidIban(value)).toBe(true)
    for (let index = 0; index < value.length; index++) {
      for (let delta = 1; delta <= 9; delta++) {
        const corrupted = mutateCharAt(value, index, delta)
        expect(isValidIban(corrupted), `position ${index}, delta ${delta} -> ${corrupted}`).toBe(
          false,
        )
      }
    }
  })

  it('swapping two different adjacent digits is rejected (HR, 1,000 random swaps)', () => {
    const rng = createRng()
    const seed = testSeed()
    let swaps = 0
    for (let i = 0; i < COUNT; i++) {
      const value = fakeHrIban(rng)
      const index = 4 + Math.floor(rng() * 16) // within the BBAN: positions 4..19 swapped with the next
      if (value.charAt(index) === value.charAt(index + 1)) continue
      swaps++
      const corrupted = swapAdjacent(value, index)
      expect(
        isValidIban(corrupted),
        `seed ${seed}, IBAN ${value}, swap at ${index} -> ${corrupted}`,
      ).toBe(false)
    }
    expect(swaps).toBeGreaterThan(800)
  })

  it('a dropped or an extra character is rejected', () => {
    const rng = createRng()
    for (let i = 0; i < 300; i++) {
      const value = fakeHrIban(rng)
      const index = Math.floor(rng() * 21)
      expect(isValidIban(value.slice(0, index) + value.slice(index + 1))).toBe(false)
      expect(isValidIban(value.slice(0, index) + '5' + value.slice(index))).toBe(false)
    }
  })
})

describe('normalizeIban', () => {
  it('removes all whitespace and upper-cases', () => {
    expect(normalizeIban(' hr12 3 ')).toBe('HR123')
    expect(normalizeIban(`hr12${NBSP}1001\t0051\n8630`)).toBe('HR12100100518630')
    expect(normalizeIban('')).toBe('')
    expect(normalizeIban('   ')).toBe('')
  })

  it('does not validate or strip other characters', () => {
    expect(normalizeIban('hr12-34')).toBe('HR12-34')
    expect(normalizeIban('abc')).toBe('ABC')
  })

  it('is idempotent', () => {
    for (const input of [' hr12 3 ', 'DE89 3704 0044 0532 0130 00', 'gb82west12345698765432']) {
      expect(normalizeIban(normalizeIban(input))).toBe(normalizeIban(input))
    }
  })
})

describe('ibanCountryCode', () => {
  it.each([
    ['HR1210010051863000160', 'HR'],
    ['hr12 1001 0051 8630 0016 0', 'HR'],
    ['  de89 3704', 'DE'],
    ['XX', 'XX'], // looks at the shape only; it does not check that the country exists
    ['', null],
    ['   ', null],
    ['1', null],
    ['1234', null],
    ['H1', null],
    ['H', null],
    ['12HR', null],
  ])('ibanCountryCode(%j) = %j', (input, expected) => {
    expect(ibanCountryCode(input)).toBe(expected)
  })
})

describe('formatIban', () => {
  const hr = iban('HR', '10010051863000160')

  it('groups in fours', () => {
    expect(formatIban(hr)).toBe(hr.replace(/(.{4})(?=.)/g, '$1 '))
    expect(
      formatIban(hr)
        .split(' ')
        .slice(0, -1)
        .every((g) => g.length === 4),
    ).toBe(true)
    expect(formatIban('HR1210010051863000160')).toBe('HR12 1001 0051 8630 0016 0')
  })

  it.each([
    ['', ''],
    ['H', 'H'],
    ['HR12', 'HR12'],
    ['HR123', 'HR12 3'],
    ['HR1234567', 'HR12 3456 7'],
    ['HR12 3456', 'HR12 3456'], // already grouped
    ['hr12 3456 7', 'HR12 3456 7'], // normalized first
    ['   ', ''],
  ])('formatIban(%j) = %j', (input, expected) => {
    expect(formatIban(input)).toBe(expected)
  })

  it('has no trailing space for any length, and a last group of 1 to 4 characters', () => {
    for (let length = 1; length <= 34; length++) {
      const formatted = formatIban('A'.repeat(length))
      expect(formatted.endsWith(' ')).toBe(false)
      const groups = formatted.split(' ')
      expect(groups.slice(0, -1).every((g) => g.length === 4)).toBe(true)
      const last = groups[groups.length - 1] ?? ''
      expect(last.length).toBeGreaterThanOrEqual(1)
      expect(last.length).toBeLessThanOrEqual(4)
      expect(groups.join('')).toBe('A'.repeat(length))
    }
  })

  it('round-trips with normalizeIban and keeps the IBAN valid, for every country', () => {
    const rng = createRng()
    for (const country of COUNTRIES) {
      const value = fakeIban(rng, country)
      expect(normalizeIban(formatIban(value))).toBe(value)
      expect(formatIban(formatIban(value))).toBe(formatIban(value))
      expect(isValidIban(formatIban(value))).toBe(true)
    }
  })
})

describe('isValidIban: HR digits only and extra SEPA countries', () => {
  it('rejects an HR IBAN with letters in the BBAN', () => {
    expect(isValidIban('HR1210010051863000160')).toBe(true)
    expect(isValidIban('HR12100100518630001A0')).toBe(false)
  })

  // Made-up BBANs (all ones) with correct mod-97 check digits.
  it.each([
    'AD4411111111111111111111',
    'GI461111111111111111111',
    'MC8711111111111111111111111',
    'SM0311111111111111111111111',
    'VA10111111111111111111',
  ])('accepts the SEPA IBAN %s and rejects it with a digit missing', (iban) => {
    expect(isValidIban(iban)).toBe(true)
    expect(isValidIban(iban.slice(0, -1))).toBe(false)
  })
})
