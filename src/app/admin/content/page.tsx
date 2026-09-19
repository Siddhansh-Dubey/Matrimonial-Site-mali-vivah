import { FileText } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { saveContentBlock } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Content' }
export const dynamic = 'force-dynamic'

const BLOCKS: { key: string; where: string }[] = [
  { key: 'home_register_cta', where: 'Homepage · Register CTA band' },
  { key: 'about_intro', where: 'About page · intro paragraph' },
  { key: 'about_cta', where: 'About page · call-to-action band' },
  { key: 'contact_intro', where: 'About page · Contact section intro' },
  { key: 'whatsapp_community', where: 'Homepage · WhatsApp community CTA' },
]

/**
 * Content Management (PRD M) — the focused set of editable website copy
 * blocks (site_content table). Each block has a built-in fallback in the
 * app; deactivating a block (is_active = false) restores the fallback.
 * Every save is audit-logged (admin_audit_log).
 */
export default async function AdminContentPage() {
  const { admin } = await requireAdminPage()

  const { data: rows } = await admin
    .from('site_content')
    .select('*')
    .order('sort_order')
  type ContentRow = {
    key: string
    title: string
    body: string
    is_active: boolean
    updated_at: string
  }
  const byKey = new Map(((rows ?? []) as unknown as ContentRow[]).map((r) => [r.key, r]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Content Management</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">
          Editable website copy. Unsaved or inactive blocks fall back to the app&apos;s built-in
          text, so the site is never broken. Changes go live immediately and are audit-logged.
        </p>
      </div>

      <div className="space-y-4">
        {BLOCKS.map(({ key, where }) => {
          const row = byKey.get(key)
          return (
            <form key={key} action={saveContentBlock} className="rounded-2xl border border-stone-200 bg-white p-5">
              <input type="hidden" name="key" value={key} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-bold text-stone-900">
                  <FileText className="h-4 w-4 text-maroon" />
                  {key}
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                    {where}
                  </span>
                </p>
                {row?.updated_at && (
                  <span className="text-[11px] text-stone-400">
                    last edited {new Date(row.updated_at).toLocaleString('en-IN')}
                  </span>
                )}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.6fr]">
                <label className="block">
                  <span className="text-xs font-semibold text-stone-500">Title</span>
                  <input
                    name="title"
                    defaultValue={row?.title ?? ''}
                    maxLength={200}
                    className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-stone-500">Body (required)</span>
                  <textarea
                    name="body"
                    defaultValue={row?.body ?? ''}
                    rows={3}
                    maxLength={5000}
                    required
                    className="mt-1 w-full resize-y rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={row?.is_active ?? true}
                    className="h-4 w-4 rounded border-stone-300 text-maroon focus:ring-maroon"
                  />
                  Active (off = use built-in fallback)
                </label>
                <button type="submit" className="rounded-full bg-maroon px-5 py-2 text-sm font-bold text-white hover:bg-maroon-dark">
                  Save block
                </button>
              </div>
            </form>
          )
        })}
      </div>
    </div>
  )
}
