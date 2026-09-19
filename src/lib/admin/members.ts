import 'server-only'
import type { Json, ProfileStatus } from '@/lib/supabase/database.types'

/**
 * Shared helpers for the Admin → Members module (Step 7).
 *
 * The database is the source of truth for every state shown here:
 *  • `admin_member_state()`  — one truthful snapshot per member,
 *  • `admin_list_members()`  — the server-side filtered / paged list.
 * Nothing in this file decides visibility or membership; it only labels
 * what the RPCs return and turns RPC error codes into readable notices.
 */

/* ------------------------------------------------------------------------ */
/* RPC payload shapes                                                        */
/* ------------------------------------------------------------------------ */

export type AdminMemberState = {
  user_id: string
  status: ProfileStatus
  is_public: boolean
  admin_hidden: boolean
  admin_hidden_at: string | null
  admin_hidden_reason: string | null
  suspended: boolean
  suspended_at: string | null
  suspension_reason: string | null
  status_before_suspension: ProfileStatus | null
  live_membership: boolean
  ever_subscribed: boolean
  verified: boolean
  featured: boolean
  boosted: boolean
  missing: string[]
  membership: {
    tier: string
    is_paid: boolean
    package_slug: string | null
    started_at: string | null
    expires_at: string | null
    days_left: number
    benefits?: Record<string, Json | undefined>
  }
  visibility: {
    status: string | null
    is_public: boolean
    reason: string
    missing: string[]
    headline: string
    detail: string
    cta: { label: string; href: string } | null
    expired_at?: string | null
  }
}

export type AdminMemberListRow = {
  id: string
  full_name: string
  email: string
  mobile: string | null
  is_admin: boolean
  is_active: boolean
  mobile_verified: boolean
  created_at: string
  last_login_at: string | null
  status: ProfileStatus | null
  gender: 'male' | 'female' | null
  city: string | null
  age: number | null
  verified_at: string | null
  admin_hidden_at: string | null
  suspended_at: string | null
  package_slug: string | null
  expires_at: string | null
  is_paid: boolean
  ever_subscribed: boolean
  featured: boolean
  boosted: boolean
  has_photo: boolean
}

export type AdminMemberList = {
  total: number
  limit: number
  offset: number
  rows: AdminMemberListRow[]
}

/* ------------------------------------------------------------------------ */
/* Labels                                                                    */
/* ------------------------------------------------------------------------ */

/** Human labels for the EXISTING profile_status vocabulary (no new states). */
export const PROFILE_STATUS_LABELS: Record<ProfileStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  hidden: 'Approved · free (hidden)',
  active: 'Active · paid',
  suspended: 'Suspended',
  expired: 'Expired',
  rejected: 'Rejected',
}

export const PROFILE_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Any profile status' },
  { value: 'public', label: 'Publicly visible now' },
  { value: 'active', label: PROFILE_STATUS_LABELS.active },
  { value: 'hidden', label: PROFILE_STATUS_LABELS.hidden },
  { value: 'draft', label: PROFILE_STATUS_LABELS.draft },
  { value: 'pending_review', label: PROFILE_STATUS_LABELS.pending_review },
  { value: 'rejected', label: PROFILE_STATUS_LABELS.rejected },
  { value: 'expired', label: PROFILE_STATUS_LABELS.expired },
  { value: 'suspended', label: PROFILE_STATUS_LABELS.suspended },
  { value: 'admin_hidden', label: 'On admin hold (hidden by admin)' },
]

export function statusBadgeClass(status: ProfileStatus | null | undefined): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200'
    case 'hidden':
      return 'bg-sky-50 text-sky-800 border-sky-200'
    case 'draft':
      return 'bg-stone-100 text-stone-700 border-stone-200'
    case 'pending_review':
      return 'bg-amber-50 text-amber-800 border-amber-200'
    case 'expired':
      return 'bg-orange-50 text-orange-800 border-orange-200'
    case 'suspended':
      return 'bg-brand-50 text-brand-800 border-brand-200'
    case 'rejected':
      return 'bg-rose-50 text-rose-800 border-rose-200'
    default:
      return 'bg-stone-100 text-stone-600 border-stone-200'
  }
}

export const VISIBILITY_REASON_LABELS: Record<string, string> = {
  public: 'Publicly visible',
  activating: 'Paid — not published yet',
  not_published: 'Complete draft — never published',
  profile_incomplete: 'Profile incomplete',
  membership_required: 'Approved — free member (needs a paid plan)',
  membership_expired: 'Membership expired',
  pending_review: 'Waiting for approval',
  suspended: 'Suspended by admin',
  admin_hidden: 'Hidden by admin (hold)',
  rejected: 'Sent back for changes',
  account_inactive: 'Account deactivated',
  not_signed_in: 'No account',
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                                */
/* ------------------------------------------------------------------------ */

export function fmtDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export function label(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ------------------------------------------------------------------------ */
/* Errors → notices                                                          */
/* ------------------------------------------------------------------------ */

const FRIENDLY: { test: RegExp; text: (rest: string) => string }[] = [
  { test: /^ADMIN_ONLY/, text: () => 'Only administrators can do that.' },
  { test: /^BOOST_ALREADY_ACTIVE/, text: () => 'This member already has an active boost.' },
  {
    test: /^BOOST_CONFIG_(MISSING|INVALID)/,
    text: () => 'Boost duration is not configured — set it under Admin → Boosts first.',
  },
  { test: /^PROFILE_INCOMPLETE/, text: (rest) => `Profile is incomplete — missing: ${rest || 'required details'}.` },
  { test: /^MEMBERSHIP_EXPIRED/, text: (rest) => rest || 'The membership has expired.' },
  { test: /^PAID_MEMBERSHIP_REQUIRED/, text: () => 'This member needs a paid membership for that.' },
  { test: /^COMMUNITY_(MISMATCH|INACTIVE|INVALID)/, text: (rest) => rest || 'Community selection is invalid.' },
]

/**
 * Turn an RPC / Postgres error message into a short, human notice. Codes
 * follow the repository convention `CODE: human sentence` — the sentence is
 * what admins see; unknown messages are passed through (trimmed).
 */
export function friendlyAdminError(message: string): string {
  const raw = (message || 'Something went wrong').replace(/\s+/g, ' ').trim()
  const m = /^([A-Z][A-Z0-9_]+):\s*(.*)$/.exec(raw)
  const rest = m ? m[2].trim() : ''
  for (const f of FRIENDLY) {
    if (f.test.test(raw)) return f.text(rest)
  }
  if (m && rest) return rest.charAt(0).toUpperCase() + rest.slice(1)
  if (/permission denied/i.test(raw)) return 'Permission denied — sign in as an administrator.'
  if (/duplicate key.*profiles_mobile/i.test(raw)) return 'Another member already uses that mobile number.'
  if (/profiles_full_name_len/i.test(raw)) return 'Name must be between 2 and 80 characters.'
  if (/partner_prefs_age_order/i.test(raw)) return 'Minimum age must not exceed maximum age.'
  if (/partner_prefs_height_order/i.test(raw)) return 'Minimum height must not exceed maximum height.'
  if (/invalid input value for enum ([a-z_.]+): "([^"]*)"/i.test(raw)) {
    const mm = /invalid input value for enum ([a-z_.]+): "([^"]*)"/i.exec(raw)
    return `"${mm?.[2] ?? ''}" is not a valid ${label(mm?.[1]?.replace(/^public\./, '') ?? 'value').toLowerCase()}.`
  }
  return raw.length > 300 ? `${raw.slice(0, 297)}…` : raw
}

/** Short human text for the notice codes the actions redirect with. */
export const NOTICE_TEXT: Record<string, string> = {
  suspended: 'Profile suspended. It is no longer discoverable anywhere; membership data is untouched.',
  unsuspended: 'Suspension lifted — status restored from the member’s actual membership.',
  hidden: 'Admin hold placed. The profile is hidden from Browse, Search, matches and featured; status and membership are unchanged.',
  unhidden: 'Admin hold lifted.',
  reactivated: 'Profile reactivated according to its real membership state.',
  reactivate_noop: 'Nothing to reactivate — see the visibility panel for what this member still needs.',
  approved: 'Profile approved.',
  rejected: 'Profile sent back to the member with your note.',
  edited: 'Profile changes saved.',
  edit_noop: 'No changes were made.',
  verified: 'Verified badge granted (verification only — payment and visibility are unaffected).',
  unverified: 'Verified badge removed.',
  featured: 'Profile featured on the homepage.',
  unfeatured: 'Profile removed from the homepage.',
  activated: 'Membership activated through the authoritative activation machinery.',
  boosted: 'Support boost granted for the configured duration.',
  photo_removed: 'Photo removed. The member has been notified.',
  deleted: 'Member account permanently deleted.',
}
