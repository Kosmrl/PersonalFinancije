import { describe, expect, it } from 'vitest'
import { createRng, randomDigits, testSeed } from '../../../tests/helpers/fake'
import { formatKpd, normalizeKpd } from './kpd'

const NBSP = ' '

describe('normalizeKpd', () => {
  it.each(['62.01.11', '620111', ' 62 01 11 '])('normalizes %j to 620111', (input) => {
    expect(normalizeKpd(input)).toBe('620111')
  })

  it.each([
    ['62.01.11', '620111'],
    ['01.11.11', '011111'], // leading zeros are kept: the code is a string, not a number
    ['011111', '011111'],
    ['00.00.00', '000000'],
    ['99.99.99', '999999'],
    [`62${NBSP}01${NBSP}11`, '620111'],
    ['\t620111\n', '620111'],
    ['62 01.11', '620111'],
    ['  62.01.11  ', '620111'],
    ['62.0111', '620111'],
    ['6201.11', '620111'],
    ['6.2.0.1.1.1', '620111'], // lenient: dots and spaces are stripped wherever they are
  ])('normalizes %j to %s', (input, expected) => {
    expect(normalizeKpd(input)).toBe(expected)
  })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['only dots', '...'],
    ['2 digits', '62'],
    ['4 digits', '6201'],
    ['4 digits, dotted', '62.01'],
    ['5 digits', '62011'],
    ['5 digits, dotted', '62.01.1'],
    ['7 digits', '6201111'],
    ['7 digits, dotted', '62.01.111'],
    ['8 digits, dotted', '62.01.11.11'],
    ['letters', 'ab.cd.ef'],
    ['a letter among digits', '62.01.1a'],
    ['a letter among digits, plain', '62O111'],
    ['hyphens', '62-01-11'],
    ['commas', '62,01,11'],
    ['slashes', '62/01/11'],
    ['underscore', '62_01_11'],
    ['plus sign', '+620111'],
    ['minus sign', '-620111'],
    ['trailing text', '620111x'],
    ['leading text', 'KPD 620111'],
    ['decimal point inside digits only', '620111.5'],
    ['exponent', '6e5111'],
    ['full-width digits', '６２０１１１'],
    ['Arabic-Indic digits', '٦٢٠١١١'],
    ['zero-width space', '62​0111'],
    ['NUL', '62\u00000111'],
  ])('rejects %s', (_name, input) => {
    expect(normalizeKpd(input)).toBeNull()
  })

  it('returns exactly the 6 digits, as a string', () => {
    const result = normalizeKpd('62.01.11')
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^\d{6}$/)
  })
})

describe('formatKpd', () => {
  it('formats with dots', () => {
    expect(formatKpd('620111')).toBe('62.01.11')
    expect(formatKpd('6201')).toBe('6201')
  })

  it.each([
    ['620111', '62.01.11'],
    ['011111', '01.11.11'],
    ['000000', '00.00.00'],
    ['999999', '99.99.99'],
  ])('formatKpd(%j) = %s', (input, expected) => {
    expect(formatKpd(input)).toBe(expected)
  })

  it.each([
    '',
    '6201',
    '62011',
    '6201111',
    '62.01.11', // already formatted
    ' 620111', // not normalized: returned unchanged
    '620111 ',
    'abcdef',
    '62011a',
  ])('returns %j unchanged because it is not a normalized KPD code', (input) => {
    expect(formatKpd(input)).toBe(input)
  })
})

describe('property: KPD normalize and format', () => {
  const COUNT = 1000

  it('normalizeKpd(formatKpd(code)) returns the code for 1,000 random codes', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < COUNT; i++) {
      const code = randomDigits(rng, 6)
      const formatted = formatKpd(code)
      expect(formatted, `seed ${seed}, code ${code}`).toMatch(/^\d{2}\.\d{2}\.\d{2}$/)
      expect(normalizeKpd(formatted), `seed ${seed}, code ${code}`).toBe(code)
      expect(normalizeKpd(code), `seed ${seed}, code ${code}`).toBe(code)
      expect(normalizeKpd(` ${formatted} `), `seed ${seed}, code ${code}`).toBe(code)
    }
  })

  it('formatting is stable: formatKpd(normalizeKpd(formatKpd(code))) equals formatKpd(code)', () => {
    const rng = createRng()
    for (let i = 0; i < COUNT; i++) {
      const formatted = formatKpd(randomDigits(rng, 6))
      const normalized = normalizeKpd(formatted)
      expect(normalized).not.toBeNull()
      expect(formatKpd(normalized ?? '')).toBe(formatted)
    }
  })

  it('rejects random digit strings of any other length', () => {
    const rng = createRng()
    const seed = testSeed()
    for (let i = 0; i < COUNT; i++) {
      const length = [0, 1, 2, 3, 4, 5, 7, 8, 9, 12][i % 10] ?? 0
      const digits = randomDigits(rng, length)
      expect(normalizeKpd(digits), `seed ${seed}, digits ${digits}`).toBeNull()
    }
  })
})
