import { Crown, Gift, RotateCcw, Sparkles } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { resetPlatinumCampaign, togglePlatinumCampaign } from '@/app/admin/actions'
import { ConfirmButton } from '@/components/admin/confirm-button'
import { PLATINUM_DEMO_24H_SLUG } from '@/lib/profile/subscription'
import type { PlatinumLaunchCampaign, PlatinumLaunchClaim } from '@/lib/supabase/database.types'

export const metadata = { title: 'Admin · Launch Offer' }
export const dynamic = 'force-dynamic'

/**
 * Platinum Launch Offer — campaign statistics + promotional grants.
 *
 * The claimed-slot counter is the platinum_launch_claims ledger (counted
 * here through the service-role client) — never a count of users/profiles,
 * so pre-existing development accounts cannot consume launch slots.
 * Members cannot read campaign state (RLS + no grants); this page and the
 * member-facing RPCs are the only surfaces.
 */

type ClaimWithMember = PlatinumLaunchClaim & {
  member: { full_name: string | null; email: string | null } | null
}

function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'Asia/Kolkata',
  })
}

export default async function AdminLaunchOfferPage() {
  const { admin } = await requireAdminPage()
  const nowIso = new Date().toISOString()

  const [campaignRes, first100Res, demoRes, liveRes] = await Promise.all([
    admin
      .from('platinum_launch_campaigns')
      .select('*')
      .eq('campaign_key', 'FIRST_100_PLATINUM')
      .maybeSingle(),
    admin
      .from('platinum_launch_claims')
      .select('*, member:profiles(full_name, email)')
      .eq('grant_type', 'first_100')
      .order('slot_number', { ascending: true })
      .limit(200),
    admin
      .from('platinum_launch_claims')
      .select('*, member:profiles(full_name, email)')
      .eq('grant_type', 'demo_24h')
      .order('granted_at', { ascending: false })
      .limit(200),
    admin
      .from('platinum_launch_claims')
      .select('id', { count: 'exact', head: true })
      .eq('grant_type', 'first_100'),
  ])

  const campaign = (campaignRes.data as PlatinumLaunchCampaign | null) ?? null
  const first100 = (first100Res.data ?? []) as unknown as ClaimWithMember[]
  const demos = (demoRes.data ?? []) as unknown as ClaimWithMember[]
  const claimed = liveRes.count ?? first100.length
  const totalSlots = campaign?.total_slots ?? 100
  const remaining = Math.max(totalSlots - claimed, 0)

  // Live promotional memberships right now (first-100 or demo).
  const liveFirst100 = first100.filter((c) => c.expiry_at > nowIso).length
  const liveDemos = demos.filter((c) => c.expiry_at > nowIso).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Platinum Launch Offer</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-500">
          Temporary launch promotion — <span className="font-semibold">not a paid package</span>.
          The first {totalSlots} members who complete the required profile details receive a free
          30-day Platinum membership; once those slots are claimed, every member who completes
          their profile receives one free 24-hour Platinum demo. Grants are ordinary subscriptions
          with <span className="font-semibold">no payment record</span> — Razorpay revenue is
          never affected. Paid Smart / Premium / VIP pricing and behaviour are unchanged.
        </p>
      </div>

      {!campaign ? (
        <p className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">
          Campaign row missing — apply migration 20260920190000_platinum_launch_offer.sql.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs text-stone-500">First-100 slots claimed</p>
              <p className="mt-1 font-display text-2xl font-bold text-stone-900">
                {claimed} <span className="text-base font-semibold text-stone-400">/ {totalSlots}</span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-gold-400 to-maroon"
                  style={{ width: `${Math.min((claimed / totalSlots) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs text-stone-500">Slots remaining</p>
              <p className="mt-1 font-display text-2xl font-bold text-stone-900">{remaining}</p>
              <p className="mt-2 text-xs text-stone-400">
                {remaining === 0 ? '24-hour demos are being granted now.' : 'First-100 grants active.'}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs text-stone-500">24-hour demos granted</p>
              <p className="mt-1 font-display text-2xl font-bold text-stone-900">{demos.length}</p>
              <p className="mt-2 text-xs text-stone-400">{liveDemos} live right now</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs text-stone-500">Campaign state</p>
              <p className="mt-1 font-display text-2xl font-bold text-stone-900">
                {campaign.enabled ? 'Enabled' : 'Disabled'}
              </p>
              <p className="mt-2 text-xs text-stone-400">
                {liveFirst100} first-100 grants live · key {campaign.campaign_key}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Enable / disable */}
            <form
              action={togglePlatinumCampaign}
              className="rounded-2xl border border-stone-200 bg-white p-6"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-gold-600" />
                <h2 className="font-display text-lg font-bold text-stone-900">Campaign switch</h2>
              </div>
              <p className="mt-2 text-sm text-stone-500">
                Disabling stops ALL new promotional grants (first-100 and demos) server-side.
                Entitlements already granted keep running until their normal expiry; the claim
                ledger and slot counter are untouched.
              </p>
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <input type="hidden" name="enabled" value={campaign.enabled ? 'false' : 'true'} />
              <ConfirmButton
                message={
                  campaign.enabled
                    ? 'Disable the Platinum Launch Offer? No new grants will be issued until it is re-enabled.'
                    : 'Enable the Platinum Launch Offer? Eligible members will start receiving grants again.'
                }
                className="mt-4 rounded-full bg-maroon px-5 py-2 text-xs font-bold text-white hover:bg-maroon-dark"
              >
                {campaign.enabled ? 'Disable campaign' : 'Enable campaign'}
              </ConfirmButton>
            </form>

            {/* DEVELOPMENT reset */}
            <form
              action={resetPlatinumCampaign}
              className="rounded-2xl border border-red-200 bg-red-50/60 p-6"
            >
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-red-600" />
                <h2 className="font-display text-lg font-bold text-red-900">
                  Reset to 0 / {totalSlots} — development only
                </h2>
              </div>
              <p className="mt-2 text-sm text-red-800/80">
                <span className="font-bold">DEVELOPMENT / PRE-PRODUCTION ONLY.</span> Removes this
                campaign&apos;s claims and exactly the promotional Platinum subscriptions they
                created (payment-less rows only). Users, profiles, paid subscriptions, Razorpay
                payments and activity history are preserved. The database RPC is service-role only
                — members can never call it.
              </p>
              <input type="hidden" name="campaign_key" value={campaign.campaign_key} />
              <label className="mt-4 block text-xs font-bold text-red-900">
                Type <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono">{campaign.campaign_key}</span> to
                confirm
                <input
                  name="confirm_phrase"
                  autoComplete="off"
                  className="mt-1.5 w-full rounded-xl border border-red-200 bg-white px-3 py-2 font-mono text-sm"
                  placeholder={campaign.campaign_key}
                />
              </label>
              <ConfirmButton
                message="Reset the Platinum Launch Offer to 0/100? All promotional claims and grants of this campaign will be removed. This is meant for development/testing before production."
                className="mt-4 rounded-full bg-red-600 px-5 py-2 text-xs font-bold text-white hover:bg-red-700"
              >
                Reset launch promotion
              </ConfirmButton>
            </form>
          </div>
        </>
      )}

      {/* First-100 grants */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-gold-600" />
          <h2 className="font-display text-lg font-bold text-stone-900">
            First-100 grants ({first100.length} shown)
          </h2>
        </div>
        <ClaimTable rows={first100} showSlot />
      </section>

      {/* Demo grants */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-gold-600" />
          <h2 className="font-display text-lg font-bold text-stone-900">
            24-hour demo grants ({demos.length} shown, newest first)
          </h2>
        </div>
        <ClaimTable rows={demos} showSlot={false} />
      </section>
    </div>
  )
}

function ClaimTable({ rows, showSlot }: { rows: ClaimWithMember[]; showSlot: boolean }) {
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-stone-500">No grants yet.</p>
  }
  const now = new Date().toISOString()
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-400">
            {showSlot && <th className="py-2 pr-3">Slot</th>}
            <th className="py-2 pr-3">Member</th>
            <th className="py-2 pr-3">Granted</th>
            <th className="py-2 pr-3">Start</th>
            <th className="py-2 pr-3">Expiry</th>
            <th className="py-2 pr-3">Source</th>
            <th className="py-2">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const live = c.expiry_at > now
            return (
              <tr key={c.id} className="border-b border-stone-100 align-top">
                {showSlot && (
                  <td className="py-2 pr-3 font-mono text-xs font-bold text-maroon">
                    #{c.slot_number ?? '—'}
                  </td>
                )}
                <td className="py-2 pr-3">
                  <p className="font-semibold text-stone-800">{c.member?.full_name ?? '(deleted account)'}</p>
                  <p className="text-xs text-stone-400">{c.member?.email ?? c.user_id}</p>
                  <a
                    href={`/admin/members/${c.user_id}`}
                    className="text-xs font-semibold text-maroon underline underline-offset-2"
                  >
                    member page
                  </a>
                </td>
                <td className="py-2 pr-3 text-xs text-stone-600">{fmtDate(c.granted_at, true)}</td>
                <td className="py-2 pr-3 text-xs text-stone-600">{fmtDate(c.start_at, true)}</td>
                <td className="py-2 pr-3 text-xs text-stone-600">{fmtDate(c.expiry_at, true)}</td>
                <td className="py-2 pr-3 text-xs">
                  <span className="rounded-full bg-gold-100 px-2 py-0.5 font-bold text-gold-800">
                    {c.source} · {c.promotion}
                  </span>
                  <p className="mt-1 font-mono text-[10px] text-stone-400">{c.package_slug}</p>
                </td>
                <td className="py-2 text-xs">
                  {live ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                      live
                    </span>
                  ) : (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 font-bold text-stone-500">
                      ended
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-stone-400">
        {showSlot
          ? 'Slot numbers are server-allocated under the campaign row lock. A promotional grant never creates a payment — nothing here is Razorpay revenue.'
          : `Demos do not consume first-100 slots. Package slug ${PLATINUM_DEMO_24H_SLUG} marks every demo subscription.`}
      </p>
    </div>
  )
}
