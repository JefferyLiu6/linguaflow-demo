/**
 * Internal feedback reporting tool.
 *
 * Prints helpfulness stats from the AiResponseFeedback table.
 * Not a public page — run locally with DATABASE_URL set:
 *
 *   DATABASE_URL=... npx ts-node --project tsconfig.json scripts/feedback-report.ts
 *   (or via tsx: DATABASE_URL=... npx tsx scripts/feedback-report.ts)
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function pct(n: number, d: number): string {
  if (d === 0) return '—'
  return `${Math.round((n / d) * 100)}%`
}

async function main() {
  const all = await prisma.aiResponseFeedback.findMany({
    orderBy: { createdAt: 'desc' },
  })

  if (all.length === 0) {
    console.log('No feedback rows found.')
    return
  }

  const total     = all.length
  const helpful   = all.filter(r => r.helpful).length
  const unhelpful = total - helpful

  console.log('\n── Overall ─────────────────────────────────────')
  console.log(`  total       ${total}`)
  console.log(`  helpful     ${helpful}  (${pct(helpful, total)})`)
  console.log(`  not helpful ${unhelpful}  (${pct(unhelpful, total)})`)

  // By surface
  const bySurface: Record<string, { h: number; n: number }> = {}
  for (const r of all) {
    const k = r.surface
    if (!bySurface[k]) bySurface[k] = { h: 0, n: 0 }
    bySurface[k].n++
    if (r.helpful) bySurface[k].h++
  }
  console.log('\n── By surface ──────────────────────────────────')
  for (const [surface, { h, n }] of Object.entries(bySurface).sort()) {
    console.log(`  ${surface.padEnd(10)} ${pct(h, n).padStart(5)}  (${h}/${n})`)
  }

  // By mode
  const byMode: Record<string, { h: number; n: number }> = {}
  for (const r of all) {
    const k = r.mode
    if (!byMode[k]) byMode[k] = { h: 0, n: 0 }
    byMode[k].n++
    if (r.helpful) byMode[k].h++
  }
  console.log('\n── By mode/route ───────────────────────────────')
  for (const [mode, { h, n }] of Object.entries(byMode).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${mode.padEnd(30)} ${pct(h, n).padStart(5)}  (${h}/${n})`)
  }

  // By source note
  const bySource: Record<string, { title: string; h: number; n: number }> = {}
  for (const r of all) {
    const k = r.sourceId
    if (!bySource[k]) bySource[k] = { title: r.sourceTitle, h: 0, n: 0 }
    bySource[k].n++
    if (r.helpful) bySource[k].h++
  }
  const sourceEntries = Object.entries(bySource).sort((a, b) => b[1].n - a[1].n)

  console.log('\n── By source note (most referenced) ────────────')
  for (const [sourceId, { title, h, n }] of sourceEntries.slice(0, 10)) {
    console.log(`  ${sourceId.padEnd(36)} ${pct(h, n).padStart(5)}  (${h}/${n})  ${title}`)
  }

  // Low-helpfulness notes (min 3 responses, unhelpful rate > 40%)
  const lowHelpfulness = sourceEntries.filter(([, { h, n }]) => n >= 3 && (n - h) / n > 0.4)
  if (lowHelpfulness.length > 0) {
    console.log('\n── Low-helpfulness source notes (≥3 responses, >40% unhelpful) ──')
    for (const [sourceId, { title, h, n }] of lowHelpfulness) {
      console.log(`  ${sourceId.padEnd(36)} ${pct(h, n).padStart(5)}  (${h}/${n})  ${title}`)
    }
  }

  console.log()
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
