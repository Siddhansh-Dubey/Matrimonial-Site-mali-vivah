'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, ShieldCheck, UserX } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import { updatePrivacySettings } from '@/app/settings/actions'

export type BlockedEntry = {
  id: number
  created_at: string
}

const PRIVACY_OPTIONS = [
  {
    key: 'show_income',
    title: 'Show my annual income',
    body: 'Paid members viewing your profile can see your income band.',
  },
  {
    key: 'show_about',
    title: 'Show my “About me”',
    body: 'Paid members can read your introduction on your profile page.',
  },
  {
    key: 'show_family_details',
    title: 'Show my family details',
    body: 'Paid members can see your parents, siblings and family notes.',
  },
  {
    key: 'show_family_photo',
    title: 'Show my family photo',
    body: 'Paid members can view your family photograph.',
  },
] as const

/**
 * Settings & privacy: visibility toggles for paid viewers, the WhatsApp
 * opt-in, and the member's own block list (unblock is instant).
 */
export function PrivacyForm({
  initial,
  whatsappOptIn,
  blocked,
}: {
  initial: Record<string, boolean>
  whatsappOptIn: boolean
  blocked: BlockedEntry[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<BlockedEntry[]>(blocked)
  const [unblocking, setUnblocking] = useState<number | null>(null)

  function onSubmit(formData: FormData) {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await updatePrivacySettings(formData)
      if (res.ok) {
        setSaved(true)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  async function unblock(entry: BlockedEntry) {
    if (!isSupabaseConfigured) return
    setUnblocking(entry.id)
    try {
      const supabase = createClient()
      const { error: delError } = await supabase.from('blocks').delete().eq('id', entry.id)
      if (delError) {
        setError(delError.message)
        return
      }
      setBlocks((prev) => prev.filter((b) => b.id !== entry.id))
      router.refresh()
    } finally {
      setUnblocking(null)
    }
  }

  return (
    <div className="space-y-6">
      <form action={onSubmit} className="card p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />
          <h2 className="font-display text-lg font-bold text-maroon">What paid members can see</h2>
        </div>
        <p className="mt-1 text-sm text-stone-500">
          Free visitors always see the same masked preview. These switches control the extra
          details paid members unlock on your profile.
        </p>

        <ul className="mt-5 space-y-3">
          {PRIVACY_OPTIONS.map((opt) => (
            <li key={opt.key}>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3.5 transition-colors hover:border-brand-300 has-checked:border-brand-400 has-checked:bg-brand-50/50">
                <input
                  type="checkbox"
                  name={opt.key}
                  defaultChecked={initial[opt.key] !== false}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#9e0b1e]"
                />
                <span>
                  <span className="block text-sm font-bold text-stone-900">{opt.title}</span>
                  <span className="mt-0.5 block text-xs text-stone-500">{opt.body}</span>
                </span>
              </label>
            </li>
          ))}
          <li>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3.5 transition-colors hover:border-brand-300 has-checked:border-brand-400 has-checked:bg-brand-50/50">
              <input
                type="checkbox"
                name="whatsapp_opt_in"
                defaultChecked={whatsappOptIn}
                className="mt-1 h-4 w-4 shrink-0 accent-[#9e0b1e]"
              />
              <span>
                <span className="block text-sm font-bold text-stone-900">
                  Allow WhatsApp contact after a mutual match
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  Mutual matches can message you on WhatsApp in addition to calling. Your number
                  still stays hidden until interest is mutual.
                </span>
              </span>
            </label>
          </li>
        </ul>

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
            {error}
          </p>
        )}
        {saved && !error && (
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
            <Check className="h-3.5 w-3.5" /> Saved — your preferences are live.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="btn-primary mt-5 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save preferences
        </button>
      </form>

      <div className="card p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <UserX className="h-5 w-5 text-brand-600" aria-hidden />
          <h2 className="font-display text-lg font-bold text-maroon">Blocked members</h2>
        </div>
        <p className="mt-1 text-sm text-stone-500">
          Blocked members cannot find you, view your profile or message you — and you will not
          see them either. Unblocking is instant.
        </p>
        {blocks.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-stone-50 px-4 py-3.5 text-sm text-stone-500">
            You haven&apos;t blocked anyone.
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {blocks.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-stone-900">Blocked member</p>
                  <p className="text-xs text-stone-400">
                    Blocked {new Date(b.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => unblock(b)}
                  disabled={unblocking === b.id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stone-300 px-4 py-1.5 text-xs font-bold text-stone-700 hover:border-brand-400 hover:text-brand-700 disabled:opacity-60"
                >
                  {unblocking === b.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
