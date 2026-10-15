import { describe, expect, it } from 'vitest'
import { itemSchema } from './schemas'

// Edge cases of the item form (plan: "Money & date edge cases", Test plan item 11). Made-up data only.

const valid = { name: 'Savjetovanje', unitCode: 'HUR', unitPrice: '50,00' }

describe('itemSchema price edge cases', () => {
  const price = (unitPrice: unknown) => itemSchema.safeParse({ ...valid, unitPrice })
  const parsed = (unitPrice: string) => {
    const r = price(unitPrice)
    return r.success ? r.data.unitPrice : `ERR:${r.error.issues[0]?.message}`
  }

  it.each([
    ['1,234', '1.234'], // comma is the decimal separator in Croatian input
    ['0,1250', '0.125'], // trailing zero trimmed
    ['0,100000', '0.1'],
    ['1.234,56', '1234.56'],
    ['1.234.567', '1234567'], // two dots can only group thousands
    ['1.234.567,891234', '1234567.891234'],
    ['0.5', '0.5'],
    ['0,000001', '0.000001'], // one millionth, the smallest storable price
    ['007', '7'],
    ['+5', '5'],
    ['  12,50  ', '12.5'],
    ['1 234,50', '1234.5'], // NBSP grouping
    ['1 234,50', '1234.5'], // narrow NBSP grouping
    ['999999999,999999', '999999999.999999'], // exact maximum
    ['0,00', '0'],
    ['000', '0'],
  ])('accepts %j as %s', (input, expected) => {
    expect(parsed(input)).toBe(expected)
  })

  it.each([
    '-0',
    '-0,00',
    '−5', // U+2212 minus
    '-1.234,56',
    '1000000000', // just over the maximum
    '1.000.000.000,00',
    '999999999,9999991', // 7 decimals at the maximum
    '0,0000001',
    '0.0000001',
    '1.234.56', // dots in the wrong place
    '12.34.567',
    '1,234,567',
    '1,2,3',
    '1.234,567.8',
    ',5',
    '.5',
    '5,',
    '1e3',
    '1E3',
    '0x10',
    'Infinity',
    'NaN',
    'abc',
    '12 €',
    '€12',
    '1 2 3', // bad space grouping
    '1.234 567', // mixed grouping
    '٣٤', // Arabic-Indic digits
    '１２', // fullwidth digits
    '1'.repeat(41), // over the input length cap
    '',
    '   ',
  ])('rejects %j', (input) => {
    expect(price(input).success, input).toBe(false)
  })

  it('rejects non-string prices of every type', () => {
    for (const value of [12, 0, 1.5, null, undefined, Number.NaN, true, {}, [], ['1']]) {
      expect(price(value).success, String(value)).toBe(false)
    }
  })

  it('gives specific messages for ambiguity, decimals and size', () => {
    expect(parsed('1.234')).toMatch(/^ERR:Nejasan iznos/)
    expect(parsed('999.999')).toMatch(/^ERR:Nejasan iznos/)
    expect(parsed('1.2345')).toBe('1.2345') // 4 digits after the dot is not ambiguous
    expect(parsed('0.123')).toBe('0.123') // leading zero: a decimal, not a thousands group
    expect(parsed('1,5.5')).toBe('ERR:Za decimale koristite zarez.')
    expect(parsed('1.000.000.000')).toBe('ERR:Cijena je prevelika.')
  })

  it('never produces exponent notation or a float artifact', () => {
    expect(parsed('0,000001')).not.toMatch(/e/i)
    expect(parsed('0,3')).toBe('0.3')
  })
})

describe('itemSchema KPD edge cases', () => {
  const kpd = (kpdCode: unknown) => itemSchema.safeParse({ ...valid, kpdCode })
  const kpdOf = (input: unknown) => {
    const r = kpd(input)
    return r.success ? r.data.kpdCode : 'INVALID'
  }

  it('treats null, undefined and empty as no KPD', () => {
    expect(kpdOf(null)).toBeNull()
    expect(kpdOf(undefined)).toBeNull()
    expect(kpdOf('')).toBeNull()
  })

  it.each([
    ['01.11.11', '011111'], // leading zeros are kept
    ['00.00.00', '000000'],
    ['62\t01\t11', '620111'],
    ['62.01.11\n', '620111'],
  ])('normalizes %j to %s', (input, expected) => {
    expect(kpdOf(input)).toBe(expected)
  })

  it.each([
    '6201',
    '62.01',
    '62.01.1',
    '62.01.111', // 7 digits
    '6201111',
    '62.01.11.1',
    '62-01-11',
    '62,01,11',
    'AB.CD.EF',
    '62.01.1a',
    '６２０１１１', // fullwidth digits
    '62.01.11 x',
  ])('rejects %j', (input) => {
    expect(kpd(input).success, input).toBe(false)
  })

  it('rejects a non-string KPD code', () => {
    expect(kpd(620111).success).toBe(false)
    expect(kpd({}).success).toBe(false)
  })
})

describe('itemSchema name and description edge cases', () => {
  it('counts Croatian letters and measures length after trimming', () => {
    expect(itemSchema.safeParse({ ...valid, name: 'č'.repeat(200) }).success).toBe(true)
    expect(itemSchema.safeParse({ ...valid, name: ` ${'č'.repeat(200)} ` }).success).toBe(true)
    expect(itemSchema.safeParse({ ...valid, name: 'č'.repeat(201) }).success).toBe(false)
    expect(itemSchema.safeParse({ ...valid, description: 'ž'.repeat(1000) }).success).toBe(true)
  })

  it('allows CRLF in the description but not in the name, and refuses DEL and NUL', () => {
    expect(itemSchema.safeParse({ ...valid, description: 'a\r\nb' }).success).toBe(true)
    expect(itemSchema.safeParse({ ...valid, name: 'a\r\nb' }).success).toBe(false)
    expect(itemSchema.safeParse({ ...valid, name: 'a\u007fb' }).success).toBe(false)
    expect(itemSchema.safeParse({ ...valid, description: 'a\u0000b' }).success).toBe(false)
    expect(itemSchema.safeParse({ ...valid, description: 'a\u007fb' }).success).toBe(false)
  })

  it('rejects non-string names and a missing name', () => {
    for (const name of [undefined, null, 5, {}]) {
      expect(itemSchema.safeParse({ ...valid, name }).success).toBe(false)
    }
  })

  it('ignores unknown keys instead of passing them to the database', () => {
    const r = itemSchema.parse({ ...valid, organizationId: 'x', archivedAt: 'y', id: 'z' })
    expect(Object.keys(r).sort()).toEqual(
      ['currency', 'description', 'kpdCode', 'name', 'unitCode', 'unitPrice'].sort(),
    )
  })
})
