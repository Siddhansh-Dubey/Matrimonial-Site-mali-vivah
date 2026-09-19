import { Settings2 } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { updateSiteConfig } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Site settings' }
export const dynamic = 'force-dynamic'

/**
 * Operator-editable public settings: support channels shown in the footer +
 * About page, and à la carte boost pricing. Every save is audited; the site
 * falls back to compiled defaults when a key is missing.
 */
export default async function AdminSettingsPage() {
  const { admin } = await requireAdminPage()
  const { data } = await admin.from('site_config').select('key, value')
  const get = (key: string): string => {
    const row = (data ?? []).find((r) => r.key === key)
    const v = row?.value as unknown
    if (typeof v === 'string') return v
    if (typeof v === 'number') return String(v)
    return ''
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <Settings2 className="h-6 w-6 text-maroon" /> Site settings
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Public support channels and boost pricing. Changes go live immediately.
        </p>
      </div>

      <form action={updateSiteConfig} className="max-w-2xl space-y-5 rounded-2xl border border-stone-200 bg-white p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Support email" name="support_email" defaultValue={get('support_email')} hint="Shown on About → Contact." />
          <Field label="Support phone (display)" name="support_phone_display" defaultValue={get('support_phone_display')} hint="Shown on About → Contact." />
        </div>
        <Field
          label="Support WhatsApp number"
          name="support_whatsapp"
          defaultValue={get('support_whatsapp')}
          hint="Digits with country code, e.g. 919876543210. Powers the footer + About WhatsApp buttons."
        />
        <Field label="Support hours" name="support_hours" defaultValue={get('support_hours')} hint="One line, shown on About → Contact." />

        <div className="border-t border-stone-100 pt-5">
          <h2 className="font-display text-lg font-bold text-stone-900">Profile boost</h2>
          <p className="mt-0.5 text-xs text-stone-500">
            À la carte boost sold from the member dashboard when plan quota runs out.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="Boost price (₹)" name="boost_price_inr" defaultValue={get('boost_price_inr')} inputMode="numeric" />
            <Field label="Boost duration (days)" name="boost_duration_days" defaultValue={get('boost_duration_days')} inputMode="numeric" />
          </div>
        </div>

        <button
          type="submit"
          className="rounded-full bg-maroon px-6 py-2.5 text-sm font-bold text-white hover:bg-maroon-dark"
        >
          Save settings
        </button>
      </form>
    </div>
  )
}

function Field({
  label,
  name,
  defaultValue,
  hint,
  inputMode,
}: {
  label: string
  name: string
  defaultValue: string
  hint?: string
  inputMode?: 'numeric' | 'text'
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-stone-500">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        inputMode={inputMode ?? 'text'}
        className="mt-1.5 w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
      />
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  )
}
