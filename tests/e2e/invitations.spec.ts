import { expect, test } from '@playwright/test'
import { addCustomer, newOwner, registerVerified, uniqueEmail } from './helpers/app'
import { linkIn, waitForMail } from './helpers/mail'

// Test plan item 17: the owner invites an accountant; the accountant accepts, sees customers and
// cannot open the "Pozovi člana" form.
test('invited accountant joins, sees customers and cannot invite', async ({ browser }) => {
  const owner = await newOwner(browser, 'Obrt Pozivni')
  await addCustomer(owner.page, owner.obrt.slug, { name: 'Kupac Za Knjigovođu' })

  // The accountant registers and verifies first (the invitation page needs a verified address).
  const accountantEmail = uniqueEmail('accountant')
  const accountantContext = await browser.newContext()
  const accountant = await accountantContext.newPage()
  await registerVerified(accountant, accountantEmail)
  await expect(accountant).toHaveURL(/\/app\/novi-obrt/)

  // The owner invites them (default role: Knjigovođa).
  await owner.page.goto(`/app/${owner.obrt.slug}/postavke/clanovi`)
  await owner.page.getByLabel('E-pošta osobe').fill(accountantEmail)
  await owner.page.getByRole('button', { name: 'Pozovi člana' }).click()
  await expect(owner.page.getByText('Pozivnica je poslana.')).toBeVisible()

  // The accountant opens the link from the mail and accepts.
  const mail = await waitForMail(accountantEmail, 'Pozivnica')
  await accountant.goto(linkIn(mail, '/pozivnica/'))
  await expect(accountant.getByText('Pozvani ste u obrt')).toBeVisible()
  await accountant.getByRole('button', { name: 'Prihvati' }).click()
  await accountant.waitForURL(`**/app/${owner.obrt.slug}`)

  // Sees the customers.
  await accountant.goto(`/app/${owner.obrt.slug}/kupci`)
  await expect(accountant.getByRole('link', { name: 'Kupac Za Knjigovođu' })).toBeVisible()

  // The members page shows the member list but no invite form.
  await accountant.goto(`/app/${owner.obrt.slug}/postavke/clanovi`)
  await expect(accountant.getByRole('heading', { name: 'Članovi', exact: true })).toBeVisible()
  await expect(accountant.getByText(accountantEmail).first()).toBeVisible()
  await expect(accountant.getByText('Pozovi člana')).toHaveCount(0)
  await expect(accountant.getByLabel('E-pošta osobe')).toHaveCount(0)

  // The server-side refusal of inviteMember for a non-owner is covered by the integration test
  // tests/integration/org-actions.test.ts; server actions have no stable URL to call from here.

  await owner.context.close()
  await accountantContext.close()
})
