'use client'

import { useState } from 'react'
import { Check, Loader2, MessageCircle, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import type { Json } from '@/lib/supabase/database.types'

type PrivacyState = {
  showAbout: boolean
  showFamilyDetails: boolean
  showFamilyPhoto: boolean
  showIncome: boolean
  whatsappOptIn: boolean
}

const ROWS: {
  key: keyof PrivacyState
  label: string
  body: string
  dbKey: string
}[] = [
  {
    key: 'showAbout',
    label: 'Show “About me”',
    body: 'Your introduction is visible to paid members who view your profile.',
    dbKey: 'show_about',
  },
  {
    key: 'showFamilyDetails',
    label: 'Show family details',
    body: 'Your family description is visible to paid members.',
    dbKey: 'show_family_details',
  },
  {
    key: 'showFamilyPhoto',
    label: 'Show family photo',
    body: 'Your family photo is visible to paid members. Turning this off hides the photo from other members until you switch it back on.',
    dbKey: 'show_family_photo',
  },
  {
    key: 'showIncome',
    label: 'Show annual income',
    body: 'Your income band is visible to paid members.',
    dbKey: 'show_income',
  },
]

/**
 * Privacy toggles (PRD H). Writes are a single server upsert of the member's
 * OWN matrimony_profiles row (RLS-scoped) — no RPC needed, nothing can be
 * tampered with for another member.
 *
 * Note: `show_family_photo` only hides the photo from paid viewers. It does
 * NOT change publishability (the family photo is still required to go
 * live) — that matches the DB rule where visibility is about who can SEE it,
 * and the member's photo still satisfies the publish gate.
 */
export function PrivacySettingsCard({ initial }: { initial: PrivacyState }) {
  const [state, setState] = useState<PrivacyState>(initial)
  const [busy, setBusy] = useState<keyof PrivacyState | null>(null)
  const [saved, setSaved] = useState<keyof PrivacyState | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(key: keyof PrivacyState) {
    if (!isSupabaseConfigured || busy) return
    setBusy(key)
    setError(null)
    setSaved(null)
    const next = { ...state, [key]: !state[key] }
    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) return

      const dbKey = ROWS.find((r) => r.key === key)?.dbKey
      if (dbKey) {
        // Read-modify-write the JSONB so unrelated keys survive.
        const { data: row } = await supabase
          .from('matrimony_profiles')
          .select('privacy_settings')
          .eq('user_id', uid)
          .maybeSingle()
        const current = (row?.privacy_settings ?? {}) as Record<string, Json>
        const merged: Record<string, Json> = { ...current, [dbKey]: next[key] }
        const { error: upError } = await supabase
          .from('matrimony_profiles')
          .update({ privacy_settings: merged as Json })
          .eq('user_id', uid)
        if (upError) throw new Error(upError.message)
      } else {
        const { error: upError } = await supabase
          .from('matrimony_profiles')
          .update({ whatsapp_opt_in: next[key] })
          .eq('user_id', uid)
        if (upError) throw new Error(upError.message)
      }
      setState(next)
      setSaved(key)
    } catch (e) {
      setError(e instanceof Error ? 'Could not save the setting. Please try again.' : 'Could not save the setting.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card mt-8 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-stone-100 bg-gradient-to-r from-emerald-50 to-cream px-6 py-4">
        <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />
        <h2 className="font-display text-lg font-bold text-maroon">Profile privacy</h2>
      </div>

      <ul className="divide-y divide-stone-100">
        {ROWS.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                {row.label}
                {saved === row.key && <Check className="h-3.5 w-3.5 text-emerald-600" />}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-stone-500">{row.body}</p>
            </div>
            <Toggle
              on={state[row.key]}
              busy={busy === row.key}
              onClick={() => toggle(row.key)}
              label={`Toggle ${row.label}`}
            />
          </li>
        ))}

        <li className="flex items-center justify-between gap-4 bg-[#25d366]/5 px-6 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <MessageCircle className="h-4 w-4 text-[#25d366]" aria-hidden />
              WhatsApp contact opt-in
              {saved === 'whatsappOptIn' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">
              After a mutual match, show your number for WhatsApp so the other family can start a
              chat on wa.me. Your number is never revealed before mutual interest.
            </p>
          </div>
          <Toggle
            on={state.whatsappOptIn}
            busy={busy === 'whatsappOptIn'}
            onClick={() => toggle('whatsappOptIn')}
            label="Toggle WhatsApp opt-in"
          />
        </li>
      </ul>

      {error && (
        <p role="alert" className="border-t border-stone-100 px-6 py-3 text-xs font-semibold text-brand-700">
          {error}
        </p>
      )}

      <p className="border-t border-stone-100 bg-stone-50 px-6 py-3 text-[11px] leading-relaxed text-stone-500">
        Privacy settings never change how contact works: phone, WhatsApp and email details are
        revealed only after BOTH sides accept interest — and only to paid members.
      </p>
    </div>
  )
}

function Toggle({
  on,
  busy,
  onClick,
  label,
}: {
  on: boolean
  busy: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={[
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        on ? 'bg-emerald-500' : 'bg-stone-300',
        busy ? 'opacity-50' : '',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
          on ? 'left-[22px]' : 'left-0.5',
        ].join(' ')}
      >
        {busy && <Loader2 className="mx-auto h-3 w-3 animate-spin text-stone-400" />}
      </span>
    </button>
  )
}
