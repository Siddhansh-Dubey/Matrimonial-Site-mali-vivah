import type { Metadata, Viewport } from 'next'
import './globals.css'
import { I18nProvider } from '@/lib/i18n/provider'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
import { getSiteConfig } from '@/lib/site-config'

export const metadata: Metadata = {
  title: { default: 'Mali Vivah — Matrimony for the Mali Samaj', template: '%s | Mali Vivah' },
  description:
    'Mali Vivah is a trusted matrimonial platform for the Mali Samaj — verified profiles, private contact sharing and a respectful search experience.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#c92c4b',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Request-cached; falls back to compiled defaults when the DB is missing.
  const config = await getSiteConfig()
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col font-sans">
        <I18nProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter whatsappNumber={config.supportWhatsapp} />
        </I18nProvider>
      </body>
    </html>
  )
}
