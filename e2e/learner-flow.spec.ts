import { expect, test, type BrowserContext } from 'playwright/test'
import { getDB } from '../lib/drills'

const spanishPhraseAnswers = new Map(
  getDB('es')
    .filter(item => item.category === 'phrase')
    .map(item => [item.prompt, item.answer]),
)

async function getDemoCookieValue(context: BrowserContext) {
  const cookies = await context.cookies()
  return cookies.find(cookie => cookie.name === 'linguaflow_demo_sid')?.value
}

test.describe('learner flow', () => {
  test.beforeEach(async ({ context, page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
    await context.clearCookies()
  })

  test('completes a built-in session, records the result, and keeps guest data across refresh', async ({ page }) => {
    await page.goto('/')

    const initialDemoCookie = await getDemoCookieValue(page.context())
    expect(initialDemoCookie).toBeTruthy()

    await page.locator('main').getByRole('link', { name: 'Begin Training' }).first().click()
    await expect(page.getByRole('heading', { name: 'New Session' })).toBeVisible()

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
    await expect(page.getByRole('heading', { name: 'Training Results' })).toBeVisible()
    await expect(page.getByText('Rolling Accuracy')).toBeVisible()
    await expect(page.getByText('across 1 sessions')).toBeVisible()

    const sessions = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('linguaflow_demo_sessions') ?? '[]'),
    )

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      drillType: 'phrase',
      language: 'es',
      total: 4,
      correct: 4,
      accuracy: 100,
    })

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Training Results' })).toBeVisible()
    await expect(page.getByText('across 1 sessions')).toBeVisible()

    const sessionsAfterReload = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('linguaflow_demo_sessions') ?? '[]'),
    )

    expect(sessionsAfterReload).toHaveLength(1)
    expect(sessionsAfterReload[0]).toMatchObject({
      drillType: 'phrase',
      language: 'es',
      total: 4,
      correct: 4,
      accuracy: 100,
    })

    const demoCookieAfterReload = await getDemoCookieValue(page.context())
    expect(demoCookieAfterReload).toBeTruthy()
    expect(demoCookieAfterReload).toBe(initialDemoCookie)
  })
})
