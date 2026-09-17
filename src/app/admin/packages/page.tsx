import { Pencil, Star } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { updatePackage } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Packages' }
export const dynamic = 'force-dynamic'

type Props = { searchParams?: { edit?: string } }

/** Packages screen — price/duration/benefits/features are data, edited here. */
export default async function AdminPackagesPage({ searchParams }: Props) {
  const { admin } = await requireAdminPage()
  const { data: rows } = await admin.from('packages').select('*').order('sort_order')

  const editId = searchParams?.edit ? Number(searchParams.edit) : null
  const editing = (rows ?? []).find((p) => p.id === editId) ?? null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <Star className="h-6 w-6 text-gold-600" /> Packages &amp; pricing
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Everything a member pays comes from this table — changes are live immediately. Do NOT
          introduce prices below ₹999 or any ₹5,999 figure.
        </p>
      </div>

      {editing ? (
        <form action={updatePackage} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
          <input type="hidden" name="id" value={editing.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">Name</span>
              <input name="name" defaultValue={editing.name} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">Price (whole ₹)</span>
              <input name="price_inr" type="number" min={1} defaultValue={editing.price_inr} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">Duration (days)</span>
              <input name="duration_days" type="number" min={1} defaultValue={editing.duration_days} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">Badge text</span>
              <input name="badge_text" defaultValue={editing.badge_text ?? ''} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">Description</span>
            <textarea name="description" rows={2} defaultValue={editing.description} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">Features (one per line)</span>
            <textarea name="features" rows={6} defaultValue={(editing.features ?? []).join('\n')} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 font-mono text-xs" />
          </label>
          <label className="block text-sm">
            <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">Benefits (JSON)</span>
            <textarea name="benefits" rows={10} defaultValue={JSON.stringify(editing.benefits ?? {}, null, 2)} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 font-mono text-xs" />
          </label>
          <div className="flex flex-wrap items-center gap-5 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="hidden" name="is_active" value="false" />
              <input type="checkbox" name="is_active" value="true" defaultChecked={editing.is_active} className="h-4 w-4" />
              Active (visible in shop)
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="hidden" name="is_popular" value="false" />
              <input type="checkbox" name="is_popular" value="true" defaultChecked={editing.is_popular} className="h-4 w-4" />
              Mark as popular
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="rounded-full bg-maroon px-6 py-2.5 text-sm font-bold text-white">Save package</button>
            <a href="/admin/packages" className="rounded-full border border-stone-300 px-6 py-2.5 text-sm font-bold text-stone-700">Cancel</a>
          </div>
        </form>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(rows ?? []).map((p) => (
            <li key={p.id} className="rounded-2xl border border-stone-200 bg-white p-5">
              <p className="flex items-center justify-between font-display text-lg font-bold text-stone-900">
                {p.name}
                {!p.is_active && (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-500">INACTIVE</span>
                )}
              </p>
              <p className="text-sm text-stone-500">{p.slug} · tier: {p.tier}</p>
              <p className="mt-2 font-display text-2xl font-bold text-maroon">
                ₹{p.price_inr.toLocaleString('en-IN')}
                <span className="text-xs font-normal text-stone-500"> / {p.duration_days} days</span>
              </p>
              <ul className="mt-2 space-y-1 text-xs text-stone-600">
                {(p.features ?? []).slice(0, 4).map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
              <a
                href={`/admin/packages?edit=${p.id}`}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-stone-300 px-4 py-1.5 text-xs font-bold text-stone-700 hover:border-maroon"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </a>
            </li>
          ))}
          {(rows ?? []).length === 0 && (
            <li className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
              No packages yet — run the pricing migration first.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
