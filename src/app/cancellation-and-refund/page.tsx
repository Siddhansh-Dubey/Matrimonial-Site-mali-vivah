import type { Metadata } from 'next'
import Link from 'next/link'
import { RotateCcw, AlertTriangle, CheckCircle, Clock } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Cancellation and Refund Policy | Mali Vivah',
  description:
    'Cancellation and Refund Policy for Mali Vivah paid matrimonial membership plans, boost purchases, and transaction guidelines.',
}

export default function CancellationAndRefundPage() {
  return (
    <main className="min-h-screen bg-stone-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 sm:p-12 shadow-sm ring-1 ring-stone-200/70">
        <div className="border-b border-stone-200 pb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-gold-400/20 px-3.5 py-1 text-xs font-semibold text-maroon border border-gold-400/40">
            <RotateCcw className="h-4 w-4 text-maroon" />
            <span>Billing &amp; Refunds</span>
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold text-maroon sm:text-4xl">
            Cancellation &amp; Refund Policy
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Last updated: September 20, 2026 • Governing all membership packages and boost add-ons
          </p>
        </div>

        <div className="mt-8 space-y-8 text-stone-700 leading-relaxed text-sm sm:text-base">
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-gold-500" />
              1. Digital Membership Nature &amp; Activation
            </h2>
            <p>
              Mali Vivah provides digital matchmaking membership packages (Smart, Premium, VIP) and profile boost add-ons. 
              Upon successful payment authorization and capture through Razorpay, membership privileges are activated immediately on your profile.
            </p>
            <p>
              Because digital membership services grant instant access to community directories, partner preferences, and direct contact features, memberships are non-tangible irrevocable digital goods.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <Clock className="h-5 w-5 text-gold-500" />
              2. Cancellation Policy
            </h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>No Automatic Recurring Billing:</strong> All memberships on Mali Vivah are purchased as one-time fixed-duration plans. There are <strong>no recurring monthly auto-debits or renewal subscriptions</strong> to cancel.</li>
              <li><strong>Lapse on Expiry:</strong> When your chosen plan period ends, your membership naturally lapses without any recurring charge.</li>
              <li><strong>Voluntary Account Deletion:</strong> You may choose to hide or permanently delete your profile at any time. However, deleting an account prior to package expiration does not entitle the user to a pro-rata cash refund.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-gold-500" />
              3. Refund Eligibility &amp; Grounds
            </h2>
            <p>
              Refund requests are evaluated under strict administrative review by our Trust &amp; Billing team. A refund may be granted under the following circumstances:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Duplicate Charges:</strong> If your bank account or card was billed multiple times for the same membership package due to a network or payment gateway timeout.
              </li>
              <li>
                <strong>Technical Activation Failure:</strong> If payment was captured by Razorpay, but membership activation failed due to a verified platform error that could not be resolved within 48 hours of reporting.
              </li>
              <li>
                <strong>Unauthorized Transaction:</strong> If a payment was made fraudulently using your payment credentials and reported immediately with official banking/police documentation prior to profile usage.
              </li>
            </ul>
            <div className="rounded-2xl bg-amber-50 p-4 border border-amber-200/80 text-xs sm:text-sm text-stone-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Non-refundable Situations:</strong> Change of mind, finding a partner outside Mali Vivah, lack of response to interest requests from other members, or account suspension resulting from community safety guideline violations do not qualify for a refund.
                </span>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold text-maroon flex items-center gap-2">
              <Clock className="h-5 w-5 text-gold-500" />
              4. Refund Request Process &amp; Timelines
            </h2>
            <p>
              To submit a refund request:
            </p>
            <ol className="list-decimal pl-6 space-y-1.5">
              <li>Email our billing desk at <a href="mailto:billing@malivivah.com" className="font-semibold text-maroon underline">billing@malivivah.com</a> within <strong>7 calendar days</strong> of the transaction.</li>
              <li>Include your registered email address, registered mobile number, Razorpay payment ID, and order ID.</li>
              <li>Our administration will review the transaction logs against account usage within <strong>2 business days</strong>.</li>
            </ol>
            <p>
              If approved, the refund will be credited back exclusively to the <strong>original source of payment</strong> (credit card, debit card, UPI, or net banking) via Razorpay. It typically takes <strong>5 to 7 business days</strong> for the funds to reflect in your bank account depending on your issuing bank.
            </p>
          </section>

          <section className="mt-8 rounded-2xl bg-stone-100 p-6 border border-stone-200">
            <h3 className="font-bold text-maroon text-base">Billing Assistance</h3>
            <p className="mt-1 text-sm text-stone-700">
              Have questions regarding a charge on your statement? Please contact us before disputing with your bank so we can resolve it promptly:
            </p>
            <div className="mt-3 text-xs sm:text-sm text-stone-600 space-y-0.5">
              <p><strong>Email:</strong> billing@malivivah.com / support@malivivah.com</p>
              <p><strong>Phone:</strong> +91 98220 00000 (Mon–Sat, 10 AM – 6 PM IST)</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
