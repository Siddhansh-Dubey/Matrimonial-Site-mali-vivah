import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BadgeCheck,
  Clock,
  Eye,
  HeartHandshake,
  Lock,
  Mail,
  MessageCircle,
  PhoneCall,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY } from '@/lib/contact'
import { getSiteContent, getWhatsAppConfig, supportWhatsappLink } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'About Us',
  description:
    'Mali Vivah is a matrimonial platform built for the Mali Samaj — privacy-first, paid-member-visible, and honest in everything it shows you. Reach the team by email, WhatsApp or phone below.',
}

export const dynamic = 'force-dynamic'

const PRINCIPLES = [
  {
    icon: Lock,
    title: 'Privacy you can verify',
    body: 'Your phone number is never printed on a profile. It is revealed only when both sides accept interest in each other — not before, and never because someone simply paid.',
  },
  {
    icon: BadgeCheck,
    title: 'Paid members are visible, free members are not',
    body: 'On Mali Vivah, the profiles you browse belong to paying members who activated their profile. Free accounts can build a profile privately and upgrade when they are ready to connect.',
  },
  {
    icon: ShieldCheck,
    title: 'Real review, not rubber stamps',
    body: 'Profile photos, family photos and verification selfies are reviewed by a person. We suspend matches that break our community rules and act on every report.',
  },
  {
    icon: Sparkles,
    title: 'Compatibility over volume',
    body: 'The Daily 5 picks at most five candidates who genuinely clear our compatibility bar. If we have nothing strong for you today, we will tell you rather than fill the page.',
  },
  {
    icon: Eye,
    title: 'Honest by design',
    body: 'No fake profiles, no inflated member counts, no countdown gimmicks. What you see is configured from our database — prices included — and admin actions leave an audit trail.',
  },
  {
    icon: HeartHandshake,
    title: 'Family first',
    body: 'The family photo is part of every published profile, because marriages in our community join families, not just two people. Parents and siblings can register and manage profiles too.',
  },
]

export default async function AboutPage() {
  // Admin-managed copy (PRD M) + WhatsApp configuration (PRD N). Every value
  // below has a built-in fallback, so the page is identical when the tables
  // are empty.
  const [wa, aboutIntro, aboutCta, contactIntro] = await Promise.all([
    getWhatsAppConfig(),
    getSiteContent('about_intro'),
    getSiteContent('about_cta'),
    getSiteContent('contact_intro'),
  ])

  return (
    <>
      {/* 1 · About us */}
      <section className="bg-cream">
        <div className="container-page py-12 sm:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
              About Mali Vivah
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold text-maroon sm:text-5xl">
              A care-full corner of the internet for the Mali Samaj
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-stone-600 sm:text-base">
              {aboutIntro?.body ??
                'Mali Vivah began with a simple observation: families in the Mali community deserve a matrimonial space that behaves like our own community does — private by default, respectful of boundaries, and honest about what it can and cannot do.'}
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="card p-6">
                <p.icon className="h-6 w-6 text-gold-600" aria-hidden />
                <h2 className="mt-3 font-display text-lg font-bold text-maroon">{p.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{p.body}</p>
              </div>
            ))}
          </div>

          <div className="mx-auto mt-12 max-w-3xl rounded-[26px] bg-maroon-deep px-8 py-10 text-center text-white">
            <h2 className="font-display text-2xl font-bold sm:text-3xl">
              {aboutCta?.title ?? 'Same community. Brighter tomorrows.'}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-white/75">
              {aboutCta?.body ??
                'Registration is free. Build your profile, add your family photo, and upgrade when you are ready to be found.'}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-full bg-gold-400 px-6 py-2.5 text-sm font-bold text-maroon-deep hover:bg-gold-300"
              >
                Register free
              </Link>
              <a
                href="#contact"
                className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-2.5 text-sm font-bold text-white hover:bg-white/10"
              >
                Talk to us
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 2 · Contact us */}
      <section id="contact" className="scroll-mt-24 border-t border-stone-200/70 bg-cream">
        <div className="container-page py-12 sm:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
              We are listening
            </p>
            <h2 className="mt-3 font-display text-4xl font-bold text-maroon sm:text-5xl">
              Contact us
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-stone-600 sm:text-base">
              {contactIntro?.body ??
                'Questions about a package, a profile, or help finishing registration — a person reads every message.'}
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2">
            <a
              href={`mailto:${config.supportEmail}`}
              className="card flex items-start gap-4 p-6 transition-shadow hover:shadow-card-float"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
                <Mail className="h-5 w-5" />
              </span>
              <span>
                <span className="font-display text-lg font-bold text-maroon">Email</span>
                <span className="mt-1 block text-sm text-stone-600">
                  {config.supportEmail} — best for payment receipts, verification and account help.
                </span>
              </span>
            </a>

            <a
              href={supportWhatsappLink(wa, 'Namaskar, I need help with Mali Vivah')}
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

            {wa.communityLink && (
              <a
                href={wa.communityLink}
                target="_blank"
                rel="noopener noreferrer"
                className="card flex items-start gap-4 p-6 transition-shadow hover:shadow-card-float"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700">
                  <HeartHandshake className="h-5 w-5" />
                </span>
                <span>
                  <span className="font-display text-lg font-bold text-maroon">
                    WhatsApp community
                  </span>
                  <span className="mt-1 block text-sm text-stone-600">
                    Join the Mali Vivah community group for announcements and guidance.
                  </span>
                </span>
              </a>
            )}

            <div className="card flex items-start gap-4 p-6">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold-100 text-gold-700">
                <PhoneCall className="h-5 w-5" />
              </span>
              <span>
                <span className="font-display text-lg font-bold text-maroon">Call</span>
                <span className="mt-1 block text-sm text-stone-600">{config.supportPhoneDisplay}</span>
              </span>
            </div>

            <div className="card flex items-start gap-4 p-6">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-600">
                <Clock className="h-5 w-5" />
              </span>
              <span>
                <span className="font-display text-lg font-bold text-maroon">Support hours</span>
                <span className="mt-1 block text-sm text-stone-600">
                  {config.supportHours}. Messages left after hours are answered the
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
    </>
  )
}
