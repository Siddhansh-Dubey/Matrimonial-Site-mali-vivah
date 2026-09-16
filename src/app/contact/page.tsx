import type { Metadata } from 'next'
import Link from 'next/link'
import { Clock, Mail, MessageCircle, PhoneCall, ShieldAlert } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Reach the Mali Vivah team — support hours, WhatsApp community and how to report a profile.',
}

const SUPPORT_PHONE = '90000 00000' // operator is welcome to replace with the real support line
const SUPPORT_EMAIL = 'hello@mali-vivah.com'

export default function ContactPage() {
  return (
    <section className="bg-cream">
      <div className="container-page py-12 sm:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            We are listening
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon sm:text-5xl">
            Contact us
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-stone-600 sm:text-base">
            Questions about a package, a profile, or help finishing registration — a person reads
            every message.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="card flex items-start gap-4 p-6 transition-shadow hover:shadow-card-float"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
              <Mail className="h-5 w-5" />
            </span>
            <span>
              <span className="font-display text-lg font-bold text-maroon">Email</span>
              <span className="mt-1 block text-sm text-stone-600">
                {SUPPORT_EMAIL} — best for payment receipts, verification and account help.
              </span>
            </span>
          </a>

          <a
            href="https://wa.me/919000000000?text=Namaskar%2C%20I%20need%20help%20with%20Mali%20Vivah"
            target="_blank"
            rel="noopener noreferrer"
            className="card flex items-start gap-4 p-6 transition-shadow hover:shadow-card-float"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span>
              <span className="font-display text-lg font-bold text-maroon">WhatsApp</span>
              <span className="mt-1 block text-sm text-stone-600">
                Chat with the support team. Faster for quick questions.
              </span>
            </span>
          </a>

          <div className="card flex items-start gap-4 p-6">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold-100 text-gold-700">
              <PhoneCall className="h-5 w-5" />
            </span>
            <span>
              <span className="font-display text-lg font-bold text-maroon">Call</span>
              <span className="mt-1 block text-sm text-stone-600">{SUPPORT_PHONE}</span>
            </span>
          </div>

          <div className="card flex items-start gap-4 p-6">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-600">
              <Clock className="h-5 w-5" />
            </span>
            <span>
              <span className="font-display text-lg font-bold text-maroon">Support hours</span>
              <span className="mt-1 block text-sm text-stone-600">
                Monday – Saturday, 10:00 – 19:00 IST. Messages left after hours are answered the
                next morning.
              </span>
            </span>
          </div>
        </div>

        <div className="mx-auto mt-10 max-w-4xl rounded-2xl border border-brand-200 bg-brand-50 px-6 py-5 text-sm text-brand-900">
          <p className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              <span className="font-bold">Report a profile:</span> please use the{' '}
              <span className="font-semibold">Report</span> button on the profile itself — it
              attaches the exact member record for our review team. For anything urgent, email us
              with <span className="font-semibold">[URGENT]</span> in the subject.
            </span>
          </p>
        </div>

        <p className="mx-auto mt-8 max-w-4xl text-center text-sm text-stone-600">
          Facing payment trouble? Go to{' '}
          <Link href="/packages" className="font-semibold text-maroon underline underline-offset-2">
            Packages
          </Link>{' '}
          — a completed payment activates automatically within a minute. If it didn&apos;t, email
          the payment receipt and we will sort it out the same day.
        </p>
      </div>
    </section>
  )
}
