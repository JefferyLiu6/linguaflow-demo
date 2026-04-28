import type { Metadata } from 'next'
import { Playfair_Display, DM_Sans, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { Nav } from '@/components/Nav'
import { getAuthState } from '@/lib/auth'

// Display / headings — Playfair Display per Grove design spec
const playfair = Playfair_Display({
  variable: '--font-fraunces',   // keep existing variable name — zero component changes needed
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
})

// Body / UI — DM Sans per Grove design spec
const dmSans = DM_Sans({
  variable: '--font-manrope',    // keep existing variable name — zero component changes needed
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
})

// Code / prompts — JetBrains Mono per Grove design spec
const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
})

export const metadata: Metadata = {
  title: 'LinguaFlow — AI Language Coaching System',
  description: 'Audio-lingual drills. Timed. Unforgiving. Accuracy-first.',
}

function serializeInlineScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getAuthState()
  const authBootstrapScript = `window.__LINGUAFLOW_AUTH__ = ${serializeInlineScript(user)};`

  return (
    <html lang="en" className={`${playfair.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen flex flex-col antialiased">
        <Script
          id="auth-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: authBootstrapScript }}
        />
        <Nav initialUser={user} />
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  )
}
