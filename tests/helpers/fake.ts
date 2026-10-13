// Generated, made-up identifiers for tests (CLAUDE.md: fixtures use made-up data only).
//
// - Fake OIBs: 10 random digits plus the ISO 7064 MOD 11,10 check digit.
// - Fake IBANs: a random digit BBAN plus ISO 13616 mod-97 check digits, for HR (default) and for
//   the other supported countries.
//
// Everything is driven by an explicit, seedable generator so a failing run can be reproduced:
//
//   const rng = createRng()            // seed from TEST_SEED, else DEFAULT_TEST_SEED
//   const rng = createRng(12345)       // explicit seed
//   TEST_SEED=987654 npx vitest run    // re-run with another seed
//
// Include `testSeed()` in assertion messages so a CI failure tells you which seed to use.
//
// The generators below are written independently of src/lib/validation on purpose: they are the
// oracle the validators are tested against. They never produce real numbers on purpose, but a
// random 17-digit BBAN or 10-digit OIB prefix could coincide with a real one by chance; never use
// them as anything but throwaway test data.
//
// DB-backed tests (one obrt per OIB is unique across organizations): a fixed seed repeats the same
// OIBs on every run against a database that is not wiped. Use `createRng(freshSeed())` there.

/** Returns a float in [0, 1), like Math.random(). */
export type Rng = () => number

export const DEFAULT_TEST_SEED = 20261009

/** The seed for this run: `TEST_SEED` when set (an integer), otherwise DEFAULT_TEST_SEED. */
export function testSeed(): number {
  const raw = process.env.TEST_SEED
  if (raw === undefined || raw.trim() === '') return DEFAULT_TEST_SEED
  if (!/^\d{1,10}$/.test(raw.trim())) {
    throw new Error(`TEST_SEED must be a non-negative integer, got "${raw}"`)
  }
  return parseInt(raw.trim(), 10) >>> 0
}

/** A seed that differs on every call, for tests that must not repeat values across runs. */
export function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000)) >>> 0
}

/** mulberry32: a small, fast, seedable 32-bit generator. Not for anything security related. */
export function createRng(seed: number = testSeed()): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [min, maxExclusive). */
export function randomInt(rng: Rng, min: number, maxExclusive: number): number {
  return min + Math.floor(rng() * (maxExclusive - min))
}

/** A string of `length` random ASCII digits (leading zeros allowed). */
export function randomDigits(rng: Rng, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String(randomInt(rng, 0, 10))
  return out
}

// ---------------------------------------------------------------------------------------------
// OIB

/**
 * ISO 7064 MOD 11,10 check digit for the first 10 digits of an OIB (ISO/IEC 7064:2003, hybrid
 * system, as used for the Croatian OIB).
 */
export function oibCheckDigit(first10: string): string {
  if (!/^\d{10}$/.test(first10)) throw new Error(`Expected 10 digits, got "${first10}"`)
  let product = 10
  for (const ch of first10) {
    let sum = (product + (ch.charCodeAt(0) - 48)) % 10
    if (sum === 0) sum = 10
    product = (sum * 2) % 11
  }
  const check = 11 - product
  return String(check === 10 ? 0 : check)
}

/** A made-up but checksum-valid OIB: 10 random digits plus the computed check digit. */
export function fakeOib(rng: Rng): string {
  const first10 = randomDigits(rng, 10)
  return first10 + oibCheckDigit(first10)
}

// ---------------------------------------------------------------------------------------------
// IBAN

/**
 * Total IBAN length per country (SWIFT IBAN Registry). Deliberately a separate copy of the table in
 * src/lib/validation/iban.ts, so the tests cross-check it.
 */
// prettier-ignore
export const FAKE_IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27,
  GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24,
}

/** ISO 13616 check digits (two characters, "02" to "98") for a country code and a BBAN. */
export function ibanCheckDigits(country: string, bban: string): string {
  const numeric = (bban + country + '00')
    .toUpperCase()
    .replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55))
  const check = 98n - (BigInt(numeric) % 97n)
  return check.toString().padStart(2, '0')
}

/**
 * A made-up IBAN with valid mod-97 check digits and the right length for the country. The BBAN is
 * random digits, so it is checksum-valid but is not a real account. Defaults to HR (21 characters:
 * 2 letters, 2 check digits, 17 digits).
 */
export function fakeIban(rng: Rng, country = 'HR'): string {
  const length = FAKE_IBAN_LENGTHS[country]
  if (length === undefined) throw new Error(`No IBAN length known for country "${country}"`)
  const bban = randomDigits(rng, length - 4)
  return country + ibanCheckDigits(country, bban) + bban
}

/** Shorthand for a made-up Croatian IBAN. */
export function fakeHrIban(rng: Rng): string {
  return fakeIban(rng, 'HR')
}

// ---------------------------------------------------------------------------------------------
// Mutation helpers (for "a corrupted number is rejected" tests)

/**
 * Replaces the character at `index` with a different one of the same class: a digit becomes
 * `(digit + delta) mod 10`, an upper-case letter shifts by `delta` within A-Z. `delta` is 1..9.
 * The result always differs from the input, so a single-character error is simulated exactly.
 */
export function mutateCharAt(value: string, index: number, delta = 1): string {
  if (!Number.isInteger(delta) || delta < 1 || delta > 9) throw new Error('delta must be 1..9')
  const ch = value.charAt(index)
  let replacement: string
  if (/\d/.test(ch)) {
    replacement = String((ch.charCodeAt(0) - 48 + delta) % 10)
  } else if (/[A-Z]/.test(ch)) {
    replacement = String.fromCharCode(65 + ((ch.charCodeAt(0) - 65 + delta) % 26))
  } else {
    throw new Error(`Cannot mutate "${ch}" at index ${index}`)
  }
  return value.slice(0, index) + replacement + value.slice(index + 1)
}

/** Swaps the characters at `index` and `index + 1`. */
export function swapAdjacent(value: string, index: number): string {
  return (
    value.slice(0, index) + value.charAt(index + 1) + value.charAt(index) + value.slice(index + 2)
  )
}
