import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { chromium } from 'playwright'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const baseUrl = process.env.DEMO_GIF_BASE_URL ?? 'http://127.0.0.1:3001'
const outputDir = path.join(repoRoot, 'docs', 'demo')
const outputGif = path.join(outputDir, 'linguaflow-demo.gif')
const tempDir = path.join(repoRoot, '.tmp', 'demo-gif')
const paletteFile = path.join(tempDir, 'palette.png')

let frameIndex = 0

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      ...options,
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
    child.on('error', reject)
  })
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true })
}

async function cleanDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true })
  await ensureDir(dir)
}

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function chromeExecutablePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ]

  return candidates.find(candidate => fs.existsSync(candidate))
}

function buildDemoSessions() {
  const now = Date.now()

  const makeItem = (id, prompt, answer, type = 'translation') => ({
    id,
    type,
    instruction: 'Translate to Spanish.',
    prompt,
    answer,
    promptLang: 'en-US',
  })

  const makeResult = (item, userAnswer, correct, timeUsed, extra = {}) => ({
    item,
    correct,
    timedOut: false,
    userAnswer,
    timeUsed,
    ...extra,
  })

  const sessionAResults = [
    makeResult(makeItem('a1', 'Good morning.', 'Buenos días.'), 'Buenos días.', true, 8),
    makeResult(makeItem('a2', 'Where is the hotel?', '¿Dónde está el hotel?'), 'Donde hotel', false, 11),
    makeResult(makeItem('a3', 'We need a taxi.', 'Necesitamos un taxi.'), 'Necesitamos un taxi.', true, 9),
    makeResult(makeItem('a4', 'Do you speak English?', '¿Habla usted inglés?'), '¿Habla usted inglés?', true, 10),
    makeResult(makeItem('a5', 'What time does the train leave?', '¿A qué hora sale el tren?'), '¿A qué hora sale el tren?', true, 13),
  ]

  const sessionBResults = [
    makeResult(makeItem('b1', 'Thank you.', 'Gracias.'), 'Gracias.', true, 4),
    makeResult(makeItem('b2', 'See you later.', 'Hasta luego.'), 'Hasta luego.', true, 5),
    makeResult(makeItem('b3', 'The bill, please.', 'La cuenta, por favor.'), '', false, 20, { timedOut: true }),
    makeResult(makeItem('b4', 'No problem.', 'No hay problema.'), 'No hay problema.', true, 6),
    makeResult(makeItem('b5', 'Coffee', 'el café'), 'cafe', true, 5),
  ]

  const sessionCResults = [
    makeResult(makeItem('c1', 'I do not understand.', 'No entiendo.'), 'No entiendo.', true, 7),
    makeResult(makeItem('c2', 'Please speak more slowly.', 'Hable más despacio, por favor.'), 'Más despacio.', false, 14),
    makeResult(makeItem('c3', 'My passport is at the hotel.', 'Mi pasaporte está en el hotel.'), 'Mi pasaporte está en el hotel.', true, 12),
    makeResult(makeItem('c4', 'A table for two, please.', 'Una mesa para dos, por favor.'), 'Una mesa por favor.', false, 9),
    makeResult(makeItem('c5', 'Good luck.', 'Buena suerte.'), 'Buena suerte.', true, 6),
  ]

  const summarize = (id, date, drillType, results) => {
    const correct = results.filter(result => result.correct).length
    const avgTime = results.reduce((sum, result) => sum + result.timeUsed, 0) / results.length
    return {
      id,
      date,
      drillType,
      correct,
      total: results.length,
      accuracy: Math.round(correct / results.length * 100),
      avgTime: Math.round(avgTime * 10) / 10,
      results,
      language: 'es',
    }
  }

  return [
    summarize('session-a', now, 'sentence', sessionAResults),
    summarize('session-b', now - 86_400_000, 'phrase', sessionBResults),
    summarize('session-c', now - 2 * 86_400_000, 'mixed', sessionCResults),
  ]
}

async function captureHold(page, label, frames = 6) {
  await wait(250)
  for (let i = 0; i < frames; i += 1) {
    const framePath = path.join(tempDir, `frame-${String(frameIndex).padStart(3, '0')}.png`)
    await page.screenshot({ path: framePath })
    frameIndex += 1
  }
  console.log(`Captured ${label}`)
}

async function makeGif() {
  await ensureDir(outputDir)
  await cleanDir(tempDir)

  const executablePath = chromeExecutablePath()
  const browser = await chromium.launch(
    executablePath
      ? { headless: true, executablePath }
      : { headless: true, channel: 'chrome' },
  )

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'networkidle' })

    await captureHold(page, 'home', 8)

    await page.getByRole('link', { name: 'Begin Training' }).first().click()
    await page.getByText('New Session').waitFor()
    await captureHold(page, 'config', 6)

    await page.getByRole('button', { name: 'Begin Session' }).click()
    await page.getByPlaceholder('Type your answer…').waitFor()
    await captureHold(page, 'prompt', 7)

    await page.getByPlaceholder('Type your answer…').fill('hola')
    await captureHold(page, 'typed answer', 4)

    await page.getByRole('button', { name: 'Submit' }).click()
    await page.waitForFunction(() => {
      const text = document.body.innerText
      return text.includes('Correct.') || text.includes('Incorrect.') || text.includes('Time expired.')
    })
    await captureHold(page, 'feedback', 8)

    const demoSessions = buildDemoSessions()
    await page.evaluate((sessions) => {
      localStorage.setItem('linguaflow_demo_sessions', JSON.stringify(sessions))
      localStorage.setItem('linguaflow_demo_language', JSON.stringify('es'))
    }, demoSessions)

    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' })
    await page.getByText('Training Results').waitFor()
    await captureHold(page, 'dashboard', 10)
  } finally {
    await browser.close()
  }

  await run('ffmpeg', [
    '-y',
    '-framerate', '8',
    '-i', path.join(tempDir, 'frame-%03d.png'),
    '-vf', 'fps=8,scale=1200:-1:flags=lanczos,palettegen',
    paletteFile,
  ])

  await run('ffmpeg', [
    '-y',
    '-framerate', '8',
    '-i', path.join(tempDir, 'frame-%03d.png'),
    '-i', paletteFile,
    '-lavfi', 'fps=8,scale=1200:-1:flags=lanczos[x];[x][1:v]paletteuse',
    '-loop', '0',
    outputGif,
  ])

  console.log(`GIF written to ${outputGif}`)
}

makeGif().catch((error) => {
  console.error(error)
  process.exit(1)
})
