import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createRng, fakeHrIban, fakeOib, freshSeed } from '../../helpers/fake'
import { linkIn, waitForMail } from './mail'

// Made-up data only: example.test addresses, generated OIB/IBAN (tests/helpers/fake.ts).

export const PASSWORD = 'e2e-Passw0rd-only'

let counter = 0
export function uniqueEmail(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}${counter}@example.test`
}

export type Obrt = { email: string; slug: string; tradeName: string }

/** Registers, verifies the address through the mail link and lands on /app/novi-obrt. */
export async function registerVerified(page: Page, email: string): Promise<void> {
  await page.goto('/registracija')
  await page.getByLabel('E-pošta').fill(email)
  await page.getByLabel('Lozinka', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Ponovite lozinku').fill(PASSWORD)
  await page.getByLabel(/Prihvaćam/).check()
  // Better Auth rate-limits sign-ups per IP (a few per 10 s) and all tests share one IP, so wait
  // out the window and submit again when the form reports "Previše pokušaja".
  const sent = page.getByText('Provjerite e-poštu', { exact: true })
  const tooMany = page.getByText('Previše pokušaja')
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByRole('button', { name: 'Registriraj se' }).click()
    const outcome = await Promise.race([
      sent.waitFor({ timeout: 20_000 }).then(() => 'sent' as const),
      tooMany.waitFor({ timeout: 20_000 }).then(() => 'limited' as const),
    ])
    if (outcome === 'sent') break
    await page.waitForTimeout(11_000)
  }
  await expect(sent).toBeVisible()

  const mail = await waitForMail(email, 'Potvrd')
  await page.goto(linkIn(mail, '/api/auth/verify-email'))
}

/** Fills the onboarding form with a generated OIB and IBAN. */
export async function setUpObrt(page: Page, tradeName: string, email: string): Promise<Obrt> {
  await page.waitForURL('**/app/novi-obrt')
  const rng = createRng(freshSeed())
  await page.getByLabel('Naziv obrta').fill(tradeName)
  await page.getByLabel('Ime i prezime vlasnika').fill('Test Vlasnik')
  await page.getByLabel('OIB', { exact: true }).fill(fakeOib(rng))
  await page.getByLabel('Ulica i kućni broj').fill('Testna ulica 1')
  await page.getByLabel('Poštanski broj').fill('10000')
  await page.getByLabel('Mjesto').fill('Zagreb')
  await page.getByLabel('IBAN poslovnog računa').fill(fakeHrIban(rng))
  await page.getByLabel(/E-pošta obrta/).fill(email)
  await page.getByLabel(/Nisam u sustavu PDV-a/).check()
  await page.getByRole('button', { name: 'Postavi obrt' }).click()
  await page.waitForURL(/\/app\/(?!novi-obrt$)[^/]+$/)
  const slug = new URL(page.url()).pathname.split('/')[2]!
  return { email, slug, tradeName }
}

/** A fresh browser context with a registered, verified user who owns a new obrt. */
export async function newOwner(
  browser: Browser,
  tradeName: string,
): Promise<{ context: BrowserContext; page: Page; obrt: Obrt }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const email = uniqueEmail('owner')
  await registerVerified(page, email)
  const obrt = await setUpObrt(page, tradeName, email)
  return { context, page, obrt }
}

export async function addCustomer(
  page: Page,
  slug: string,
  input: {
    name: string
    business?: { oib: string; street: string; postalCode: string; city: string }
  },
): Promise<void> {
  await page.goto(`/app/${slug}/kupci/novi`)
  if (input.business) {
    await page.getByLabel('Poslovni subjekt').check()
    await page.getByLabel('OIB', { exact: true }).fill(input.business.oib)
    await page.getByLabel(/Ulica i kućni broj/).fill(input.business.street)
    await page.getByLabel(/Poštanski broj/).fill(input.business.postalCode)
    await page.getByLabel(/Mjesto/).fill(input.business.city)
  }
  await page.getByLabel(input.business ? 'Naziv' : 'Ime i prezime').fill(input.name)
  await page.getByRole('button', { name: 'Dodaj kupca' }).click()
  await page.waitForURL(`**/app/${slug}/kupci`)
}
