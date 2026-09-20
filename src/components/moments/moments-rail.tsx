'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Flag, Loader2, Plus, Video, X, Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
import type { MomentItem, ReportReason } from '@/lib/supabase/database.types'

/**
 * Mali Moments — 24-hour photo AND video stories.
 *
 *  • Members post a photo or a short video (optional caption); content
 *    auto-expires server-side (expires_at) — no likes, comments or followers
 *    by design.
 *  • The rail comes from list_moments(), which already filters blocked
 *    authors and admin-removed posts.
 *  • Anyone can report a moment (report_moment RPC — server-authoritative,
 *    deduped, reporter identity never revealed to the author).
 *  • Upload limits are enforced before the request: photos ≤ 10 MB,
 *    videos ≤ 50 MB (Storage also enforces its own project-level cap).
 */

const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'harassment', label: 'Harassment or disrespect' },
  { value: 'fake_profile', label: 'Looks fake or misleading' },
  { value: 'spam', label: 'Spam or advertisement' },
  { value: 'other', label: 'Something else' },
]

export function MomentsRail() {
  const [moments, setMoments] = useState<MomentItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewer, setViewer] = useState<MomentItem | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<ReportReason>('inappropriate_content')
  const [reportDetails, setReportDetails] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportDone, setReportDone] = useState<'filed' | 'duplicate' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return
    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('list_moments')
      if (rpcError) {
        setError(null)
        setMoments([])
      } else {
        setMoments(((data as MomentItem[] | null) ?? []).filter(Boolean))
      }
    } catch {
      /* ignore */
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function resetReportState() {
    setReportOpen(false)
    setReportDetails('')
    setReportDone(null)
    setReportError(null)
  }

  async function post(file: File, caption: string) {
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) return

      const isVideo = file.type.startsWith('video/')
      const isImage = file.type.startsWith('image/')
      if (!isVideo && !isImage) {
        setError('Moments can be photos or videos only.')
        return
      }
      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES
      if (file.size > limit) {
        setError(
          isVideo
            ? 'Videos must be 50 MB or smaller. Trim the clip and try again.'
            : 'Photos must be 10 MB or smaller.'
        )
        return
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const path = `${uid}/moments/${Date.now()}-${safeName}`
      const { error: upError } = await supabase.storage.from('profile-photos').upload(path, file, { upsert: false })
      if (upError) {
        setError(upError.message)
        return
      }
      const { error: insertError } = await supabase.from('moments').insert({
        user_id: uid,
        media_type: isVideo ? 'video' : 'photo',
        storage_path: path,
        caption: caption.trim() || null,
      })
      if (insertError) {
        await supabase.storage.from('profile-photos').remove([path])
        setError(insertError.message)
        return
      }
      await load()
    } catch {
      setError('Could not post the moment. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  /** Report a moment — server-authoritative (report_moment RPC). */
  async function report(m: MomentItem, reason: ReportReason, details: string) {
    setReportBusy(true)
    setReportError(null)
    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('report_moment', {
        p_moment_id: m.id,
        p_reason: reason,
        p_details: details.trim() || null,
      })
      if (rpcError) {
        if (rpcError.message.includes('MOMENT_NOT_FOUND')) {
          setReportError('This moment is no longer available.')
          setViewer(null)
          return
        }
        if (rpcError.message.includes('CANNOT_REPORT_OWN_MOMENT')) {
          setReportError('You cannot report your own moment.')
          return
        }
        setReportError('Could not submit the report. Please try again.')
        return
      }
      const res = data as { status?: string } | null
      setReportDone(res?.status === 'already_reported' ? 'duplicate' : 'filed')
    } catch {
      setReportError('Could not submit the report. Please try again.')
    } finally {
      setReportBusy(false)
    }
  }

  async function removeMoment(m: MomentItem) {
    try {
      const supabase = createClient()
      await supabase.from('moments').delete().eq('id', m.id)
      await supabase.storage.from('profile-photos').remove([m.storage_path])
      setViewer(null)
      await load()
    } catch {
      /* ignore */
    }
  }

  function scroll(dir: 1 | -1) {
    railRef.current?.scrollBy({ left: dir * 240, behavior: 'smooth' })
  }

  if (!loaded) return null
  if (moments.length === 0 && !error) {
    return (
      <div className="mx-auto max-w-5xl">
        <MomentsHeader count={0} onPost={post} busy={busy} error={error} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <MomentsHeader count={moments.length} onPost={post} busy={busy} error={error} />

      <div className="relative mt-4">
        {moments.length > 3 && (
          <>
            <button
              type="button"
              onClick={() => scroll(-1)}
              aria-label="Scroll moments left"
              className="absolute -left-3 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white shadow-lg ring-1 ring-stone-200 sm:grid"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scroll(1)}
              aria-label="Scroll moments right"
              className="absolute -right-3 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white shadow-lg ring-1 ring-stone-200 sm:grid"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
        <div ref={railRef} className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none]">
          {moments.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setViewer(m)}
              className="group relative w-40 shrink-0 snap-start overflow-hidden rounded-2xl bg-stone-900 ring-1 ring-stone-200"
            >
              {m.media_type === 'video' ? (
                <video
                  src={photoUrl(m.storage_path) ?? ''}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-56 w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl(m.storage_path) ?? ''}
                  alt={m.caption ?? 'Moment'}
                  className="h-56 w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                />
              )}
              {m.media_type === 'video' && (
                <span className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white ring-1 ring-white/40">
                  <Video className="h-5 w-5" />
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2.5 pt-8 text-left">
                <p className="truncate text-xs font-bold text-white">{m.name}</p>
                <p className="text-[10px] text-white/70">{timeLeft(m.expires_at)}</p>
              </div>
              {m.author_photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl(m.author_photo) ?? ''}
                  alt=""
                  className="absolute left-3 top-3 h-8 w-8 rounded-full object-cover ring-2 ring-white"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {viewer && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setViewer(null)
            resetReportState()
          }}
        >
          <div className="relative max-h-[88vh] w-full max-w-md overflow-hidden rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            {viewer.media_type === 'video' ? (
              <video
                src={photoUrl(viewer.storage_path) ?? ''}
                controls
                playsInline
                className="max-h-[68vh] w-full bg-black object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl(viewer.storage_path) ?? ''} alt={viewer.caption ?? 'Moment'} className="max-h-[68vh] w-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => {
                setViewer(null)
                resetReportState()
              }}
              aria-label="Close"
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="p-4">
              <p className="flex items-center gap-1.5 text-sm font-bold text-stone-900">
                {viewer.name}
                {viewer.media_type === 'video' && <Video className="h-3.5 w-3.5 text-stone-400" aria-label="Video moment" />}
              </p>
              {viewer.caption && <p className="mt-1 text-sm text-stone-600">{viewer.caption}</p>}
              <p className="mt-1 text-xs text-stone-400">{timeLeft(viewer.expires_at)} remaining · expires automatically</p>

              <div className="mt-3 flex items-center gap-4">
                {viewer.is_mine ? (
                  confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-brand-700">Delete this moment?</span>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDelete(false)
                          removeMoment(viewer)
                        }}
                        className="rounded bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800"
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="text-xs text-stone-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="text-xs font-semibold text-brand-700 hover:underline"
                    >
                      Delete this moment
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setReportOpen((v) => !v)
                      setReportDone(null)
                      setReportError(null)
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-stone-500 hover:text-brand-700"
                  >
                    <Flag className="h-3.5 w-3.5" /> Report
                  </button>
                )}
              </div>

              {reportOpen && !viewer.is_mine && (
                <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                  {reportDone ? (
                    <p className="text-xs font-semibold text-emerald-800">
                      {reportDone === 'duplicate'
                        ? 'You already reported this moment — our team has it in queue.'
                        : 'Thank you — our team will review this moment.'}
                    </p>
                  ) : (
                    <>
                      <select
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value as ReportReason)}
                        className="input w-full !py-2 text-xs"
                        aria-label="Report reason"
                      >
                        {REPORT_REASONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                      <textarea
                        rows={2}
                        value={reportDetails}
                        onChange={(e) => setReportDetails(e.target.value)}
                        placeholder="Add details (optional)"
                        maxLength={300}
                        className="input mt-2 w-full resize-none !py-2 text-xs"
                      />
                      <div className="mt-2 flex items-center justify-between">
                        {reportBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => report(viewer, reportReason, reportDetails)}
                            className="text-xs font-bold text-brand-700 hover:underline"
                          >
                            Submit report
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReportOpen(false)
                            setReportDone(null)
                            setReportError(null)
                          }}
                          className="text-xs font-semibold text-stone-500 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                      {reportError && <p className="mt-2 text-xs font-semibold text-brand-700">{reportError}</p>}
                      <p className="mt-2 text-[10px] leading-relaxed text-stone-400">
                        Reports are confidential — the member will not be told who reported the moment.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MomentsHeader({
  count,
  onPost,
  busy,
  error,
}: {
  count: number
  onPost: (file: File, caption: string) => void
  busy: boolean
  error: string | null
}) {
  const [caption, setCaption] = useState('')
  const [open, setOpen] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [warnAgreed, setWarnAgreed] = useState(false)

  if (!isSupabaseConfigured) return null

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 font-display text-2xl font-bold text-maroon">
          <Zap className="h-5 w-5 text-gold-600" /> Mali Moments
          <span className="text-xs font-medium text-stone-400">
            {count > 0 ? `${count} live today` : 'share a 24-hour moment'}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v)
            setWarnAgreed(false)
          }}
          className="btn-secondary !py-2 text-xs"
        >
          <Plus className="h-4 w-4" /> Post a moment
        </button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-white transition-colors ${
                agreed && !busy
                  ? 'cursor-pointer bg-maroon hover:bg-maroon-dark'
                  : 'cursor-not-allowed bg-stone-300'
              }`}
              onClick={(e) => {
                if (!agreed) {
                  e.preventDefault()
                  setWarnAgreed(true)
                }
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Choose photo or video
              <input
                type="file"
                accept="image/*,video/*"
                className="sr-only"
                disabled={busy || !agreed}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f && agreed) {
                    onPost(f, caption)
                    setOpen(false)
                    setAgreed(false)
                    setCaption('')
                  }
                  e.target.value = ''
                }}
              />
            </label>
            <div className="flex-1">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a caption (optional)"
                maxLength={200}
                className="input w-full !py-2 text-sm"
              />
              <p className="mt-1.5 text-[10px] text-stone-400">
                Photos up to 10 MB · videos up to 50 MB · expires automatically after 24 hours
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-stone-100 pt-3">
            <input
              id="moment-guidelines"
              type="checkbox"
              checked={agreed}
              onChange={(e) => {
                setAgreed(e.target.checked)
                if (e.target.checked) setWarnAgreed(false)
              }}
              className="h-4 w-4 rounded border-stone-300 text-maroon focus:ring-maroon"
            />
            <label htmlFor="moment-guidelines" className="cursor-pointer text-xs text-stone-600">
              I confirm this media belongs to me and complies with community decency guidelines.
            </label>
          </div>
          {warnAgreed && !agreed && (
            <p className="text-xs font-semibold text-brand-700">
              Please check the confirmation box above before uploading.
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs font-semibold text-brand-700">{error}</p>}
    </div>
  )
}

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `${hours}h left`
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`
}
