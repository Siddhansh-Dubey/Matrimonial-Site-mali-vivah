import { MessageCircle } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { updateWhatsAppConfig } from '@/app/admin/actions'
import { SUPPORT_WHATSAPP_NUMBER } from '@/lib/contact'

export const metadata = { title: 'Admin · WhatsApp' }
export const dynamic = 'force-dynamic'

/**
 * WhatsApp Links (PRD N) — the single source of truth for the operational
 * WhatsApp values: the Join-Community link, the support chat link and the
 * support number. Replaces the hard-coded constants in src/lib/contact.ts,
 * which remain only as a safe fallback when this table is empty/inactive.
 */
export default async function AdminWhatsAppPage() {
  const { admin } = await requireAdminPage()

  const { data: row } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  type WaRow = {
    community_link: string | null
    support_link: string | null
    support_number: string | null
    is_active: boolean
  }
  const cfg = (row as WaRow | null) ?? {
    community_link: null,
    support_link: `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`,
    support_number: SUPPORT_WHATSAPP_NUMBER,
    is_active: true,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">WhatsApp Configuration</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">
          Where these appear: footer chat button, the About → Contact card, the homepage WhatsApp
          community band and (once you set a community link) the community join button.
        </p>
      </div>

      <form action={updateWhatsAppConfig} className="max-w-2xl rounded-2xl border border-stone-200 bg-white p-6">
        <label className="block">
          <span className="text-sm font-semibold text-stone-800">Join Community link</span>
          <span className="mt-0.5 block text-xs text-stone-500">
            The “Join” button on WhatsApp for the community group —
            <span className="font-semibold"> https://chat.whatsapp.com/…</span> (leave empty to
            hide community buttons and show support chat instead)
          </span>
          <input
            name="community_link"
            defaultValue={cfg.community_link ?? ''}
            placeholder="https://chat.whatsapp.com/AbC123"
            className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
          />
        </label>

        <label className="mt-5 block">
          <span className="text-sm font-semibold text-stone-800">Support number</span>
          <span className="mt-0.5 block text-xs text-stone-500">
            Digits only, country code included (e.g. 919876543210)
          </span>
          <input
            name="support_number"
            defaultValue={cfg.support_number ?? ''}
            inputMode="numeric"
            className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
          />
        </label>

        <label className="mt-5 block">
          <span className="text-sm font-semibold text-stone-800">Support chat link</span>
          <span className="mt-0.5 block text-xs text-stone-500">
            <span className="font-semibold">https://wa.me/…</span> — if left empty it is built
            from the support number above
          </span>
          <input
            name="support_link"
            defaultValue={cfg.support_link ?? ''}
            placeholder="https://wa.me/919876543210"
            className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
          />
        </label>

        <label className="mt-5 flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={cfg.is_active}
            className="h-4 w-4 rounded border-stone-300 text-maroon focus:ring-maroon"
          />
          Config active (off = app falls back to its built-in contact details)
        </label>

        <div className="mt-6 flex items-center gap-3">
          <button type="submit" className="inline-flex items-center gap-2 rounded-full bg-maroon px-6 py-2.5 text-sm font-bold text-white hover:bg-maroon-dark">
            <MessageCircle className="h-4 w-4" /> Save WhatsApp configuration
          </button>
        </div>
      </form>
    </div>
  )
}
