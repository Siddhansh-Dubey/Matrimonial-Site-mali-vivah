import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Heart, Inbox, Lock, Phone, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { maskName, maskPhone, MASK_BLUR_CLASS } from '@/lib/profile/mask'
import { photoUrl } from '@/lib/profile/photos'
import { hasActiveSubscription } from '@/lib/profile/subscription'
import { mutualFromStatuses } from '@/lib/profile/visibility'
import { InterestActions } from '@/components/profile/interest-actions'
import { MessageButton, type MessageButtonState } from '@/components/chat/message-button'
import type { Interest, InterestStatus } from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'Interests' }
export const dynamic = 'force-dynamic'

export default async function InterestsPage() {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [receivedRes, sentRes, isPaid] = await Promise.all([
    supabase
      .from('interests')
      .select('*')
      .eq('receiver_id', user.id)
      .order('created_at', { ascending: false }),
    supabase.from('interests').select('*').eq('sender_id', user.id).order('created_at', { ascending: false }),
    hasActiveSubscription(supabase, user.id),
  ])

  const received = (receivedRes.data ?? []) as Interest[]
  const sent = (sentRes.data ?? []) as Interest[]

  // Counterparty lookup (names + photos + mobiles for mutual reveals).
  const admin = createAdminClient()
  const ids = [
    ...new Set([...received.map((r) => r.sender_id), ...sent.map((s) => s.receiver_id)]),
  ]
  const emptyId = '00000000-0000-0000-0000-000000000000'
  const counterparties = await admin
    .from('profiles')
    .select('id, full_name, mobile')
    .in('id', ids.length ? ids : [emptyId])
  const counterPhoto = await admin
    .from('profile_photos')
    .select('profile_id, storage_path')
    .in('profile_id', ids.length ? ids : [emptyId])
    .eq('is_primary', true)
  // Who still holds a live plan right now — messaging needs BOTH sides paid.
  const { data: activeMembers } = await admin
    .from('subscriptions')
    .select('user_id')
    .in('user_id', ids.length ? ids : [emptyId])
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  const nameById = new Map((counterparties.data ?? []).map((p) => [p.id, p.full_name]))
  const mobileById = new Map(
    (counterparties.data ?? []).map((p) => [p.id, (p as { mobile?: string | null }).mobile ?? null])
  )
  const photoById = new Map((counterPhoto.data ?? []).map((p) => [p.profile_id, p.storage_path]))
  const memberIds = new Set((activeMembers ?? []).map((row) => row.user_id))

  // Mutual map: for each counterparty, is interest mutual?
  const sentByReceiver = new Map(sent.map((s) => [s.receiver_id, s.status as InterestStatus]))
  const receivedBySender = new Map(received.map((r) => [r.sender_id, r.status as InterestStatus]))
  const mutualById = new Map<string, boolean>()
  for (const id of ids) {
    mutualById.set(
      id,
      mutualFromStatuses(sentByReceiver.get(id) ?? null, receivedBySender.get(id) ?? null)
    )
  }

  const displayName = (id: string) => {
    const full = nameById.get(id)
    return isPaid && full ? full : maskName(full)
  }
  // Phone visible iff paid AND mutual.
  const displayPhone = (id: string): string | null =>
    isPaid && mutualById.get(id) ? (mobileById.get(id) ?? null) : null

  // Chat uses the SAME mutual-interest gate as the phone reveal, plus a live
  // plan on both sides. A counterparty whose plan lapsed simply reads as "not
  // mutual yet" — the message never reveals another member's billing state.
  const messageStateFor = (id: string): MessageButtonState =>
    !isPaid ? 'needs_package' : mutualById.get(id) && memberIds.has(id) ? 'ready' : 'needs_mutual'

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            Express Interest
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon">Interests</h1>
          <p className="mt-3 text-sm text-stone-600">
            Families who expressed interest in your profile, and interests you have sent.
            {!isPaid && (
              <>
                {' '}
                <Link href="/packages" className="font-semibold text-maroon underline underline-offset-2">
                  Purchase a package
                </Link>{' '}
                to see full names and reveal phone numbers on mutual matches.
              </>
            )}
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-3xl space-y-10">
          {/* received */}
          <section>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold text-maroon">
              <Inbox className="h-5 w-5 text-gold-600" /> Received ({received.length})
            </h2>
            {received.length === 0 ? (
              <Empty text="No interests received yet. Once you publish your profile, interested families will appear here." />
            ) : (
              <ul className="mt-4 space-y-3">
                {received.map((i) => {
                  const mutual = mutualById.get(i.sender_id) ?? false
                  const phone = displayPhone(i.sender_id)
                  return (
                    <li key={i.id} className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                      <Avatar name={displayName(i.sender_id)} photo={photoById.get(i.sender_id)} />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-stone-800">
                          {displayName(i.sender_id)}
                          {mutual && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                              <Heart className="h-3 w-3 fill-current" /> Mutual
                            </span>
                          )}
                          <span className="text-xs font-normal text-stone-500">
                            {formatDate(i.created_at)}
                          </span>
                        </p>
                        {i.message ? (
                          <p className="mt-1 text-sm text-stone-600">“{i.message}”</p>
                        ) : (
                          <p className="mt-1 text-sm text-stone-500">
                            expressed interest in your profile.
                          </p>
                        )}
                        <PhoneLine phone={phone} mutual={mutual} isPaid={isPaid} />
                        <Link
                          href={`/profile/${i.sender_id}`}
                          className="mt-1.5 inline-block text-xs font-bold text-maroon underline underline-offset-2"
                        >
                          View profile
                        </Link>
                      </div>
                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                        <InterestActions interestId={i.id} current={i.status} isMutual={mutual} />
                        <MessageButton
                          otherUserId={i.sender_id}
                          state={messageStateFor(i.sender_id)}
                          variant="inline"
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* sent */}
          <section>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold text-maroon">
              <Send className="h-5 w-5 text-gold-600" /> Sent ({sent.length})
            </h2>
            {sent.length === 0 ? (
              <Empty text="You haven't sent any interests yet. Browse profiles and take the first step." />
            ) : (
              <ul className="mt-4 space-y-3">
                {sent.map((i) => {
                  const mutual = mutualById.get(i.receiver_id) ?? false
                  const phone = displayPhone(i.receiver_id)
                  return (
                    <li key={i.id} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                      <Avatar
                        name={displayName(i.receiver_id)}
                        photo={photoById.get(i.receiver_id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-stone-800">
                          {displayName(i.receiver_id)}
                          {mutual && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                              <Heart className="h-3 w-3 fill-current" /> Mutual
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-stone-500">{formatDate(i.created_at)}</p>
                        <PhoneLine phone={phone} mutual={mutual} isPaid={isPaid} />
                      </div>
                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/profile/${i.receiver_id}`}
                            className="rounded-full border-[1.5px] border-brand-300/80 bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-800 hover:border-brand-600 hover:bg-brand-600 hover:text-white"
                          >
                            View
                          </Link>
                          <StatusPill status={i.status} mutual={mutual} />
                        </div>
                        <MessageButton
                          otherUserId={i.receiver_id}
                          state={messageStateFor(i.receiver_id)}
                          variant="inline"
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}

function PhoneLine({ phone, mutual, isPaid }: { phone: string | null; mutual: boolean; isPaid: boolean }) {
  if (phone) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
        <Phone className="h-3.5 w-3.5" />
        <a href={`tel:${phone.replace(/\D/g, '')}`}>{phone}</a>
      </p>
    )
  }
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-stone-500">
      <Lock className="h-3 w-3" />
      <span className={MASK_BLUR_CLASS} aria-hidden>
        {maskPhone('9876543210')}
      </span>
      <span>
        {!isPaid
          ? '· needs a package'
          : !mutual
            ? '· revealed on mutual interest'
            : '· not shared yet'}
      </span>
    </p>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-8 text-center text-sm text-stone-500">
      {text}
    </div>
  )
}

function Avatar({ name, photo }: { name?: string; photo?: string }) {
  const url = photoUrl(photo)
  const initial = (name ?? 'M').charAt(0)
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-brand-50 ring-1 ring-stone-200">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-display text-lg font-bold text-brand-300">
          {initial}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status, mutual }: { status: Interest['status']; mutual?: boolean }) {
  if (mutual && status !== 'declined' && status !== 'withdrawn') {
    return (
      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
        mutual
      </span>
    )
  }
  const map: Record<Interest['status'], string> = {
    pending: 'bg-amber-100 text-amber-800',
    accepted: 'bg-emerald-100 text-emerald-800',
    declined: 'bg-stone-100 text-stone-600',
    withdrawn: 'bg-stone-100 text-stone-600',
  }
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${map[status]}`}>{status}</span>
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
