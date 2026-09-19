import { getSiteContent, getWhatsAppConfig, supportWhatsappLink, type WhatsAppConfig } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

/**
 * WhatsApp community CTA band (PRD AF + N).
 *
 * Link + copy are database-driven: an admin can set the Join-Community link
 * from /admin/whatsapp and the section text from /admin/content. Until they
 * do, the section falls back to the support chat (always available) and the
 * built-in copy — so the band is never empty and never shows a dead link.
 */
export async function WhatsAppCommunitySection() {
  const [wa, block] = await Promise.all([getWhatsAppConfig(), getSiteContent('whatsapp_community')])

  const title = block?.title && block.title.trim() ? block.title : 'Join the Mali Vivah WhatsApp Community'
  const body = block?.body && block.body.trim() ? block.body : 'Guidance, announcements and community events — all in one place. No spam, ever.'

  const link = wa.communityLink ?? supportWhatsappLink(wa, 'Namaskar, I would like to join the Mali Vivah WhatsApp community.')
  const isCommunity = Boolean(wa.communityLink)

  return (
    <section className="bg-gold-100/60">
      <div className="container-page py-14 sm:py-16">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 rounded-[28px] bg-maroon-deep px-8 py-10 text-center text-white shadow-2xl shadow-maroon/30 sm:flex-row sm:justify-between sm:text-left">
          <div className="max-w-xl">
            <span className="inline-grid h-12 w-12 place-items-center rounded-full bg-[#25d366] shadow-md">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-6 w-6 text-white">
                <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
              </svg>
            </span>
            <h2 className="mt-4 font-display text-2xl font-bold sm:text-3xl">{title}</h2>
            <p className="mt-2 text-sm text-white/75">{body}</p>
            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-gold-300/80">
              {isCommunity ? 'Community group' : 'Chat with our team'}
            </p>
          </div>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#25d366] px-7 py-3.5 text-sm font-bold text-white shadow-lg transition-transform hover:scale-[1.02]"
          >
            {isCommunity ? 'Join on WhatsApp' : 'Chat on WhatsApp'}
          </a>
        </div>
      </div>
    </section>
  )
}

/**
 * Register CTA band (PRD AF) — the conversion close at the bottom of the
 * homepage. Copy is database-backed (key: home_register_cta) with built-in
 * fallback. Free registration is the entry to everything else.
 */
export async function RegisterCtaSection() {
  const block = await getSiteContent('home_register_cta')
  const title = block?.title && block.title.trim() ? block.title : 'Start your journey on Mali Vivah'
  const body =
    block?.body && block.body.trim()
      ? block.body
      : 'Create your free profile, add your family photo and tell us who you are looking for. Upgrade to a paid package whenever you are ready to be found.'

  return (
    <section className="bg-cream">
      <div className="container-page py-16 sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            Ready when you are
          </p>
          <h2 className="mt-4 font-display text-3xl font-bold text-maroon sm:text-4xl">{title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-stone-600 sm:text-base">
            {body}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/register"
              className="inline-flex items-center justify-center rounded-full bg-maroon px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-maroon/25 hover:bg-maroon-dark"
            >
              Register free
            </a>
            <a
              href="/packages"
              className="inline-flex items-center justify-center rounded-full border border-maroon/30 bg-white px-8 py-3.5 text-sm font-bold text-maroon hover:bg-white/70"
            >
              See packages
            </a>
          </div>
          <p className="mt-4 text-xs text-stone-500">
            Free to register · Contact details stay private until both sides agree
          </p>
        </div>
      </div>
    </section>
  )
}

export type { WhatsAppConfig }
