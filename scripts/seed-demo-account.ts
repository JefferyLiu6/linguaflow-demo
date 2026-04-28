/**
 * Seed (or reset) the shared reviewer demo account to a known baseline.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/seed-demo-account.ts <userId>
 *
 * The userId is the Supabase Auth UUID of the reviewer/demo account.
 * Run `scripts/get-demo-user-id.ts` or check the Supabase dashboard to find it.
 *
 * What this creates:
 *   - UserSettings: language = 'en'
 *   - DrillSession × 12: English sessions over the past 14 days covering
 *     substitution, transformation, phrase, and vocab drill types —
 *     enough for the planner to produce useful recommendations immediately.
 *   - CustomList: 8 advanced-synonym items that demonstrate the custom-list flow.
 *
 * This script is fully idempotent: existing data is deleted and re-created
 * on each run so a reviewer account can be reset without manual cleanup.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const userId = process.argv[2]
if (!userId) {
  console.error('Usage: npx tsx scripts/seed-demo-account.ts <userId>')
  process.exit(1)
}

// ── Session data ──────────────────────────────────────────────────────────────

const now = Date.now()
const day = 86_400_000

function sessionId(suffix: string) {
  return `reviewer-seed-${suffix}`
}

function result(
  itemId: string,
  type: string,
  topic: string,
  prompt: string,
  answer: string,
  correct: boolean,
  timeUsed = 8.5,
) {
  return {
    item: {
      id: itemId,
      type,
      category: type === 'translation' ? 'phrase' : 'sentence',
      topic,
      instruction: type === 'translation' ? 'Express formally.' : 'Replace the bracketed word.',
      prompt,
      answer,
      promptLang: 'en-US',
    },
    correct,
    timedOut: false,
    userAnswer: correct ? answer : '',
    timeUsed,
  }
}

const sessions = [
  // Day −13: first substitution session
  {
    clientSessionId: sessionId('01'),
    date: now - 13 * day,
    drillType: 'substitution',
    language: 'en',
    correct: 7,
    total: 10,
    accuracy: 70,
    avgTime: 9.2,
    results: [
      result('en01', 'substitution', 'daily',  'The project was very [big].',                  'substantial', true),
      result('en02', 'substitution', 'work',   'Please [use] the correct procedure.',          'utilize',     true),
      result('en03', 'substitution', 'daily',  'We need to [get] approval first.',             'obtain',      false),
      result('en04', 'substitution', 'work',   'She wants to [show] her findings.',            'present',     true),
      result('en05', 'substitution', 'daily',  'Can you [help] me with this task?',            'assist',      true),
      result('en06', 'substitution', 'work',   'That was a [good] decision.',                  'sound',       false),
      result('en07', 'substitution', 'work',   'He [talked about] the risks at length.',       'addressed',   true),
      result('en08', 'substitution', 'daily',  'The plan has a [bad] flaw.',                  'critical',    true),
      result('en09', 'substitution', 'work',   'The team made a [fast] turnaround.',           'swift',       true),
      result('en10', 'substitution', 'daily',  'Her argument was very [clear].',               'lucid',       false),
    ],
  },
  // Day −11: vocab session
  {
    clientSessionId: sessionId('02'),
    date: now - 11 * day,
    drillType: 'substitution',
    language: 'en',
    correct: 6,
    total: 8,
    accuracy: 75,
    avgTime: 7.8,
    results: [
      result('en_v1',  'substitution', 'daily', 'start (verb)',    'initiate',    true),
      result('en_v2',  'substitution', 'daily', 'end (verb)',      'conclude',    true),
      result('en_v3',  'substitution', 'daily', 'ask (verb)',      'inquire',     false),
      result('en_v4',  'substitution', 'work',  'tell (verb)',     'inform',      true),
      result('en_v5',  'substitution', 'work',  'need (verb)',     'require',     false),
      result('en_v6',  'substitution', 'daily', 'change (verb)',   'modify',      true),
      result('en_v7',  'substitution', 'daily', 'look at (verb)',  'examine',     true),
      result('en_v8',  'substitution', 'daily', 'smart (adj)',     'astute',      true),
    ],
  },
  // Day −10: phrase session (translation)
  {
    clientSessionId: sessionId('03'),
    date: now - 10 * day,
    drillType: 'translation',
    language: 'en',
    correct: 4,
    total: 6,
    accuracy: 67,
    avgTime: 14.1,
    results: [
      result('en_p1', 'translation', 'work',  "Let's talk about this later.",    "I suggest we revisit this matter at a later time.", true,  13.2),
      result('en_p2', 'translation', 'work',  'Can you look into that?',          'Could you investigate that matter?',                false, 16.5),
      result('en_p3', 'translation', 'daily', "I don't get what you mean.",       'I am uncertain I understand your point.',           true,  11.8),
      result('en_p4', 'translation', 'work',  "That's a great idea.",             'That is an excellent proposition.',                 true,  12.9),
      result('en_p5', 'translation', 'daily', "I'll get back to you.",            'I will follow up with you shortly.',                false, 15.3),
      result('en_p6', 'translation', 'work',  'We need to figure this out.',      'We must resolve this matter.',                     true,  13.7),
    ],
  },
  // Day −9: transformation session
  {
    clientSessionId: sessionId('04'),
    date: now - 9 * day,
    drillType: 'transformation',
    language: 'en',
    correct: 5,
    total: 7,
    accuracy: 71,
    avgTime: 16.4,
    results: [
      result('en09', 'transformation', 'work',  'Please review this draft.',       'This draft is requested to be reviewed.',           true,  15.2),
      result('en10', 'transformation', 'daily', 'The committee reviewed the proposal.', 'The proposal was reviewed by the committee.',  true,  14.8),
      result('en11', 'transformation', 'daily', 'She studied the data. She reached a conclusion.', 'Having studied the data, she reached a conclusion.', false, 18.9),
      result('en12', 'transformation', 'work',  'They completed the merger.',       'The merger was completed.',                        true,  15.1),
      result('en13', 'transformation', 'daily', 'The manager announced the results.', 'The results were announced by the manager.',    true,  14.5),
      result('en14', 'transformation', 'work',  'Fix this bug immediately.',        'It is requested that this bug be fixed immediately.', false, 19.3),
      result('en15', 'transformation', 'work',  'Mistakes were made by the team.', 'The team made mistakes.',                         true,  15.8),
    ],
  },
  // Day −8: substitution — formal register focus
  {
    clientSessionId: sessionId('05'),
    date: now - 8 * day,
    drillType: 'substitution',
    language: 'en',
    correct: 8,
    total: 10,
    accuracy: 80,
    avgTime: 8.1,
    results: [
      result('en16', 'substitution', 'work', "He's really good at his job.",                 'He demonstrates exceptional professional competence.', true),
      result('en17', 'substitution', 'work', 'The report looks at the data.',                'The report examines the data.',                        true),
      result('en18', 'substitution', 'work', 'They got a good result.',                      'They achieved a commendable outcome.',                 true),
      result('en19', 'substitution', 'daily','The meeting was a waste of time.',             'The meeting proved unproductive.',                    false),
      result('en01', 'substitution', 'daily','The project was very [big].',                  'substantial',                                          true),
      result('en03', 'substitution', 'daily','We need to [get] approval first.',             'obtain',                                               true),
      result('en05', 'substitution', 'daily','Can you [help] me with this task?',            'assist',                                               true),
      result('en06', 'substitution', 'work', 'That was a [good] decision.',                  'sound',                                                false),
      result('en07', 'substitution', 'work', 'He [talked about] the risks at length.',       'addressed',                                            true),
      result('en08', 'substitution', 'daily','The plan has a [bad] flaw.',                  'critical',                                             true),
    ],
  },
  // Day −7: sport vocab (tests domain vocab precision)
  {
    clientSessionId: sessionId('06'),
    date: now - 7 * day,
    drillType: 'substitution',
    language: 'en',
    correct: 3,
    total: 5,
    accuracy: 60,
    avgTime: 9.5,
    results: [
      result('en_sp6', 'substitution', 'sport', 'win (verb)',                     'triumph',          false),
      result('en_sp7', 'substitution', 'sport', 'lose (verb, competition)',        'concede',          true),
      result('en_sp8', 'substitution', 'sport', 'practice session (noun)',         'training session', true),
      result('en_sp1', 'substitution', 'sport', 'did well in the match',           'excelled',         false),
      result('en_sp2', 'substitution', 'sport', 'worked hard to improve',          'refined',          true),
    ],
  },
  // Day −6: money/finance vocab
  {
    clientSessionId: sessionId('07'),
    date: now - 6 * day,
    drillType: 'substitution',
    language: 'en',
    correct: 5,
    total: 6,
    accuracy: 83,
    avgTime: 8.7,
    results: [
      result('en_mo1', 'substitution', 'money', 'money coming in (noun)',          'revenue',     true),
      result('en_mo2', 'substitution', 'money', 'money going out (noun)',          'expenditure', true),
      result('en_mo3', 'substitution', 'money', 'save money (phrase)',             'economize',   true),
      result('en_mo4', 'substitution', 'money', 'debt (noun)',                     'liability',   false),
      result('en_mo5', 'substitution', 'money', 'ownership share (noun)',          'equity',      true),
      result('en_mo6', 'substitution', 'money', 'get money back (phrase)',         'recoup',      true),
    ],
  },
  // Day −5: work phrases
  {
    clientSessionId: sessionId('08'),
    date: now - 5 * day,
    drillType: 'translation',
    language: 'en',
    correct: 4,
    total: 5,
    accuracy: 80,
    avgTime: 13.5,
    results: [
      result('en_w1', 'translation', 'work', 'Please review the attached document.', 'I would appreciate your review of the enclosed document.', true, 13.1),
      result('en_w2', 'translation', 'work', 'Can we meet on Friday?',               'Would it be possible to arrange a meeting on Friday?',     true, 12.8),
      result('en_w3', 'translation', 'work', 'Write in formal business language.',   'I am writing to formally notify you of the following.',   false, 17.2),
      result('en_w4', 'translation', 'work', 'We need your approval.',               'We kindly request your approval at your earliest convenience.', true, 13.9),
      result('en_w5', 'translation', 'work', 'a meeting with the client',            'a consultation with the client',                          true, 11.4),
    ],
  },
  // Day −4: mixed session — substitution + transformation
  {
    clientSessionId: sessionId('09'),
    date: now - 4 * day,
    drillType: 'substitution',
    language: 'en',
    correct: 9,
    total: 10,
    accuracy: 90,
    avgTime: 7.6,
    results: [
      result('en_v9',  'substitution', 'daily', 'wrong (adj)',        'erroneous',    true),
      result('en_v10', 'substitution', 'daily', 'important (adj)',    'paramount',    true),
      result('en_v11', 'substitution', 'work',  'fair (adj)',         'equitable',    true),
      result('en_v12', 'substitution', 'daily', 'fast (adj)',         'expeditious',  true),
      result('en_v13', 'substitution', 'daily', 'clear (adj)',        'unambiguous',  true),
      result('en_v14', 'substitution', 'work',  'agree (verb)',       'concur',       false),
      result('en_v15', 'substitution', 'work',  'make (verb)',        'construct',    true),
      result('en_w6',  'substitution', 'work',  'the [information] was shared', 'data', true),
      result('en_w7',  'substitution', 'work',  'the [boss] approved', 'line manager', true),
      result('en01',   'substitution', 'daily', 'The project was very [big].', 'substantial', true),
    ],
  },
  // Day −3: tech vocabulary
  {
    clientSessionId: sessionId('10'),
    date: now - 3 * day,
    drillType: 'substitution',
    language: 'en',
    correct: 4,
    total: 5,
    accuracy: 80,
    avgTime: 8.9,
    results: [
      result('en_t1', 'substitution', 'tech', 'use (verb, tech)',     'deploy',     true),
      result('en_t2', 'substitution', 'tech', 'find the cause of',    'diagnose',   true),
      result('en_t3', 'substitution', 'tech', 'set up (software)',    'configure',  false),
      result('en_t4', 'substitution', 'tech', 'test for bugs',        'debug',      true),
      result('en_t5', 'substitution', 'tech', 'make faster',          'optimize',   true),
    ],
  },
  // Day −2: strong substitution session
  {
    clientSessionId: sessionId('11'),
    date: now - 2 * day,
    drillType: 'substitution',
    language: 'en',
    correct: 9,
    total: 10,
    accuracy: 90,
    avgTime: 7.2,
    results: [
      result('en01', 'substitution', 'daily', 'The project was very [big].',           'substantial', true),
      result('en02', 'substitution', 'work',  'Please [use] the correct procedure.',   'utilize',     true),
      result('en03', 'substitution', 'daily', 'We need to [get] approval first.',      'obtain',      true),
      result('en04', 'substitution', 'work',  'She wants to [show] her findings.',     'present',     true),
      result('en05', 'substitution', 'daily', 'Can you [help] me with this task?',     'assist',      true),
      result('en06', 'substitution', 'work',  'That was a [good] decision.',           'sound',       true),
      result('en07', 'substitution', 'work',  'He [talked about] the risks.',          'addressed',   true),
      result('en08', 'substitution', 'daily', 'The plan has a [bad] flaw.',           'critical',    true),
      result('en_mo1', 'substitution', 'money','money coming in (noun)',               'revenue',     true),
      result('en_sp6', 'substitution', 'sport','win (verb)',                           'triumph',     false),
    ],
  },
  // Day −1: most recent — translation (phrases)
  {
    clientSessionId: sessionId('12'),
    date: now - 1 * day,
    drillType: 'translation',
    language: 'en',
    correct: 5,
    total: 6,
    accuracy: 83,
    avgTime: 12.8,
    results: [
      result('en_p1', 'translation', 'work',  "Let's talk about this later.",      "I suggest we revisit this matter at a later time.",  true,  12.1),
      result('en_p3', 'translation', 'daily', "I don't get what you mean.",         'I am uncertain I understand your point.',            true,  11.5),
      result('en_p4', 'translation', 'work',  "That's a great idea.",               'That is an excellent proposition.',                  true,  12.7),
      result('en_p6', 'translation', 'work',  'We need to figure this out.',        'We must resolve this matter.',                      true,  13.0),
      result('en_w8', 'translation', 'work',  "We're losing money.",                'The organization is experiencing a revenue deficit.', false, 18.4),
      result('en_mo9','translation', 'money', "We're in the red.",                  'The organization is operating at a deficit.',        true,  14.2),
    ],
  },
]

// ── Custom list ───────────────────────────────────────────────────────────────

const customListItems = [
  { id: 'custom-seed-1', type: 'substitution', category: 'vocab',    topic: 'work',  instruction: 'Give the advanced synonym.', prompt: 'approve (verb)',    answer: 'ratify',      promptLang: 'en-US' },
  { id: 'custom-seed-2', type: 'substitution', category: 'vocab',    topic: 'work',  instruction: 'Give the advanced synonym.', prompt: 'cancel (verb)',     answer: 'rescind',     promptLang: 'en-US' },
  { id: 'custom-seed-3', type: 'substitution', category: 'vocab',    topic: 'work',  instruction: 'Give the advanced synonym.', prompt: 'discuss (verb)',    answer: 'deliberate',  promptLang: 'en-US' },
  { id: 'custom-seed-4', type: 'substitution', category: 'vocab',    topic: 'daily', instruction: 'Give the advanced synonym.', prompt: 'careful (adj)',     answer: 'meticulous',  promptLang: 'en-US' },
  { id: 'custom-seed-5', type: 'substitution', category: 'vocab',    topic: 'daily', instruction: 'Give the advanced synonym.', prompt: 'harmful (adj)',     answer: 'detrimental', promptLang: 'en-US' },
  { id: 'custom-seed-6', type: 'substitution', category: 'vocab',    topic: 'daily', instruction: 'Give the advanced synonym.', prompt: 'short (adj)',       answer: 'concise',     promptLang: 'en-US' },
  { id: 'custom-seed-7', type: 'translation',  category: 'phrase',   topic: 'work',  instruction: 'Express formally.',         prompt: 'We have to fix this.', answer: 'This matter requires immediate resolution.', promptLang: 'en-US' },
  { id: 'custom-seed-8', type: 'translation',  category: 'phrase',   topic: 'daily', instruction: 'Express formally.',         prompt: 'I was wrong.',       answer: 'I acknowledge my error.',                    promptLang: 'en-US' },
]

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`Seeding reviewer account ${userId} …`)

  // Wipe existing data for this user
  await prisma.drillSession.deleteMany({ where: { userId } })
  await prisma.userSettings.deleteMany({ where: { userId } })
  await prisma.customList.deleteMany({ where: { userId } })

  // Language preference
  await prisma.userSettings.create({ data: { userId, language: 'en' } })

  // Sessions
  await prisma.drillSession.createMany({
    data: sessions.map((s) => ({
      userId,
      clientSessionId: s.clientSessionId,
      date:      s.date,
      drillType: s.drillType,
      language:  s.language,
      correct:   s.correct,
      total:     s.total,
      accuracy:  s.accuracy,
      avgTime:   s.avgTime,
      results:   s.results,
    })),
    skipDuplicates: true,
  })

  // Custom list
  await prisma.customList.create({ data: { userId, items: customListItems } })

  console.log(`✓  UserSettings  (language: en)`)
  console.log(`✓  DrillSession  × ${sessions.length}`)
  console.log(`✓  CustomList    × ${customListItems.length} items`)
  console.log(`\nReviewer account is ready.`)
}

seed()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
