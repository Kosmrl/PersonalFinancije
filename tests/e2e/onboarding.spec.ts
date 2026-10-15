import { expect, test } from '@playwright/test'
import { createRng, fakeOib, freshSeed } from '../helpers/fake'
import { registerVerified, setUpObrt, uniqueEmail } from './helpers/app'

// Test plan item 15: register -> verify by mail -> onboarding -> dashboard checklist ->
// customers (person and business) -> item with a sub-cent price.
test('register, verify, onboard, add customers and an item', async ({ page }) => {
  const email = uniqueEmail('owner')
  await registerVerified(page, email)
  const { slug } = await setUpObrt(page, 'Obrt Testni', email)

  // Dashboard checklist: profile done, the rest open.
  await expect(page.getByRole('heading', { name: 'Obrt Testni' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dodajte kupca' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dodajte artikl' })).toBeVisible()

  // Person customer.
  await page.getByRole('link', { name: 'Dodajte kupca' }).click()
  await page.getByLabel('Ime i prezime').fill('Ivo Kupac')
  await page.getByRole('button', { name: 'Dodaj kupca' }).click()
  await page.waitForURL(`**/app/${slug}/kupci`)
  await expect(page.getByRole('link', { name: 'Ivo Kupac' })).toBeVisible()

  // Business customer with a generated OIB.
  await page.getByRole('link', { name: 'Novi kupac' }).first().click()
  await page.getByLabel('Poslovni subjekt').check()
  await page.getByLabel('Naziv').fill('Firma Testna d.o.o.')
  await page.getByLabel('OIB', { exact: true }).fill(fakeOib(createRng(freshSeed())))
  await page.getByLabel(/Ulica i kućni broj/).fill('Poslovna 5')
  await page.getByLabel(/Poštanski broj/).fill('21000')
  await page.getByLabel(/Mjesto/).fill('Split')
  await page.getByRole('button', { name: 'Dodaj kupca' }).click()
  await page.waitForURL(`**/app/${slug}/kupci`)
  await expect(page.getByRole('link', { name: 'Firma Testna d.o.o.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ivo Kupac' })).toBeVisible()

  // Item with a price below one cent per unit, typed with a decimal comma.
  await page.goto(`/app/${slug}/artikli/novi`)
  await page.getByLabel('Naziv', { exact: true }).fill('Usluga po satu')
  await page.getByLabel('Cijena po jedinici').fill('0,125')
  await page.getByRole('button', { name: 'Dodaj artikl' }).click()
  await page.waitForURL(`**/app/${slug}/artikli`)
  const row = page.getByRole('row', { name: /Usluga po satu/ })
  await expect(row).toContainText(/0,125\s€/)

  // The checklist now shows both steps as done (links gone).
  await page.goto(`/app/${slug}`)
  await expect(page.getByRole('link', { name: 'Dodajte kupca' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Dodajte artikl' })).toHaveCount(0)
})

// Test plan item 18: empty states and the error boundary.
test('empty states for a fresh obrt, and the error boundary', async ({ page }) => {
  const email = uniqueEmail('owner')
  await registerVerified(page, email)
  const { slug } = await setUpObrt(page, 'Obrt Prazni', email)

  await page.goto(`/app/${slug}/kupci`)
  await expect(page.getByText('Još nemate kupaca.')).toBeVisible()
  await page.goto(`/app/${slug}/artikli`)
  await expect(page.getByText('Još nemate artikala.')).toBeVisible()

  // Test-only hook (src/server/test-hooks.ts): the page throws, the boundary renders.
  await page.goto(`/app/${slug}/kupci?e2eError=1`)
  await expect(page.getByRole('alert').getByText('Nešto je pošlo po zlu.')).toBeVisible()
  // The boundary shows a generic message, not the error text (the dev overlay is not the boundary).
  await expect(
    page.getByRole('alert').filter({ hasText: 'Nešto je pošlo po zlu.' }),
  ).not.toContainText('e2e forced query failure')
})

test('signed-out visitors cannot reach /app', async ({ page }) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/prijava\?next=/)
})
