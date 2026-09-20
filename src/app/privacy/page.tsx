import type { Metadata } from 'next'
import Link from 'next/link'
import { Shield, Lock, Eye, Trash2, KeyRound } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Privacy Policy | Mali Vivah',
  description:
    'Privacy Policy for Mali Vivah. Learn how your matrimony profile, photos, contact details, and personal data are protected and handled.',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-stone-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 sm:p-12 shadow-sm ring-1 ring-stone-200/70">
        <div className="border-b border-stone-200 pb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3.5 py-1 text-xs font-semibold text-emerald-800 border border-emerald-200/60">
            <Lock className="h-4 w-4 text-emerald-600" />
            <span>Privacy-First Architecture</span>
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold text-maroon sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Last updated: September 20, 2026 • Compliant with Indian Information Technology &amp; Digital Personal Data Protection standards
          </p>
        </div>

        <div className="mt-8 space-y-8 text-stone-700 leading-relaxed text-sm sm:text-base">
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <Shield className="h-5 w-5 text-gold-500" />
              1. Information We Collect
            </h2>
            <p>
              Mali Vivah collects information necessary to deliver trusted matchmaking services within the Mali Samaj community:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Account Credentials:</strong> Mobile number, email address, password hash, and authenticated session tokens.</li>
              <li><strong>Matrimonial Profile Details:</strong> Full name, gender, date of birth (verifying 18+ adult age), marital status, mother tongue, gotra/sub-community, education, occupation, income band, height, city, and state.</li>
              <li><strong>Photographs:</strong> Profile photos, optional family photos, and ephemeral Mali Moments (which expire in 24 hours).</li>
              <li><strong>Verification Documents:</strong> Government photo ID submitted for verification badges (stored in private, access-restricted storage).</li>
              <li><strong>Partner Preferences:</strong> Desired age range, height, location, education, and lifestyle choices.</li>
              <li><strong>Transactional Data:</strong> Order IDs, payment transaction references, and timestamp records generated through Razorpay (we never collect or store card numbers or CVVs).</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <Eye className="h-5 w-5 text-gold-500" />
              2. Granular Privacy Controls
            </h2>
            <p>
              You maintain direct control over what other registered members can see on your profile. Through the{' '}
              <Link href="/profile/settings" className="font-semibold text-maroon underline">
                Settings &amp; Privacy
              </Link>{' '}
              dashboard, you can independently toggle:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>About Me:</strong> Toggle whether your biographical summary is visible to other members.</li>
              <li><strong>Family Details:</strong> Restrict family background notes from viewer inspection.</li>
              <li><strong>Family Photo:</strong> Control visibility of your uploaded family photo.</li>
              <li><strong>Annual Income:</strong> Choose whether to display or conceal your income bracket.</li>
            </ul>
            <p className="text-stone-600 text-xs sm:text-sm italic">
              Note: Unregistered anonymous visitors can only browse basic anonymized profiles with masked names. Unlisted, suspended, or expired profiles are automatically hidden from all public directories.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-gold-500" />
              3. Contact Privacy &amp; Mutual Consent Protection
            </h2>
            <p>
              Your personal phone number and contact details are never listed publicly or sold to third parties:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Contact details are protected by an authoritative server-side mutual consent barrier.</li>
              <li>Phone numbers are revealed only when an Interest request is explicitly sent and accepted by both parties.</li>
              <li>If you block a member, they can no longer view your profile, send interest, or access your contact information.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <Lock className="h-5 w-5 text-gold-500" />
              4. Verification Documents Security
            </h2>
            <p>
              Government ID proofs submitted for Trust &amp; Safety verification are stored in secure, private storage buckets protected by database Row-Level Security:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Verification documents are accessible exclusively to authorized verification administrators.</li>
              <li>They are never exposed to other members, search indexing, or public storage URLs.</li>
              <li>Verification status is displayed only as a verified checkmark badge without disclosing underlying documents.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-gold-500" />
              5. Data Retention &amp; Permanent Account Deletion
            </h2>
            <p>
              You have the unconditional right to delete your account and request complete erasure of your personal data:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Immediate Unlisting:</strong> Upon clicking &ldquo;Delete Account&rdquo;, your profile is immediately unlisted from search, Daily 5, featured lists, and member browsing.</li>
              <li><strong>Data Purging:</strong> All uploaded photos, moments, notifications, partner preferences, and view histories are permanently deleted.</li>
              <li><strong>Email Anonymization:</strong> Your profile email is scrubbed and replaced with an anonymous placeholder.</li>
              <li><strong>Financial Record Retention:</strong> In accordance with Indian tax laws (Income Tax Act &amp; GST regulations), financial invoice and payment records are preserved with anonymized user references for the mandatory statutory period.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <Shield className="h-5 w-5 text-gold-500" />
              6. Data Sharing &amp; Third-Party Processors
            </h2>
            <p>
              Mali Vivah does not sell, rent, or trade your personal data. We engage trusted enterprise infrastructure partners solely to deliver the service:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Supabase:</strong> Encrypted database hosting and secure authentication.</li>
              <li><strong>Razorpay:</strong> RBI-licensed payment gateway for processing membership packages.</li>
            </ul>
          </section>

          <section className="mt-8 rounded-2xl bg-stone-100 p-6">
            <h3 className="font-bold text-maroon text-base">Grievance Officer &amp; Contact</h3>
            <p className="mt-1 text-sm text-stone-700">
              In accordance with the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, you may address privacy concerns or grievances to:
            </p>
            <div className="mt-3 text-xs sm:text-sm text-stone-600 space-y-0.5">
              <p><strong>Grievance Officer:</strong> Mali Vivah Trust &amp; Safety Desk</p>
              <p><strong>Email:</strong> privacy@malivivah.com</p>
              <p><strong>Address:</strong> Mali Vivah Samaj Bhavan, Pune, Maharashtra 411002, India</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
