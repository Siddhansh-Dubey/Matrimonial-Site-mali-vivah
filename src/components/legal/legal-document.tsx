/**
 * Shared chrome for Mali Vivah legal documents (Privacy Policy, Terms &
 * Conditions). Server component — pure layout + typography, no state.
 *
 * Visual language deliberately mirrors the existing legal/policy pages
 * (stone card on stone-50, Playfair display headings in maroon, gold section
 * icons) so the documents look native to the site without duplicating the
 * markup across every legal route.
 */
import type { ReactNode } from 'react'
import Link from 'next/link'

export type LegalSection = {
  /** Anchor id used by the table of contents. */
  id: string
  /** Full heading including its number, e.g. "3. How We Use Information". */
  title: string
  content: ReactNode
}

export type LegalDocumentProps = {
  eyebrow: string
  title: string
  lastUpdated: string
  /** Short lead paragraph shown under the title. */
  intro: ReactNode
  sections: LegalSection[]
  /** Optional closing note (e.g. review banner). */
  closingNote?: ReactNode
}

export function LegalDocument({
  eyebrow,
  title,
  lastUpdated,
  intro,
  sections,
  closingNote,
}: LegalDocumentProps) {
  return (
    <div className="bg-stone-50 py-12 px-4 sm:px-6 lg:px-8">
      <article className="mx-auto max-w-4xl rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200/70 sm:p-10 lg:p-12">
        <header className="border-b border-stone-200 pb-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold-400/40 bg-gold-400/15 px-3.5 py-1 text-xs font-semibold text-maroon">
            {eyebrow}
          </span>
          <h1 className="mt-4 font-display text-3xl font-bold text-maroon sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">{intro}</p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-stone-500">
            Last updated: <span className="normal-case tracking-normal">{lastUpdated}</span>
          </p>
        </header>

        <nav aria-label="Table of contents" className="mt-8 rounded-2xl bg-stone-100/80 p-5 sm:p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-stone-500">Contents</h2>
          <ol className="mt-3 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-maroon underline-offset-4 transition-colors hover:text-maroon-dark hover:underline"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-12">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="font-display text-xl font-bold leading-snug text-maroon sm:text-2xl">
                {section.title}
              </h2>
              <div className="mt-4 space-y-4 text-sm leading-relaxed text-stone-700 sm:text-base">
                {section.content}
              </div>
            </section>
          ))}
        </div>

        {closingNote ? <div className="mt-12">{closingNote}</div> : null}
      </article>
    </div>
  )
}

/**
 * Clearly-marked business/legal placeholder. Rendered in the published page
 * so the items a reviewer must confirm before launch are impossible to miss.
 */
export function LegalPlaceholder({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-md border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-[0.92em] font-semibold text-amber-900">
      {children}
    </span>
  )
}

/** Standard in-document link to another legal page (renders as a normal link). */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-maroon underline underline-offset-2 hover:text-maroon-dark">
      {children}
    </Link>
  )
}
