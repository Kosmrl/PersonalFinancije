import { describe, expect, it } from 'vitest'
import { safeNextPath } from './errors'

describe('safeNextPath', () => {
  it.each([
    ['/%09/evil.com'],
    ['/%0A/evil.com'],
    ['/\t/evil.com'],
    ['/\n/evil.com'],
    ['/\\evil.com'],
    ['/app/..//evil.com'],
    ['/app/%2e%2e//evil.com'],
    ['/app@evil.com'],
    ['/app%2f%2fevil.com'],
    ['//evil.com'],
    ['https://evil.com/app'],
    ['javascript:alert(1)'],
    ['/other'],
    ['/application'],
    [''],
    [null],
    [undefined],
    [['/app', '/app/x']],
  ])('rejects %j', (value) => {
    expect(safeNextPath(value)).toBe('/app')
  })

  it('uses the given fallback', () => {
    expect(safeNextPath('//evil.com', '/app/x')).toBe('/app/x')
  })

  it('accepts /app paths with query and hash', () => {
    expect(safeNextPath('/app')).toBe('/app')
    expect(safeNextPath('/app/racuni?x=1&y=2#top')).toBe('/app/racuni?x=1&y=2#top')
  })

  it('only ever returns /app paths', () => {
    const inputs = ['/app', '/app/x?y=1', '/app/..//evil.com', '/app/%2e%2e/other', '/app@evil.com']
    for (const input of inputs) {
      expect(safeNextPath(input)).toMatch(/^\/app(?:[/?#]|$)/)
    }
  })
})
