import type { Metadata } from 'next'
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { Nav } from '@/components/Nav'

// Display / headings / large numbers — sharp, architectural geometric sans
const spaceGrotesk = Space_Grotesk({
  variable: '--font-fraunces',   // keep existing variable name — zero component changes needed
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
})

// Primary UI & body — highly legible, neutral modern sans
const inter = Inter({
  variable: '--font-manrope',    // keep existing variable name
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
})

// Data, timers, inputs, code — crisp technical monospace
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

const demoRefreshResetScript = `
(() => {
  try {
    localStorage.removeItem('linguaflow_demo_sessions');
    localStorage.removeItem('linguaflow_demo_language');
    localStorage.removeItem('linguaflow_demo_custom_list');
  } catch {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen flex flex-col antialiased">
        <Script
          id="demo-refresh-reset"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: demoRefreshResetScript }}
        />
        <Nav />
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  )
}
