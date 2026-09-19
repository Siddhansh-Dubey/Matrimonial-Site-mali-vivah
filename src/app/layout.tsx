import type { Metadata, Viewport } from 'next'
import './globals.css'
import { I18nProvider } from '@/lib/i18n/provider'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
import { getWhatsAppConfig } from '@/lib/site-config'

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
  // Admin-managed WhatsApp values (PRD N) — the footer is a client
  // component, so the configuration is resolved here (server) and passed
  // down as props. Falls back to the static constants when the DB is empty.
  const whatsapp = await getWhatsAppConfig()

  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col font-sans">
        <I18nProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter
            whatsappSupportNumber={whatsapp.supportNumber}
            whatsappCommunityLink={whatsapp.communityLink}
          />
        </I18nProvider>
      </body>
    </html>
  )
}
