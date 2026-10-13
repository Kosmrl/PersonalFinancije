import { describe, expect, it } from 'vitest'
import {
  createRng,
  fakeOib,
  mutateCharAt,
  oibCheckDigit,
  randomDigits,
  testSeed,
} from '../../../tests/helpers/fake'
import { isValidOib, normalizeOib } from './oib'

const NBSP = ' '

describe('isValidOib: accepted', () => {
  it('accepts the hand-computed vector 00000000001', () => {
    // MOD 11,10 over ten zeros, traced by hand: the running value goes 10 -> 9 -> 7 -> 3 -> 6 ->
    // 1 -> 2 -> 4 -> 8 -> 5 -> 10, so the check digit is (11 - 10) mod 10 = 1.
    expect(isValidOib('00000000001')).toBe(true)
    expect(isValidOib('00000000000')).toBe(false)
    expect(oibCheckDigit('0000000000')).toBe('1')
  })

  it('accepts generated OIBs, with surrounding or inner spaces', () => {
    const oib = fakeOib(createRng(7))
    expect(isValidOib(oib)).toBe(true)
    expect(isValidOib(` ${oib.slice(0, 5)} ${oib.slice(5)} `)).toBe(true)
    expect(
      isValidOib(`${oib.slice(0, 3)} ${oib.slice(3, 6)} ${oib.slice(6, 9)} ${oib.slice(9)}`),
    ).toBe(true)
  })

  it('accepts every kind of whitespace around and inside the number', () => {
    const oib = fakeOib(createRng(11))
    for (const space of [' ', '\t', '\n', '\r\n', NBSP, ' ', '  ']) {
      expect(isValidOib(`${space}${oib}${space}`), JSON.stringify(space)).toBe(true)
      expect(isValidOib(`${oib.slice(0, 4)}${space}${oib.slice(4)}`), JSON.stringify(space)).toBe(
        true,
      )
    }
  })

  it('accepts a number with leading zeros', () => {
    const rng = createRng(3)
    let checked = 0
    while (checked < 20) {
      const oib = fakeOib(rng)
      if (oib.startsWith('0')) {
        expect(isValidOib(oib)).toBe(true)
        checked++
      }
    }
  })
})

describe('isValidOib: rejected', () => {
  const valid = fakeOib(createRng(1234))
  const first10 = valid.slice(0, 10)

  it('rejects a wrong check digit, wrong length and letters', () => {
    const wrong = first10 + String((parseInt(valid.slice(10), 10) + 1) % 10)
    expect(isValidOib(wrong)).toBe(false)
    expect(isValidOib(valid.slice(0, 10))).toBe(false)
    expect(isValidOib(valid + '0')).toBe(false)
    expect(isValidOib('1234567890a')).toBe(false)
    expect(isValidOib('')).toBe(false)
  })

  it('accepts exactly one of the ten possible check digits for any first ten digits', () => {
    const rng = createRng()
    for (let i = 0; i < 200; i++) {
      const prefix = randomDigits(rng, 10)
      const accepted = [...'0123456789'].filter((d) => isValidOib(prefix + d))
      expect(accepted, `seed ${testSeed()}, prefix ${prefix}`).toEqual([oibCheckDigit(prefix)])
    }
  })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['1 digit', '1'],
    ['9 digits', '123456789'],
    ['10 digits', first10],
    ['12 digits', valid + '0'],
    ['12 digits, leading extra', '0' + valid],
    ['11 letters', 'abcdefghijk'],
    ['letter instead of a digit', 'A' + valid.slice(1)],
    ['letter as check digit', first10 + 'X'],
    ['HR prefix, as in a VAT ID', 'HR' + valid],
    ['HR prefix, 9 digits kept', 'HR' + valid.slice(0, 9)],
    ['hyphens', `${valid.slice(0, 3)}-${valid.slice(3, 6)}-${valid.slice(6)}`],
    ['dots', `${valid.slice(0, 3)}.${valid.slice(3, 6)}.${valid.slice(6)}`],
    ['plus sign', '+' + first10],
    ['minus sign', '-' + first10],
    ['decimal point', first10 + '.0'],
    ['exponent', '1e10000000'],
    ['trailing letter', valid + 'a'],
    [
      'full-width digits',
      [...valid].map((d) => String.fromCharCode(0xff10 + parseInt(d, 10))).join(''),
    ],
    [
      'Arabic-Indic digits',
      [...valid].map((d) => String.fromCharCode(0x0660 + parseInt(d, 10))).join(''),
    ],
    ['zero-width space inside', valid.slice(0, 5) + '​' + valid.slice(5)],
    ['NUL inside', valid.slice(0, 5) + '\0' + valid.slice(5)],
    ['emoji', '💶'.repeat(11)],
  ])('rejects %s', (_name, input) => {
    expect(isValidOib(input)).toBe(false)
  })

  it('has no special case for repeated digits: the verdict follows the checksum only', () => {
    for (let d = 0; d <= 9; d++) {
      const prefix = String(d).repeat(10)
      expect(isValidOib(prefix + oibCheckDigit(prefix))).toBe(true)
      expect(isValidOib(prefix + String((parseInt(oibCheckDigit(prefix), 10) + 1) % 10))).toBe(
        false,
      )
    }
  })
})

describe('normalizeOib', () => {
  it('strips every kind of whitespace and nothing else', () => {
    expect(normalizeOib(' 123 456\t789 01 ')).toBe('12345678901')
    expect(normalizeOib(`12${NBSP}34\n56\r78 90 1`)).toBe('12345678901')
    expect(normalizeOib('')).toBe('')
    expect(normalizeOib('   ')).toBe('')
    expect(normalizeOib('abc')).toBe('abc') // does not validate
    expect(normalizeOib('12-34')).toBe('12-34') // does not strip hyphens
    expect(normalizeOib('00000000001')).toBe('00000000001') // keeps leading zeros
  })
})

describe('generated fake OIBs (tests/helpers/fake.ts)', () => {
  const COUNT = 1000

  it('1,000 generated OIBs are all valid, well-formed and distinct enough', () => {
    const rng = createRng()
    const seed = testSeed()
    const seen = new Set<string>()
    for (let i = 0; i < COUNT; i++) {
      const oib = fakeOib(rng)
      expect(oib, `seed ${seed}, iteration ${i}`).toMatch(/^\d{11}$/)
      expect(isValidOib(oib), `seed ${seed}, OIB ${oib}`).toBe(true)
      seen.add(oib)
    }
    // 10^10 possible OIBs: duplicates in 1,000 draws would mean a broken generator.
    expect(seen.size).toBe(COUNT)
  })

  it('is reproducible for a seed and different for another seed', () => {
    const a = Array.from(
      { length: 5 },
      (
        (rng) => () =>
          fakeOib(rng)
      )(createRng(42)),
    )
    const b = Array.from(
      { length: 5 },
      (
        (rng) => () =>
          fakeOib(rng)
      )(createRng(42)),
    )
    const c = Array.from(
      { length: 5 },
      (
        (rng) => () =>
          fakeOib(rng)
      )(createRng(43)),
    )
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('a single wrong digit anywhere is always rejected (1,000 random mutations)', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < COUNT; i++) {
      const oib = fakeOib(rng)
      const index = Math.floor(rng() * 11)
      const delta = 1 + Math.floor(rng() * 9)
      const corrupted = mutateCharAt(oib, index, delta)
      expect(corrupted).not.toBe(oib)
      expect(
        isValidOib(corrupted),
        `seed ${seed}, OIB ${oib}, position ${index}, delta ${delta} -> ${corrupted}`,
      ).toBe(false)
    }
  })

  it('every single-digit error is rejected, exhaustively for 100 OIBs', () => {
    // ISO 7064 MOD 11,10 detects all single-digit substitutions: 11 positions x 9 other digits.
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < 100; i++) {
      const oib = fakeOib(rng)
      for (let index = 0; index < 11; index++) {
        for (let delta = 1; delta <= 9; delta++) {
          const corrupted = mutateCharAt(oib, index, delta)
          expect(
            isValidOib(corrupted),
            `seed ${seed}, OIB ${oib}, position ${index}, delta ${delta}`,
          ).toBe(false)
        }
      }
    }
  })

  it('a dropped or an extra digit is rejected', () => {
    const rng = createRng()
    for (let i = 0; i < 200; i++) {
      const oib = fakeOib(rng)
      const index = Math.floor(rng() * 11)
      expect(isValidOib(oib.slice(0, index) + oib.slice(index + 1))).toBe(false)
      expect(isValidOib(oib.slice(0, index) + '7' + oib.slice(index))).toBe(false)
    }
  })
})
