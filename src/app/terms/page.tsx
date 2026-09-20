import type { Metadata } from 'next'
import Link from 'next/link'
import { Shield, FileText, CheckCircle2, AlertCircle } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Terms of Service | Mali Vivah',
  description:
    'Terms of service, community guidelines, membership rules, and acceptable use policies for Mali Vivah matrimonial platform.',
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-stone-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 sm:p-12 shadow-sm ring-1 ring-stone-200/70">
        <div className="border-b border-stone-200 pb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-maroon/10 px-3.5 py-1 text-xs font-semibold text-maroon">
            <FileText className="h-4 w-4" />
            <span>Community Agreement</span>
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold text-maroon sm:text-4xl">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Last updated: September 20, 2026 • Effective immediately
          </p>
        </div>

        <div className="mt-8 space-y-8 text-stone-700 leading-relaxed text-sm sm:text-base">
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-gold-500" />
              1. Community Eligibility &amp; Platform Purpose
            </h2>
            <p>
              Mali Vivah is a dedicated matrimonial platform created exclusively for members of the
              Mali Samaj (including Phul Mali, Lal Mali, Haldi Mali, Sagar Mali, Jire Mali, and other
              recognized sub-communities).
            </p>
            <p>
              By registering on or using Mali Vivah, you represent and warrant that:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>You or the person on whose behalf you are registering belong to the Mali Samaj.</li>
              <li>You are seeking a lawful matrimonial alliance in good faith. Mali Vivah is strictly not a dating, casual relationship, or commercial advertising service.</li>
              <li>You have the legal capacity and authority to enter into a valid marriage according to the applicable laws of India or your country of residence.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <Shield className="h-5 w-5 text-gold-500" />
              2. Minimum Adult Age Requirement
            </h2>
            <p>
              In strict accordance with Indian legal requirements and our trust &amp; safety policies,
              all users must be of lawful marriageable adult age at the time of registration.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Every registered member must be at least <strong>18 years of age</strong>.</li>
              <li>Underage registrations are prohibited. Any profile found to be created for an individual below 18 years will be immediately terminated and removed.</li>
              <li>Date of birth provided during onboarding is verified against official government ID documents during profile verification.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-gold-500" />
              3. Membership Plans &amp; Payment Mechanics
            </h2>
            <p>
              Mali Vivah provides free registration alongside optional paid membership packages (Smart, Premium, VIP):
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Fixed Duration:</strong> Paid packages are provided for fixed durations (e.g., 90, 180, or 365 days) as specified at the time of checkout.</li>
              <li><strong>No Automatic Recurring Billing:</strong> All payments are processed on a one-time basis via Razorpay. We do not store credit/debit card credentials and do not initiate automatic renewals or recurring auto-debits.</li>
              <li><strong>Non-Transferable:</strong> Membership packages are strictly tied to the individual member account and cannot be transferred, assigned, or shared with another individual.</li>
              <li><strong>Expiry:</strong> Upon package expiry, public profile listing and paid benefits (such as viewing family details, contact reveal requests, and daily matches) lapse until a renewal package is purchased.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <Shield className="h-5 w-5 text-gold-500" />
              4. Mutual Consent &amp; Contact Reveal Model
            </h2>
            <p>
              We prioritize member privacy and personal safety above all else. Contact numbers and sensitive communications are protected by a server-enforced mutual consent protocol:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Mobile numbers and personal contact channels are never exposed publicly or in search results.</li>
              <li>A member must express Interest. The receiving member has full autonomy to Accept or Decline the request.</li>
              <li>Contact details are revealed <strong>only</strong> after mutual acceptance has taken place.</li>
              <li>Members retain the right to block or unmatch any connection at any time, immediately revoking communication privileges.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-gold-500" />
              5. Profile Authenticity, Verification &amp; Moderation
            </h2>
            <p>
              You agree to provide true, accurate, and current information regarding identity, education, occupation, family background, and marital status.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Mali Vivah reserves the right to review, reject, or place an administrative hold on any profile that contains misleading, defamatory, offensive, or fraudulent information.</li>
              <li>Verification badges are awarded upon review of submitted government identification documents. Verification documents are strictly confidential and never displayed to other users.</li>
              <li>Mali Moments (24-hour photo shares) must comply with decency guidelines and expire automatically after 24 hours.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-gold-500" />
              6. Account Termination &amp; Deletion
            </h2>
            <p>
              You may terminate your account at any time through the{' '}
              <Link href="/profile/settings" className="font-semibold text-maroon underline">
                Settings &amp; Privacy
              </Link>{' '}
              page. Upon requesting account deletion, your profile will be unlisted immediately, login access will be permanently revoked, and personal photos and preferences purged in accordance with our{' '}
              <Link href="/privacy" className="font-semibold text-maroon underline">
                Privacy Policy
              </Link>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-gold-500" />
              7. Applicable Law &amp; Jurisdiction
            </h2>
            <p>
              These Terms of Service are governed by and construed in accordance with the laws of the Republic of India. Any disputes arising out of or in connection with the use of this service shall be subject to the exclusive jurisdiction of the competent courts in Maharashtra, India.
            </p>
          </section>

          <section className="mt-8 rounded-2xl bg-amber-50/70 p-6 border border-amber-200/70">
            <h3 className="font-bold text-maroon text-base">Questions or Support?</h3>
            <p className="mt-1 text-sm text-stone-700">
              For legal inquiries, dispute reports, or support regarding our terms, contact us at{' '}
              <a href="mailto:support@malivivah.com" className="font-semibold text-maroon underline">
                support@malivivah.com
              </a>{' '}
              or reach our helpline at +91 98220 00000.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
