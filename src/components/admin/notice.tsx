import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { NOTICE_TEXT } from '@/lib/admin/members'

/**
 * Renders the `?ok=` / `?error=` notice a member-management action redirected
 * back with. `ok` carries a short code (mapped to copy here); `error` carries
 * the already-humanised message from friendlyAdminError().
 */
export function AdminNotice({ ok, error }: { ok?: string; error?: string }) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />
        <span className="min-w-0 break-words">{error.slice(0, 400)}</span>
      </div>
    )
  }
  if (ok) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
        <span className="min-w-0 break-words">{NOTICE_TEXT[ok] ?? 'Done.'}</span>
      </div>
    )
  }
  return null
}
