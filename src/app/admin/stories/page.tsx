import { Heart } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { deleteStory, saveStory } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Stories' }
export const dynamic = 'force-dynamic'

type Props = { searchParams?: { edit?: string } }

export default async function AdminStoriesPage({ searchParams }: Props) {
  const { admin } = await requireAdminPage()
  const { data: rows } = await admin.from('success_stories').select('*').order('sort_order')

  const editing = (rows ?? []).find((s) => s.id === (searchParams?.edit ?? '')) ?? null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <Heart className="h-6 w-6 text-brand-600" /> Success stories
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Publish only with the couple&apos;s written permission. Drafts never appear publicly.
        </p>
      </div>

      <form action={saveStory} className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5">
        <p className="text-sm font-bold text-stone-800">{editing ? 'Edit story' : 'New story'}</p>
        <input type="hidden" name="id" value={editing?.id ?? ''} />
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="couple_names" required placeholder="Couple names (e.g. Sneha & Rohan)" defaultValue={editing?.couple_names ?? ''} className="rounded-xl border border-stone-300 px-3 py-2 text-sm" />
          <input name="title" required placeholder='Title (e.g. "Found each other in a week")' defaultValue={editing?.title ?? ''} className="rounded-xl border border-stone-300 px-3 py-2 text-sm" />
        </div>
        <textarea name="story" required rows={5} placeholder="Their story, in their words" defaultValue={editing?.story ?? ''} className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm" />
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="photo_path" placeholder="Optional photo storage path" defaultValue={editing?.photo_path ?? ''} className="rounded-xl border border-stone-300 px-3 py-2 text-sm" />
          <input name="wedding_date" type="date" defaultValue={editing?.wedding_date ?? ''} className="rounded-xl border border-stone-300 px-3 py-2 text-sm" />
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="hidden" name="is_published" value="false" />
          <input type="checkbox" name="is_published" value="true" defaultChecked={editing?.is_published ?? false} className="h-4 w-4" />
          Published (visible to everyone)
        </label>
        <div>
          <button type="submit" className="rounded-full bg-maroon px-6 py-2 text-sm font-bold text-white">
            {editing ? 'Save story' : 'Create story'}
          </button>
          {editing && (
            <a href="/admin/stories" className="ml-3 text-sm font-bold text-stone-600 hover:underline">
              Cancel
            </a>
          )}
        </div>
      </form>

      <ul className="space-y-3">
        {(rows ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4">
            <div className="min-w-0">
              <p className="font-semibold text-stone-900">
                {s.couple_names}{' '}
                <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${s.is_published ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-500'}`}>
                  {s.is_published ? 'PUBLISHED' : 'DRAFT'}
                </span>
              </p>
              <p className="text-xs text-stone-500">{s.title}</p>
            </div>
            <div className="flex items-center gap-3">
              <a href={`/admin/stories?edit=${s.id}`} className="text-xs font-bold text-stone-700 hover:underline">
                Edit
              </a>
              <form action={deleteStory}>
                <input type="hidden" name="id" value={s.id} />
                <button type="submit" className="text-xs font-bold text-brand-700 hover:underline">
                  Delete
                </button>
              </form>
            </div>
          </li>
        ))}
        {(rows ?? []).length === 0 && (
          <li className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
            No stories yet — publish the first one above.
          </li>
        )}
      </ul>
    </div>
  )
}
