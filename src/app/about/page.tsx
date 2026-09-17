import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, Eye, HeartHandshake, Lock, ShieldCheck, Sparkles } from 'lucide-react'

export const metadata: Metadata = {
  title: 'About Us',
  description:
    'Mali Vivah is a matrimonial platform built for the Mali Samaj — privacy-first, paid-member-visible, and honest in everything it shows you.',
}

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

export default function AboutPage() {
  return (
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
            Mali Vivah began with a simple observation: families in the Mali community deserve a
            matrimonial space that behaves like our own community does — private by default,
            respectful of boundaries, and honest about what it can and cannot do.
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
            Same community. Brighter tomorrows.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/75">
            Registration is free. Build your profile, add your family photo, and upgrade when you
            are ready to be found.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-full bg-gold-400 px-6 py-2.5 text-sm font-bold text-maroon-deep hover:bg-gold-300"
            >
              Register free
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-2.5 text-sm font-bold text-white hover:bg-white/10"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
