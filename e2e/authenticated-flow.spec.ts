import { expect, test } from 'playwright/test'
import { getDB } from '../lib/drills'

const authEmail = process.env.E2E_AUTH_EMAIL
const authPassword = process.env.E2E_AUTH_PASSWORD

const spanishPhraseAnswers = new Map(
  getDB('es')
    .filter((item) => item.category === 'phrase')
    .map((item) => [item.prompt, item.answer]),
)

test.describe('authenticated flow', () => {
  test.skip(!authEmail || !authPassword, 'Requires E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.')

  test.beforeEach(async ({ context, page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
    await context.clearCookies()
  })

  test('persists drill history across refresh for a signed-in user', async ({ page }) => {
    await page.goto('/login')

    await page.getByLabel('Email').fill(authEmail!)
    await page.getByLabel('Password').fill(authPassword!)
    await page.getByRole('button', { name: 'Sign In' }).click()

    await expect(page).toHaveURL(/\/dashboard$/)

    await page.goto('/drill')
    await page.getByRole('button', { name: 'Select Phrase mode' }).click()

    const decreaseCount = page.getByRole('button', { name: 'Decrease item count' })
    for (let count = 10; count > 4; count -= 1) {
      await decreaseCount.click()
    }

    await page.getByTestId('begin-session').click()
    await expect(page).toHaveURL(/\/drill$/)

    for (let index = 0; index < 4; index += 1) {
      const prompt = (await page.getByTestId('drill-prompt').textContent())?.trim()
      expect(prompt).toBeTruthy()

      const answer = prompt ? spanishPhraseAnswers.get(prompt) : undefined
      expect(answer, `Missing Spanish phrase answer for prompt: ${prompt ?? '[empty]'}`).toBeTruthy()

      await page.getByLabel('Response').fill(answer!)
      await page.getByRole('button', { name: 'Submit' }).click()

      const feedbackPanel = page.getByTestId('drill-feedback')
      await expect(feedbackPanel).toContainText('Correct.')
      await feedbackPanel.getByRole('button', { name: index === 3 ? /View results/ : /^Next/ }).click()
    }

    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByText('across 1 sessions')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Training Results' })).toBeVisible()
    await expect(page.getByText('across 1 sessions')).toBeVisible()
  })
})
