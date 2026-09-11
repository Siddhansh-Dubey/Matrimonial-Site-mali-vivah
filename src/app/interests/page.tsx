import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Inbox, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { maskName } from '@/lib/profile/mask'
import { photoUrl } from '@/lib/profile/photos'
import { InterestActions } from '@/components/profile/interest-actions'
import type { Interest } from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'Interests' }
export const dynamic = 'force-dynamic'

export default async function InterestsPage() {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [receivedRes, sentRes] = await Promise.all([
    supabase
      .from('interests')
      .select('*')
      .eq('receiver_id', user.id)
      .order('created_at', { ascending: false }),
    supabase.from('interests').select('*').eq('sender_id', user.id).order('created_at', { ascending: false }),
  ])

  const received = receivedRes.data ?? []
  const sent = sentRes.data ?? []

  // Collect counterparty ids to look up their (masked) names + photos.
  const admin = createAdminClient()
  const ids = [
    ...new Set([...received.map((r) => r.sender_id), ...sent.map((s) => s.receiver_id)]),
  ]
  const counterparties = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const counterPhoto = await admin
    .from('profile_photos')
    .select('profile_id, storage_path')
    .in('profile_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    .eq('is_primary', true)

  const nameById = new Map((counterparties.data ?? []).map((p) => [p.id, p.full_name]))
  const photoById = new Map((counterPhoto.data ?? []).map((p) => [p.profile_id, p.storage_path]))

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">Express Interest</p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon">Interests</h1>
          <p className="mt-3 text-sm text-stone-600">
            Families who expressed interest in your profile, and interests you have sent.
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
                {received.map((i) => (
                  <li key={i.id} className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                    <Avatar name={nameById.get(i.sender_id)} photo={photoById.get(i.sender_id)} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-stone-800">
                        {maskName(nameById.get(i.sender_id))}
                        <span className="ml-2 text-xs font-normal text-stone-500">{formatDate(i.created_at)}</span>
                      </p>
                      {i.message ? (
                        <p className="mt-1 text-sm text-stone-600">“{i.message}”</p>
                      ) : (
                        <p className="mt-1 text-sm text-stone-500">expressed interest in your profile.</p>
                      )}
                    </div>
                    <InterestActions interestId={i.id} current={i.status} />
                  </li>
                ))}
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
                {sent.map((i) => (
                  <li key={i.id} className="card flex items-center gap-4 p-5">
                    <Avatar name={nameById.get(i.receiver_id)} photo={photoById.get(i.receiver_id)} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-stone-800">{maskName(nameById.get(i.receiver_id))}</p>
                      <p className="mt-0.5 text-xs text-stone-500">{formatDate(i.created_at)}</p>
                    </div>
                    <Link
                      href={`/profile/${i.receiver_id}`}
                      className="rounded-full border-[1.5px] border-brand-300/80 bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-800 hover:border-brand-600 hover:bg-brand-600 hover:text-white"
                    >
                      View
                    </Link>
                    <StatusPill status={i.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
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
  const initial = maskName(name).charAt(0)
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-brand-50 ring-1 ring-stone-200">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-display text-lg font-bold text-brand-300">{initial}</div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: Interest['status'] }) {
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
