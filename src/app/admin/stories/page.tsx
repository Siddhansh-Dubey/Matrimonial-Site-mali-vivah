import { Heart, Star, CheckCircle, Clock, Trash2, Globe, EyeOff, ShieldCheck, User } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { deleteStory, publishStory, saveStory, unpublishStory } from '@/app/admin/actions'
import { photoUrl } from '@/lib/profile/photos'
import type { SuccessStoryRow } from '@/lib/supabase/database.types'

export const metadata = { title: 'Admin · Stories' }
export const dynamic = 'force-dynamic'

type Props = { searchParams?: { edit?: string; filter?: string } }

export default async function AdminStoriesPage({ searchParams }: Props) {
  const { admin } = await requireAdminPage()
  const { data: rawRows } = await admin
    .from('success_stories')
    .select('*')
    .order('created_at', { ascending: false })

  const rows = (rawRows ?? []) as SuccessStoryRow[]

  // Fetch submitter profile details for member-submitted stories
  const submitterIds = Array.from(new Set(rows.map((r) => r.submitted_by).filter(Boolean))) as string[]
  let submitterMap = new Map<string, { id: string; full_name: string; email: string; mobile: string | null }>()
  if (submitterIds.length > 0) {
    const { data: profs } = await admin
      .from('profiles')
      .select('id, full_name, email, mobile')
      .in('id', submitterIds)
    if (profs) {
      submitterMap = new Map(profs.map((p) => [p.id, p]))
    }
  }

  const editing = rows.find((s) => s.id === (searchParams?.edit ?? '')) ?? null
  const filter = searchParams?.filter ?? 'all'

  const filteredRows = rows.filter((s) => {
    if (filter === 'pending') return !s.is_published && Boolean(s.submitted_by)
    if (filter === 'published') return s.is_published
    if (filter === 'drafts') return !s.is_published && !s.submitted_by
    return true
  })

  const pendingCount = rows.filter((s) => !s.is_published && Boolean(s.submitted_by)).length
  const publishedCount = rows.filter((s) => s.is_published).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
            <Heart className="h-6 w-6 text-brand-600" /> Success stories &amp; reviews
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Member submissions require admin moderation before appearing publicly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              <Clock className="h-3.5 w-3.5" /> {pendingCount} Pending Review
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
            <CheckCircle className="h-3.5 w-3.5" /> {publishedCount} Published
          </span>
        </div>
      </div>

      {/* Story Edit / Create Form */}
      <form action={saveStory} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-base font-bold text-stone-900">
          {editing ? `Edit Story: ${editing.couple_names}` : 'Create New Administrator Story'}
        </p>
        <input type="hidden" name="id" value={editing?.id ?? ''} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold text-stone-700">Couple Names *</label>
            <input
              name="couple_names"
              required
              placeholder="e.g. Rohan & Sneha"
              defaultValue={editing?.couple_names ?? ''}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-stone-700">Story Title *</label>
            <input
              name="title"
              required
              placeholder='e.g. "From a profile to forever"'
              defaultValue={editing?.title ?? ''}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="text-xs font-bold text-stone-700">Rating (1 to 5 Stars)</label>
            <select
              name="rating"
              defaultValue={editing?.rating ?? 5}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="5">5 — Wonderful</option>
              <option value="4">4 — Very good</option>
              <option value="3">3 — Good</option>
              <option value="2">2 — Fair</option>
              <option value="1">1 — Needs improvement</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-stone-700">Milestone</label>
            <select
              name="milestone"
              defaultValue={editing?.milestone ?? 'found_match'}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="found_match">We found our match</option>
              <option value="engaged">We are engaged</option>
              <option value="married">We are married</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-stone-700">Wedding Date (Optional)</label>
            <input
              name="wedding_date"
              type="date"
              defaultValue={editing?.wedding_date ?? ''}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-stone-700">Story Text *</label>
          <textarea
            name="story"
            required
            rows={5}
            placeholder="Their story, in their words"
            defaultValue={editing?.story ?? ''}
            className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm leading-relaxed"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold text-stone-700">Photo Storage Path</label>
            <input
              name="photo_path"
              placeholder="e.g. userId/stories-...jpg"
              defaultValue={editing?.photo_path ?? ''}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-stone-700">Note to Future Members</label>
            <input
              name="future_members_note"
              placeholder="Advice or encouraging note"
              defaultValue={editing?.future_members_note ?? ''}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="pt-2">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-stone-800">
            <input type="hidden" name="is_published" value="false" />
            <input
              type="checkbox"
              name="is_published"
              value="true"
              defaultChecked={editing?.is_published ?? false}
              className="h-4 w-4 rounded text-maroon focus:ring-maroon"
            />
            Published (visible on public /success-stories page)
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" className="rounded-full bg-maroon px-6 py-2.5 text-sm font-bold text-white shadow hover:bg-maroon-deep transition-colors">
            {editing ? 'Save Story' : 'Create Story'}
          </button>
          {editing && (
            <a href="/admin/stories" className="text-sm font-bold text-stone-600 hover:underline">
              Cancel
            </a>
          )}
        </div>
      </form>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 pb-2">
        <a
          href="/admin/stories"
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            filter === 'all' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          All Stories ({rows.length})
        </a>
        <a
          href="/admin/stories?filter=pending"
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            filter === 'pending'
              ? 'bg-amber-600 text-white'
              : 'text-amber-800 bg-amber-50 hover:bg-amber-100'
          }`}
        >
          Pending Review ({pendingCount})
        </a>
        <a
          href="/admin/stories?filter=published"
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            filter === 'published' ? 'bg-emerald-700 text-white' : 'text-emerald-800 bg-emerald-50 hover:bg-emerald-100'
          }`}
        >
          Published ({publishedCount})
        </a>
        <a
          href="/admin/stories?filter=drafts"
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            filter === 'drafts' ? 'bg-stone-700 text-white' : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          Admin Drafts ({rows.filter((s) => !s.is_published && !s.submitted_by).length})
        </a>
      </div>

      {/* Stories List */}
      <ul className="space-y-4">
        {filteredRows.map((s) => {
          const isPending = !s.is_published && Boolean(s.submitted_by)
          const isDraft = !s.is_published && !s.submitted_by
          const submitter = s.submitted_by ? submitterMap.get(s.submitted_by) : null

          let valuedList: string[] = []
          if (Array.isArray(s.valued_features)) {
            valuedList = s.valued_features as string[]
          }

          return (
            <li
              key={s.id}
              className={`overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition-all ${
                isPending ? 'border-amber-300 ring-2 ring-amber-100' : 'border-stone-200'
              }`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1 space-y-3">
                  {/* Status & couple header */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-bold text-stone-900">
                      {s.couple_names}
                    </span>
                    {s.is_published ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                        <Globe className="h-3 w-3" /> PUBLISHED
                      </span>
                    ) : isPending ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-300">
                        <Clock className="h-3 w-3" /> PENDING SUBMISSION
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold text-stone-600">
                        <EyeOff className="h-3 w-3" /> ADMIN DRAFT
                      </span>
                    )}

                    {s.consent_to_publish && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                        <ShieldCheck className="h-3.5 w-3.5" /> Consent confirmed
                      </span>
                    )}
                  </div>

                  {/* Title & Rating */}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold text-gold-700">{s.title}</span>
                    {s.rating && (
                      <div className="flex items-center gap-1 text-xs font-bold text-amber-600">
                        <div className="flex items-center">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`h-3 w-3 ${i < s.rating! ? 'fill-amber-400 text-amber-500' : 'text-stone-300'}`}
                            />
                          ))}
                        </div>
                        <span>({s.rating}/5)</span>
                      </div>
                    )}
                    {s.milestone && (
                      <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700">
                        {s.milestone === 'found_match'
                          ? 'Found match'
                          : s.milestone === 'engaged'
                            ? 'Engaged'
                            : 'Married'}
                      </span>
                    )}
                    {s.wedding_date && (
                      <span className="text-xs text-stone-500">
                        Wedding: {new Date(s.wedding_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>

                  {/* Submitting member information */}
                  {submitter && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-700">
                      <User className="h-3.5 w-3.5 text-stone-400" />
                      <span className="font-semibold text-stone-900">{submitter.full_name}</span>
                      <span>·</span>
                      <span>{submitter.email}</span>
                      {submitter.mobile && (
                        <>
                          <span>·</span>
                          <span>{submitter.mobile}</span>
                        </>
                      )}
                      <span>·</span>
                      <span className="text-stone-500">
                        Submitted{' '}
                        {new Date(s.submitted_at ?? s.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  )}

                  {/* Story Text */}
                  <p className="text-sm leading-relaxed text-stone-700 whitespace-pre-line bg-stone-50/50 p-3 rounded-xl border border-stone-100">
                    {s.story}
                  </p>

                  {/* Valued features chips */}
                  {valuedList.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[11px] font-semibold text-stone-500">Valued:</span>
                      {valuedList.map((f) => (
                        <span
                          key={f}
                          className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] font-medium text-brand-800"
                        >
                          {f.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Note to future members */}
                  {s.future_members_note && (
                    <p className="text-xs italic text-stone-600 bg-amber-50/40 px-3 py-1.5 rounded-lg border border-amber-100">
                      <span className="font-semibold not-italic">Note to future members:</span> &ldquo;{s.future_members_note}&rdquo;
                    </p>
                  )}
                </div>

                {/* Right side: Photo & Action buttons */}
                <div className="flex flex-col items-end gap-3 lg:w-48 shrink-0">
                  {s.photo_path && photoUrl(s.photo_path) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoUrl(s.photo_path) ?? ''}
                      alt={s.couple_names}
                      className="h-28 w-40 rounded-xl object-cover object-top border border-stone-200"
                    />
                  ) : (
                    <div className="flex h-20 w-32 items-center justify-center rounded-xl bg-stone-100 text-stone-400 text-xs">
                      No photo
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                    {!s.is_published ? (
                      <form action={publishStory}>
                        <input type="hidden" name="id" value={s.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 transition-colors shadow-sm"
                        >
                          Publish
                        </button>
                      </form>
                    ) : (
                      <form action={unpublishStory}>
                        <input type="hidden" name="id" value={s.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-100 transition-colors"
                        >
                          Unpublish
                        </button>
                      </form>
                    )}

                    <a
                      href={`/admin/stories?edit=${s.id}`}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-100 transition-colors"
                    >
                      Edit
                    </a>

                    <form action={deleteStory}>
                      <input type="hidden" name="id" value={s.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        {isPending ? 'Reject' : 'Delete'}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </li>
          )
        })}

        {filteredRows.length === 0 && (
          <li className="rounded-2xl border border-dashed border-stone-300 p-12 text-center text-sm text-stone-500">
            No stories matching this filter.
          </li>
        )}
      </ul>
    </div>
  )
}
