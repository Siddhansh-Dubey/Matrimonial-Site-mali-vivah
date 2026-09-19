'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Flag, Loader2, Play, Plus, X, Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
import type { MomentItem } from '@/lib/supabase/database.types'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 30 * 1024 * 1024

const REPORT_REASONS = [
  'inappropriate_content',
  'fake_profile',
  'harassment',
  'spam',
  'other',
] as const

/**
 * Mali Moments — 24-hour photo AND video stories. Members post media (optional
 * caption); it auto-expires server-side. The rail comes from list_moments()
 * which already filters blocked authors and admin-removed posts. Other
 * members' moments can be reported for moderation (moment_reports).
 */
export function MomentsRail() {
  const [moments, setMoments] = useState<MomentItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewer, setViewer] = useState<MomentItem | null>(null)
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

  async function post(file: File, caption: string) {
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) return
      const isVideo = file.type.startsWith('video/')
      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
      if (file.size > limit) {
        setError(
          isVideo
            ? 'Videos must be under 30 MB — trim it and try again.'
            : 'Photos must be under 10 MB — pick a smaller file.'
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
                // eslint-disable-next-line jsx-a11y/media-has-caption
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
                <span className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white">
                  <Play className="h-4 w-4 fill-current" />
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
        <MomentViewer
          moment={viewer}
          onClose={() => setViewer(null)}
          onDelete={() => removeMoment(viewer)}
        />
      )}
    </div>
  )
}

function MomentViewer({
  moment,
  onClose,
  onDelete,
}: {
  moment: MomentItem
  onClose: () => void
  onDelete: () => void
}) {
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>('inappropriate_content')
  const [details, setDetails] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportDone, setReportDone] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

  async function submitReport() {
    setReportBusy(true)
    setReportError(null)
    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) return
      const { error } = await supabase.from('moment_reports').insert({
        moment_id: moment.id,
        reporter_id: uid,
        reason,
        details: details.trim() || null,
      })
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          setReportDone(true)
        } else {
          setReportError(error.message)
        }
        return
      }
      setReportDone(true)
    } catch {
      setReportError('Could not send the report. Please try again.')
    } finally {
      setReportBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
        {moment.media_type === 'video' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={photoUrl(moment.storage_path) ?? ''}
            controls
            playsInline
            preload="metadata"
            className="max-h-[68vh] w-full bg-black object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl(moment.storage_path) ?? ''} alt={moment.caption ?? 'Moment'} className="max-h-[68vh] w-full object-cover" />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="p-4">
          <p className="text-sm font-bold text-stone-900">{moment.name}</p>
          {moment.caption && <p className="mt-1 text-sm text-stone-600">{moment.caption}</p>}
          <p className="mt-1 text-xs text-stone-400">{timeLeft(moment.expires_at)} remaining · expires automatically</p>
          {moment.is_mine && (
            <button
              type="button"
              onClick={onDelete}
              className="mt-3 text-xs font-semibold text-brand-700 hover:underline"
            >
              Delete this moment
            </button>
          )}
          {!moment.is_mine && !reportDone && !reporting && (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-brand-700 hover:underline"
            >
              <Flag className="h-3.5 w-3.5" /> Report this moment
            </button>
          )}
          {!moment.is_mine && !reportDone && reporting && (
            <div className="mt-3 rounded-xl bg-stone-50 p-3">
              <label className="label" htmlFor="moment-report-reason">Why are you reporting this?</label>
              <select
                id="moment-report-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as (typeof REPORT_REASONS)[number])}
                className="input mt-1.5 text-sm"
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
              <input
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Anything we should know? (optional)"
                maxLength={240}
                className="input mt-2 text-sm"
              />
              {reportError && <p className="mt-2 text-xs font-semibold text-brand-700">{reportError}</p>}
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={submitReport}
                  disabled={reportBusy}
                  className="inline-flex items-center gap-1.5 rounded-full bg-maroon px-4 py-1.5 text-xs font-bold text-white hover:bg-maroon-dark disabled:opacity-60"
                >
                  {reportBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Send report
                </button>
                <button
                  type="button"
                  onClick={() => setReporting(false)}
                  className="rounded-full px-4 py-1.5 text-xs font-semibold text-stone-500 hover:text-stone-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {!moment.is_mine && reportDone && (
            <p className="mt-3 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              Reported — our team will review this moment shortly.
            </p>
          )}
        </div>
      </div>
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
          onClick={() => setOpen((v) => !v)}
          className="btn-secondary !py-2 text-xs"
        >
          <Plus className="h-4 w-4" /> Post a moment
        </button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-maroon px-4 py-2 text-xs font-bold text-white hover:bg-maroon-dark">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Choose photo or video
            <input
              type="file"
              accept="image/*,video/*"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  onPost(f, caption)
                  setOpen(false)
                }
                e.target.value = ''
              }}
            />
          </label>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption (optional)"
            maxLength={200}
            className="input flex-1 !py-2 text-sm"
          />
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
