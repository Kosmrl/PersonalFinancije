import { expect, test } from '@playwright/test'
import { createRng, fakeOib, freshSeed } from '../helpers/fake'
import { addCustomer, newOwner } from './helpers/app'

// Test plan item 16: user B (another obrt) cannot see user A's customers.
test('another organization gets a 404 and no customer data', async ({ browser }) => {
  const a = await newOwner(browser, 'Obrt A')
  const customerName = 'Tajni Kupac Alfa'
  await addCustomer(a.page, a.obrt.slug, {
    name: customerName,
    business: {
      oib: fakeOib(createRng(freshSeed())),
      street: 'Ulica 1',
      postalCode: '10000',
      city: 'Zagreb',
    },
  })
  await a.page.getByRole('link', { name: customerName }).click()
  await a.page.waitForURL(/\/kupci\/[0-9a-f-]{36}$/)
  const customerPath = new URL(a.page.url()).pathname

  // Sanity: the owner sees it.
  await expect(a.page.getByLabel('Naziv')).toHaveValue(customerName)

  const b = await newOwner(browser, 'Obrt B')
  for (const path of [`/app/${a.obrt.slug}/kupci`, customerPath]) {
    await b.page.goto(path)
    await expect(b.page.getByText('Stranica ne postoji ili nemate pristup.')).toBeVisible()
    const html = await b.page.content()
    expect(html).not.toContain(customerName)
    expect(html).not.toContain('Tajni')
  }

  // The second user's own customer list is unaffected and empty.
  await b.page.goto(`/app/${b.obrt.slug}/kupci`)
  await expect(b.page.getByText('Još nemate kupaca.')).toBeVisible()

  await a.context.close()
  await b.context.close()
})

test('another organization gets HTTP status 404', async ({ browser }) => {
  const a = await newOwner(browser, 'Obrt Status A')
  const b = await newOwner(browser, 'Obrt Status B')
  const response = await b.page.goto(`/app/${a.obrt.slug}/kupci`)
  expect(response?.status()).toBe(404)
  await a.context.close()
  await b.context.close()
})
