import { describe, expect, it } from 'vitest'
import { itemSchema } from './schemas'
import { UNITS, unitLabel } from './units'

// Validation rules of the item form (plan: "items" table, Test plan item 11). Made-up data only.

const valid = { name: 'Savjetovanje', unitCode: 'HUR', unitPrice: '50,00' }

function errorsOf(input: Record<string, unknown>): Record<string, string> {
  const result = itemSchema.safeParse({ ...valid, ...input })
  if (result.success) return {}
  const out: Record<string, string> = {}
  for (const issue of result.error.issues) out[String(issue.path[0])] ??= issue.message
  return out
}

describe('itemSchema', () => {
  it('parses the price from the string into a normalized decimal string', () => {
    const cases: [string, string][] = [
      ['0,125', '0.125'],
      ['0.125', '0.125'],
      ['12,50', '12.5'],
      ['1.234,56', '1234.56'],
      ['1 234,5', '1234.5'],
      ['0', '0'],
      ['999.999.999,999999', '999999999.999999'],
    ]
    for (const [input, expected] of cases) {
      const result = itemSchema.parse({ ...valid, unitPrice: input })
      expect(result.unitPrice, input).toBe(expected)
    }
  })

  it('rejects the ambiguous "1.234" with the ambiguity message', () => {
    expect(errorsOf({ unitPrice: '1.234' }).unitPrice).toMatch(/^Nejasan iznos/)
  })

  it('rejects negative, over-precise, oversized, empty and non-string prices', () => {
    expect(errorsOf({ unitPrice: '-1' }).unitPrice).toBeTruthy()
    expect(errorsOf({ unitPrice: '0,1234567' }).unitPrice).toBe('Najviše 6 decimala.')
    expect(errorsOf({ unitPrice: '1.000.000.000' }).unitPrice).toBe('Cijena je prevelika.')
    expect(errorsOf({ unitPrice: '' }).unitPrice).toBe('Obavezno polje.')
    expect(errorsOf({ unitPrice: 12 }).unitPrice).toBeTruthy()
    expect(errorsOf({ unitPrice: '1e3' }).unitPrice).toBeTruthy()
  })

  it('accepts only EUR and defaults to it', () => {
    expect(itemSchema.parse(valid).currency).toBe('EUR')
    expect(itemSchema.parse({ ...valid, currency: 'eur' }).currency).toBe('EUR')
    expect(errorsOf({ currency: 'USD' }).currency).toBeTruthy()
  })

  it('normalizes the KPD code and rejects malformed ones', () => {
    for (const input of ['62.01.11', '620111', ' 62 01 11 ']) {
      expect(itemSchema.parse({ ...valid, kpdCode: input }).kpdCode).toBe('620111')
    }
    expect(itemSchema.parse(valid).kpdCode).toBeNull()
    expect(itemSchema.parse({ ...valid, kpdCode: '  ' }).kpdCode).toBeNull()
    expect(errorsOf({ kpdCode: '6201' }).kpdCode).toBeTruthy()
    expect(errorsOf({ kpdCode: '62.01.1a' }).kpdCode).toBeTruthy()
  })

  it('accepts every unit of measure and nothing else', () => {
    for (const unit of UNITS)
      expect(itemSchema.safeParse({ ...valid, unitCode: unit.code }).success).toBe(true)
    expect(errorsOf({ unitCode: 'kom' }).unitCode).toBe('Odaberite jedinicu mjere.')
    expect(errorsOf({ unitCode: undefined }).unitCode).toBeTruthy()
    expect(unitLabel('H87')).toBe('kom')
    expect(unitLabel('MTK')).toBe('m²')
  })

  it('trims text, bounds lengths and refuses control characters', () => {
    expect(itemSchema.parse({ ...valid, name: '  Naziv  ' }).name).toBe('Naziv')
    expect(errorsOf({ name: '' }).name).toBe('Obavezno polje.')
    expect(errorsOf({ name: 'a'.repeat(201) }).name).toBe('Najviše 200 znakova.')
    expect(errorsOf({ name: 'a\u0000b' }).name).toBeTruthy()
    expect(errorsOf({ name: 'a\nb' }).name).toBeTruthy()
    expect(errorsOf({ description: 'a'.repeat(1001) }).description).toBe('Najviše 1000 znakova.')
    expect(errorsOf({ description: 'a\u0007b' }).description).toBeTruthy()
    expect(itemSchema.parse({ ...valid, description: 'a\nb' }).description).toBe('a\nb')
    // 15 lines of 65 chars + 14 line breaks = 989 as LF, 1003 as CRLF.
    const lines = Array.from({ length: 15 }, () => 'x'.repeat(65))
    const crlf = lines.join('\r\n')
    expect(crlf.length).toBeGreaterThan(1000)
    expect(itemSchema.parse({ ...valid, description: crlf }).description).toBe(lines.join('\n'))
    expect(itemSchema.parse({ ...valid, description: '   ' }).description).toBeNull()
  })
})
