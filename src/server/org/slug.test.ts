import { describe, expect, it } from 'vitest'
import { isReservedSlug, RESERVED_SLUGS, slugify, withSuffix } from './slug'

describe('slugify', () => {
  it.each([
    ['Obrt Žutić', 'obrt-zutic'],
    ['Čačkalica & Đurđevak', 'cackalica-durdevak'],
    ['ŠĆĐČŽ šćđčž', 'scdcz-scdcz'],
    ['  Dva   razmaka  ', 'dva-razmaka'],
    ['Café Müller', 'cafe-muller'],
    ['Obrt 2026.', 'obrt-2026'],
    ['--Crtice--', 'crtice'],
  ])('%s -> %s', (name, expected) => {
    expect(slugify(name)).toBe(expected)
  })

  it('cuts to 40 characters without a trailing hyphen', () => {
    const slug = slugify('a'.repeat(39) + ' bbbbbbbb')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
    expect(slugify('x'.repeat(100))).toBe('x'.repeat(40))
  })

  it('never returns an empty slug', () => {
    expect(slugify('!!!')).toMatch(/^obrt-[a-z0-9]{4}$/)
    expect(slugify('')).toMatch(/^obrt-[a-z0-9]{4}$/)
  })

  it('never returns a reserved slug (static routes under /app)', () => {
    for (const reserved of ['novi-obrt', 'profil', 'api', 'Novi obrt', 'PROFIL', 'postavke']) {
      const slug = slugify(reserved)
      expect(isReservedSlug(slug), slug).toBe(false)
      expect(slug).toMatch(/-[a-z0-9]{4}$/)
    }
  })

  it('covers the routes that exist under /app', () => {
    expect(RESERVED_SLUGS.has('novi-obrt')).toBe(true)
    expect(RESERVED_SLUGS.has('profil')).toBe(true)
    expect(RESERVED_SLUGS.has('api')).toBe(true)
  })

  it('only produces URL-safe characters', () => {
    for (const name of ['Ž€$%^&*()_+ čćđšž', '日本語', 'a/b\\c?d#e']) {
      expect(slugify(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })
})

describe('withSuffix', () => {
  it('appends a hyphen and 4 base36 characters, within 40 + 5 characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(withSuffix('moj-obrt')).toMatch(/^moj-obrt-[a-z0-9]{4}$/)
    }
    expect(withSuffix('x'.repeat(60))).toMatch(/^x{40}-[a-z0-9]{4}$/)
  })
})
