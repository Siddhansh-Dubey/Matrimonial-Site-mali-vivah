'use server'

/**
 * Privileged admin operations. Every action:
 *   1. re-verifies the caller is an admin (requireAdminAction),
 *   2. performs the write with the service-role client (RLS-bypass is ONLY
 *      here, never client-side),
 *   3. appends an admin_audit_log row.
 * Client components/users can never reach these — they are server-only.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { audit, requireAdminAction, type AdminContext } from '@/lib/admin/server'
import { VISIBILITY_REASON_LABELS, friendlyAdminError } from '@/lib/admin/members'
import {
  aboutSchema,
  educationSchema,
  familySchema,
  personalSchema,
} from '@/lib/profile/profile-schema'
import type { Json } from '@/lib/supabase/database.types'

function str(fd: FormData, key: string): string {
  const v = fd.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type AdminClient = AdminContext['admin']

// ---------------------------------------------------------------------------
// Member-management plumbing (Step 7)
// ---------------------------------------------------------------------------

/**
 * Where a member-management form wants to land afterwards. Only paths inside
 * the Members module are honoured (no open redirects); anything else means
 * "behave like before" (throw on error, plain revalidate on success).
 */
function safeReturnTo(fd: FormData): string | null {
  const v = str(fd, 'return_to')
  if (!v.startsWith('/admin/members')) return null
  if (/[\s]/.test(v) || v.startsWith('//') || v.includes('\\')) return null
  return v.split('#')[0]
}

function withNotice(path: string, key: 'ok' | 'error', value: string): string {
  const [base, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.delete('ok')
  params.delete('error')
  params.set(key, value)
  return `${base}?${params.toString()}`
}

/**
 * Runs a member-management action. With `return_to` in the form the admin is
 * sent back with a readable `?ok=` / `?error=` notice (a thrown error would
 * otherwise surface as a bare Next.js error screen — unusable on a phone).
 * Without it the historical behaviour is kept for the other admin pages that
 * reuse these actions (Featured, Payments, Boosts).
 */
async function memberAction(
  formData: FormData,
  targetUserId: string | null,
  fn: () => Promise<string>
): Promise<void> {
  const returnTo = safeReturnTo(formData)
  let notice: string
  try {
    notice = await fn()
  } catch (err) {
    if (!returnTo) throw err
    redirect(withNotice(returnTo, 'error', friendlyAdminError(err instanceof Error ? err.message : String(err))))
  }
  revalidatePath('/admin/members')
  revalidatePath('/admin')
  if (targetUserId) {
    revalidatePath(`/admin/members/${targetUserId}`)
    revalidatePath(`/admin/members/${targetUserId}/edit`)
  }
  if (returnTo) redirect(withNotice(returnTo, 'ok', notice))
}

/**
 * Activity event for admin actions implemented in TypeScript (the SQL RPCs
 * log their own). Members can read their own activity stream, so metadata
 * carries state facts only — never reasons, notes or admin ids.
 */
async function logMemberActivity(
  admin: AdminClient,
  userId: string,
  event: string,
  metadata: Record<string, Json | undefined> = {}
): Promise<void> {
  await admin
    .rpc('log_activity', { p_user_id: userId, p_event: event, p_metadata: metadata as Json })
    .then(() => undefined, () => undefined)
}

function requireUuid(value: string, what = 'member'): string {
  if (!UUID_RE.test(value)) throw new Error(`Invalid ${what}`)
  return value
}

type RpcResult = Record<string, Json | undefined>

/**
 * Resolve whatever the admin pasted from a member row to a real profile id:
 * a UUID, an email, a mobile (with or without the stored "12345 67890"
 * spacing), or the full "email · mobile" label copied straight off the
 * Members list. Throws a human-readable error instead of a raw Postgres
 * "invalid input syntax for type uuid" when nothing matches.
 */
async function resolveMemberId(admin: AdminClient, raw: string): Promise<string> {
  const value = raw.trim()
  if (!value) throw new Error('Member identifier is required')

  const candidates: { col: 'id' | 'email' | 'mobile'; val: string }[] = []
  const consider = (candidate: string) => {
    const c = candidate.trim()
    if (!c) return
    if (UUID_RE.test(c)) candidates.push({ col: 'id', val: c })
    else if (c.includes('@')) candidates.push({ col: 'email', val: c.toLowerCase() })
    const digits = c.replace(/\D/g, '')
    if (/^\d{10}$/.test(digits)) {
      candidates.push({ col: 'mobile', val: digits })
      candidates.push({ col: 'mobile', val: `${digits.slice(0, 5)} ${digits.slice(5)}` })
    }
  }

  consider(value)
  // "email · mobile · joined 12 Jun 2026" → first segment is the email.
  const firstSegment = value.split('·')[0]
  if (firstSegment && firstSegment.trim() !== value) consider(firstSegment)

  for (const cand of candidates) {
    const { data } = await admin.from('profiles').select('id').eq(cand.col, cand.val).maybeSingle()
    if (data?.id) return data.id
  }
  throw new Error(
    `No member matches "${value}". Use the email, mobile number or profile UUID shown on the Members page.`
  )
}

// ---------------------------------------------------------------------------
// Members & profiles
// ---------------------------------------------------------------------------

/**
 * Suspend / unsuspend a member's profile.
 *
 * Authoritative in the database (admin_set_profile_suspended): suspension
 * flips status to 'suspended' (RLS + is_profile_public() both drop the row
 * from search, recommendations, Daily 5, featured and interest), and
 * UNSUSPEND is state-aware — live membership → active (via the publish
 * gate), lapsed → expired, never paid → hidden (APPROVED_FREE), never
 * published → the draft/pending status it had. It never creates membership.
 */
export async function setProfileSuspended(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = requireUuid(str(formData, 'user_id'))
  const suspend = str(formData, 'suspend') === 'true'
  await memberAction(formData, targetUserId, async () => {
    const { error } = await ctx.admin.rpc('admin_set_profile_suspended', {
      p_user_id: targetUserId,
      p_suspend: suspend,
      p_admin_id: ctx.userId,
      p_reason: str(formData, 'reason') || null,
    })
    if (error) throw new Error(error.message)
    return suspend ? 'suspended' : 'unsuspended'
  })
}

/**
 * Toggle the verified badge directly (usually goes through the queue).
 * Verification is ONLY verification: it never changes membership, status or
 * visibility (verified ≠ paid ≠ public).
 */
export async function setProfileVerified(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = requireUuid(str(formData, 'user_id'))
  const verify = str(formData, 'verify') === 'true'
  const { admin } = ctx
  await memberAction(formData, targetUserId, async () => {
    const { error } = await admin
      .from('matrimony_profiles')
      .update({ verified_at: verify ? new Date().toISOString() : null })
      .eq('user_id', targetUserId)
    if (error) throw new Error(error.message)
    await admin.rpc('push_notification', {
      p_user_id: targetUserId,
      p_type: verify ? 'profile_verified' : 'admin_message',
      p_title: verify ? 'Profile verified' : 'Verification removed',
      p_message: verify
        ? 'Your verified badge is live. Thank you for helping keep Mali Vivah safe.'
        : 'An admin removed the verified badge from your profile. Reply to this message if you believe this is a mistake.',
      p_metadata: {},
      p_link: '/profile',
    }).then(() => undefined, () => undefined)
    await audit(ctx, verify ? 'verify_badge_grant' : 'verify_badge_revoke', 'profile', targetUserId)
    await logMemberActivity(admin, targetUserId, verify ? 'admin_member_verified' : 'admin_member_unverified', {
      source: 'admin_panel',
    })
    return verify ? 'verified' : 'unverified'
  })
}

/**
 * Feature (homepage) or un-feature a profile.
 * Only a profile that is publicly visible RIGHT NOW (is_profile_public) can
 * be newly featured; the featured_profiles primary key prevents duplicates
 * and get_featured_profiles() re-checks publicity on every homepage render,
 * so a later suspension / hold / expiry never leaves it publicly featured.
 * Re-saving the position of an already featured profile is always allowed.
 */
export async function setFeatured(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = requireUuid(str(formData, 'user_id'))
  const feature = str(formData, 'feature') === 'true'
  const position = Number(str(formData, 'position') || '0')
  const { admin } = ctx
  await memberAction(formData, targetUserId, async () => {
    if (feature) {
      const { data: existing } = await admin
        .from('featured_profiles')
        .select('profile_id')
        .eq('profile_id', targetUserId)
        .maybeSingle()
      if (!existing) {
        const { data: isPublic } = await admin.rpc('is_profile_public', { p_user_id: targetUserId })
        if (isPublic !== true) {
          const { data: vis } = await admin.rpc('profile_visibility_reason', { p_user_id: targetUserId })
          const reason = (vis as { reason?: string } | null)?.reason
          const why = reason ? VISIBILITY_REASON_LABELS[reason] ?? reason : null
          throw new Error(`Only publicly visible profiles can be featured${why ? ` — this one is: ${why}` : ''}.`)
        }
      }
      const { error } = await admin
        .from('featured_profiles')
        .upsert({ profile_id: targetUserId, position, created_by: ctx.userId })
      if (error) throw new Error(error.message)
      await audit(ctx, 'feature_profile', 'profile', targetUserId, { position })
      if (!existing) await logMemberActivity(admin, targetUserId, 'admin_member_featured', { position })
      return 'featured'
    }
    const { data: removed } = await admin
      .from('featured_profiles')
      .delete()
      .eq('profile_id', targetUserId)
      .select('profile_id')
    await audit(ctx, 'unfeature_profile', 'profile', targetUserId, { position })
    if ((removed ?? []).length > 0) await logMemberActivity(admin, targetUserId, 'admin_member_unfeatured')
    revalidatePath('/admin/featured')
    return 'unfeatured'
  })
}

// ---------------------------------------------------------------------------
// Verification queue
// ---------------------------------------------------------------------------

export async function decideVerification(formData: FormData) {
  const ctx = await requireAdminAction()
  const requestId = str(formData, 'request_id')
  const decision = str(formData, 'decision') as 'verified' | 'rejected'
  const note = str(formData, 'note') || null
  if (decision !== 'verified' && decision !== 'rejected') throw new Error('Bad decision')
  const { admin } = ctx
  const { data: req, error: loadErr } = await admin
    .from('verification_requests')
    .select('id, user_id, type')
    .eq('id', requestId)
    .single()
  if (loadErr || !req) throw new Error(loadErr?.message ?? 'Request not found')
  const { error } = await admin
    .from('verification_requests')
    .update({
      status: decision,
      note,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'pending')
  if (error) throw new Error(error.message)
  // The AFTER UPDATE trigger (apply_verification_decision) applies the badge,
  // notifies and audit-logs. We log the decision itself as well.
  await audit(ctx, `verification_${decision}`, 'verification_request', requestId, {
    user_id: req.user_id,
    type: req.type,
  })
  revalidatePath('/admin/verification')
}

// ---------------------------------------------------------------------------
// Packages & pricing
// ---------------------------------------------------------------------------

export async function updatePackage(formData: FormData) {
  const ctx = await requireAdminAction()
  const id = Number(str(formData, 'id'))
  const priceInr = Number(str(formData, 'price_inr'))
  const durationDays = Number(str(formData, 'duration_days'))
  const name = str(formData, 'name')
  const description = str(formData, 'description')
  const featuresRaw = str(formData, 'features')
  const benefitsRaw = str(formData, 'benefits')
  const isActive = str(formData, 'is_active') === 'true'
  const isPopular = str(formData, 'is_popular') === 'true'
  const badgeText = str(formData, 'badge_text') || null

  if (!Number.isFinite(id) || !Number.isFinite(priceInr) || priceInr <= 0) {
    throw new Error('Invalid package input')
  }
  const features = featuresRaw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  let benefits: Record<string, unknown>
  try {
    benefits = benefitsRaw ? (JSON.parse(benefitsRaw) as Record<string, unknown>) : {}
  } catch {
    throw new Error('Benefits must be valid JSON')
  }

  const { admin } = ctx
  const { error } = await admin
    .from('packages')
    .update({
      name: name || undefined,
      description: description || undefined,
      price_inr: Math.round(priceInr),
      duration_days: Number.isFinite(durationDays) && durationDays > 0 ? durationDays : undefined,
      features,
      benefits: benefits as Json,
      is_active: isActive,
      is_popular: isPopular,
      badge_text: badgeText,
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
  await audit(ctx, 'package_update', 'package', String(id), {
    price_inr: priceInr,
    duration_days: durationDays,
    is_active: isActive,
  })
  revalidatePath('/admin/packages')
  revalidatePath('/packages')
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Manually activate a member's membership for a package (recovery path and
 * test tooling). The identifier field deliberately accepts anything copied
 * from a member row — UUID, email, mobile or "email · mobile" — resolved
 * via resolveMemberId() before hitting the activation RPC.
 */
export async function manualActivate(formData: FormData) {
  const ctx = await requireAdminAction()
  const packageId = Number(str(formData, 'package_id'))
  const note = str(formData, 'note')
  if (!Number.isFinite(packageId) || packageId <= 0) throw new Error('Choose a package')
  const targetUserId = await resolveMemberId(ctx.admin, str(formData, 'user_id'))
  const { admin } = ctx
  await memberAction(formData, targetUserId, async () => {
    // The ONLY activation path — same RPC the Razorpay verify/webhook use.
    const { data, error } = await admin.rpc('activate_membership', {
      p_user_id: targetUserId,
      p_package_id: packageId,
    })
    if (error) throw new Error(error.message)
    const r = (data ?? {}) as RpcResult
    await audit(ctx, 'manual_activation', 'user', targetUserId, { package_id: packageId, note, result: data })
    await logMemberActivity(admin, targetUserId, 'admin_manual_membership_activation', {
      package_id: packageId,
      package_slug: (r.package_slug as string | undefined) ?? null,
      subscription_id: (r.subscription_id as number | undefined) ?? null,
      profile_status: (r.profile_status as string | undefined) ?? null,
    })
    revalidatePath('/admin/payments')
    return 'activated'
  })
}

/** Mark a payment refunded (revokes the subscription). */
export async function refundPayment(formData: FormData) {
  const ctx = await requireAdminAction()
  const paymentId = str(formData, 'payment_id')
  const { admin } = ctx
  const { data, error } = await admin.rpc('refund_membership', { p_payment_id: paymentId })
  if (error) throw new Error(error.message)
  await audit(ctx, 'payment_refund', 'payment', paymentId, { result: data })
  revalidatePath('/admin/payments')
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function resolveReport(formData: FormData) {
  const ctx = await requireAdminAction()
  const reportId = Number(str(formData, 'report_id'))
  const status = str(formData, 'status') as 'reviewing' | 'resolved' | 'dismissed'
  if (!['reviewing', 'resolved', 'dismissed'].includes(status)) throw new Error('Bad status')
  const { admin } = ctx
  const { error } = await admin.from('reports').update({ status }).eq('id', reportId)
  if (error) throw new Error(error.message)
  await audit(ctx, `report_${status}`, 'report', String(reportId))
  revalidatePath('/admin/reports')
}

// ---------------------------------------------------------------------------
// Moments
// ---------------------------------------------------------------------------

export async function removeMoment(formData: FormData) {
  const ctx = await requireAdminAction()
  const momentId = str(formData, 'moment_id')
  const { admin } = ctx
  const { error } = await admin.from('moments').update({ is_removed: true }).eq('id', momentId)
  if (error) throw new Error(error.message)
  // Removing the moment resolves its open reports — the queue only ever
  // shows moments that still need a decision.
  await admin
    .from('reports')
    .update({ status: 'resolved' })
    .eq('target_type', 'moment')
    .eq('target_id', momentId)
    .in('status', ['open', 'reviewing'])
  await audit(ctx, 'moment_removed', 'moment', momentId)
  revalidatePath('/admin/moments')
}

// ---------------------------------------------------------------------------
// Matching config
// ---------------------------------------------------------------------------

export async function updateMatchingConfig(formData: FormData) {
  const ctx = await requireAdminAction()
  const threshold = Number(str(formData, 'threshold'))
  const dailyCount = Number(str(formData, 'daily_count'))
  const weightsRaw = str(formData, 'weights')
  let weights: Record<string, unknown>
  try {
    weights = JSON.parse(weightsRaw) as Record<string, unknown>
  } catch {
    throw new Error('Weights must be valid JSON')
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error('Threshold must be 0–100')
  }
  const { admin } = ctx
  const { error } = await admin
    .from('matching_config')
    .update({
      threshold,
      daily_count: Number.isFinite(dailyCount) ? Math.max(1, Math.round(dailyCount)) : 5,
      weights: weights as Json,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  if (error) throw new Error(error.message)
  await audit(ctx, 'matching_config_update', 'matching_config', '1', { threshold, daily_count: dailyCount, weights })
  revalidatePath('/admin/matching')
}

// ---------------------------------------------------------------------------
// Success stories
// ---------------------------------------------------------------------------

export async function saveStory(formData: FormData) {
  const ctx = await requireAdminAction()
  const id = str(formData, 'id')
  const coupleNames = str(formData, 'couple_names')
  const title = str(formData, 'title')
  const story = str(formData, 'story')
  const photoPath = str(formData, 'photo_path') || null
  const weddingDate = str(formData, 'wedding_date') || null
  const isPublished = str(formData, 'is_published') === 'true'
  const ratingRaw = str(formData, 'rating')
  const rating = ratingRaw ? Number(ratingRaw) : null
  const milestone = str(formData, 'milestone') || null
  const futureMembersNote = str(formData, 'future_members_note') || null

  if (!coupleNames || !title || !story) throw new Error('couple_names, title and story are required')
  const { admin } = ctx
  if (id) {
    const { data: prevStory } = await admin
      .from('success_stories')
      .select('submitted_by, is_published')
      .eq('id', id)
      .maybeSingle()

    const { error } = await admin
      .from('success_stories')
      .update({
        couple_names: coupleNames,
        title,
        story,
        photo_path: photoPath,
        wedding_date: weddingDate,
        is_published: isPublished,
        rating: rating && rating >= 1 && rating <= 5 ? rating : null,
        milestone,
        future_members_note: futureMembersNote,
      })
      .eq('id', id)
    if (error) throw new Error(error.message)

    // Notify submitter if transition from unpublished to published
    if (isPublished && !prevStory?.is_published && prevStory?.submitted_by) {
      await admin
        .rpc('push_notification', {
          p_user_id: prevStory.submitted_by,
          p_type: 'admin_message',
          p_title: 'Your Success Story has been published!',
          p_message: 'Your journey is now live in Success Stories and inspiring couples across the community.',
          p_metadata: {},
          p_link: '/success-stories',
        })
        .then(() => undefined, () => undefined)
    }

    await audit(ctx, 'story_update', 'success_story', id, { is_published: isPublished })
  } else {
    const { data, error } = await admin
      .from('success_stories')
      .insert({
        couple_names: coupleNames,
        title,
        story,
        photo_path: photoPath,
        wedding_date: weddingDate,
        is_published: isPublished,
        rating: rating && rating >= 1 && rating <= 5 ? rating : null,
        milestone,
        future_members_note: futureMembersNote,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    await audit(ctx, 'story_create', 'success_story', data?.id ?? null)
  }
  revalidatePath('/admin/stories')
  revalidatePath('/success-stories')
  revalidatePath('/success-stories/submit')
}

export async function publishStory(formData: FormData) {
  const ctx = await requireAdminAction()
  const id = str(formData, 'id')
  if (!id) throw new Error('Story id is required')
  const { admin } = ctx

  const { data: story, error: fetchErr } = await admin
    .from('success_stories')
    .select('id, submitted_by, is_published')
    .eq('id', id)
    .single()
  if (fetchErr || !story) throw new Error('Story not found')

  const { error } = await admin
    .from('success_stories')
    .update({ is_published: true })
    .eq('id', id)
  if (error) throw new Error(error.message)

  if (story.submitted_by && !story.is_published) {
    await admin
      .rpc('push_notification', {
        p_user_id: story.submitted_by,
        p_type: 'admin_message',
        p_title: 'Your Success Story has been published!',
        p_message: 'Your journey is now live in Success Stories and inspiring couples across the community.',
        p_metadata: {},
        p_link: '/success-stories',
      })
      .then(() => undefined, () => undefined)
  }

  await audit(ctx, 'story_publish', 'success_story', id)
  revalidatePath('/admin/stories')
  revalidatePath('/success-stories')
  revalidatePath('/success-stories/submit')
}

export async function unpublishStory(formData: FormData) {
  const ctx = await requireAdminAction()
  const id = str(formData, 'id')
  if (!id) throw new Error('Story id is required')
  const { admin } = ctx

  const { error } = await admin
    .from('success_stories')
    .update({ is_published: false })
    .eq('id', id)
  if (error) throw new Error(error.message)

  await audit(ctx, 'story_unpublish', 'success_story', id)
  revalidatePath('/admin/stories')
  revalidatePath('/success-stories')
  revalidatePath('/success-stories/submit')
}

export async function deleteStory(formData: FormData) {
  const ctx = await requireAdminAction()
  const id = str(formData, 'id')
  const { admin } = ctx

  const { data: story } = await admin
    .from('success_stories')
    .select('submitted_by, is_published, photo_path')
    .eq('id', id)
    .maybeSingle()

  const { error } = await admin.from('success_stories').delete().eq('id', id)
  if (error) throw new Error(error.message)

  // Optionally clean up photo if uploaded
  if (story?.photo_path) {
    await admin.storage.from('profile-photos').remove([story.photo_path]).catch(() => undefined)
  }

  if (story?.submitted_by && !story.is_published) {
    await admin
      .rpc('push_notification', {
        p_user_id: story.submitted_by,
        p_type: 'admin_message',
        p_title: 'Success Story update',
        p_message: 'Your success story submission could not be approved for publication at this time.',
        p_metadata: {},
        p_link: '/success-stories',
      })
      .then(() => undefined, () => undefined)
  }

  await audit(ctx, 'story_delete', 'success_story', id)
  revalidatePath('/admin/stories')
  revalidatePath('/success-stories')
  revalidatePath('/success-stories/submit')
}

// ---------------------------------------------------------------------------
// Blocked users (PRD L)
// ---------------------------------------------------------------------------

/** Remove a block between two members (the blocker's row). */
export async function unblockPair(formData: FormData) {
  const ctx = await requireAdminAction()
  const blockerId = str(formData, 'blocker_id')
  const blockedId = str(formData, 'blocked_id')
  if (!UUID_RE.test(blockerId) || !UUID_RE.test(blockedId)) throw new Error('Invalid block record')
  const { admin } = ctx
  const { data: rows, error } = await admin
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId)
    .select('id')
  if (error) throw new Error(error.message)
  await audit(ctx, 'block_removed', 'block', blockedId, { blocker_id: blockerId, removed: (rows ?? []).length })
  revalidatePath('/admin/blocks')
}

// ---------------------------------------------------------------------------
// Content management (PRD M)
// ---------------------------------------------------------------------------

const CONTENT_KEYS = [
  'home_register_cta',
  'about_intro',
  'about_cta',
  'contact_intro',
  'whatsapp_community',
] as const

export async function saveContentBlock(formData: FormData) {
  const ctx = await requireAdminAction()
  const key = str(formData, 'key')
  const title = str(formData, 'title')
  const body = str(formData, 'body')
  const isActive = str(formData, 'is_active') === 'true'
  if (!CONTENT_KEYS.includes(key as (typeof CONTENT_KEYS)[number])) {
    throw new Error('Unknown content block')
  }
  if (body.trim().length === 0) throw new Error('Body is required')
  const { admin } = ctx
  const { error } = await admin
    .from('site_content')
    .upsert(
      { key, title, body: body.trim(), is_active: isActive, updated_by: ctx.userId },
      { onConflict: 'key' }
    )
  if (error) throw new Error(error.message)
  await audit(ctx, 'content_update', 'site_content', key, { is_active: isActive, title })
  revalidatePath('/admin/content')
  revalidatePath('/about')
  revalidatePath('/')
}

// ---------------------------------------------------------------------------
// WhatsApp configuration (PRD N)
// ---------------------------------------------------------------------------

export async function updateWhatsAppConfig(formData: FormData) {
  const ctx = await requireAdminAction()
  const communityLink = str(formData, 'community_link') || null
  const supportLink = str(formData, 'support_link') || null
  const supportNumber = str(formData, 'support_number').replace(/\D/g, '') || null
  const isActive = str(formData, 'is_active') === 'true'
  if (communityLink && !/^https:\/\/(chat\.whatsapp\.com|wa\.me)\/.+/.test(communityLink)) {
    throw new Error('Community link must start with https://chat.whatsapp.com/ or https://wa.me/')
  }
  if (supportLink && !/^https:\/\/wa\.me\/\d+/.test(supportLink)) {
    throw new Error('Support link must start with https://wa.me/<number>')
  }
  if (supportNumber && !/^\d{10,15}$/.test(supportNumber)) {
    throw new Error('Support number must be 10-15 digits (country code included)')
  }
  const { admin } = ctx
  const { error } = await admin
    .from('whatsapp_config')
    .update({
      community_link: communityLink,
      support_link: supportLink,
      support_number: supportNumber,
      is_active: isActive,
      updated_by: ctx.userId,
    })
    .eq('id', 1)
  if (error) throw new Error(error.message)
  await audit(ctx, 'whatsapp_config_update', 'whatsapp_config', '1', {
    community_link: communityLink,
    support_link: supportLink,
    support_number: supportNumber,
    is_active: isActive,
  })
  revalidatePath('/admin/whatsapp')
  revalidatePath('/about')
  revalidatePath('/')
}

// ---------------------------------------------------------------------------
// Boost configuration (PRD K)
// ---------------------------------------------------------------------------

export async function updateBoostConfig(formData: FormData) {
  const ctx = await requireAdminAction()
  const priceInr = Number(str(formData, 'price_inr'))
  const durationDays = Number(str(formData, 'duration_days'))
  const isActive = str(formData, 'is_active') === 'true'
  if (!Number.isFinite(priceInr) || priceInr < 0) throw new Error('Invalid price')
  if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 30) {
    throw new Error('Duration must be 1-30 days')
  }
  const { admin } = ctx
  // Upsert (single row, id = 1) so a missing configuration row — which makes
  // every boost path refuse to activate — can be recovered from this form.
  const { error } = await admin
    .from('profile_boost_config')
    .upsert({
      id: 1,
      price_inr: Math.round(priceInr),
      duration_days: Math.round(durationDays),
      is_active: isActive,
      updated_by: ctx.userId,
    })
  if (error) throw new Error(error.message)
  await audit(ctx, 'boost_config_update', 'profile_boost_config', '1', {
    price_inr: priceInr,
    duration_days: durationDays,
    is_active: isActive,
  })
  revalidatePath('/admin/boosts')
}

// ---------------------------------------------------------------------------
// Family photo moderation (PRD F / Z)
// ---------------------------------------------------------------------------

/**
 * Admin removes a member's family photo (DB row + storage object). The
 * profile automatically falls out of the public directory on the very next
 * read — is_profile_public() re-evaluates live and requires a family photo,
 * so no separate "re-evaluate" step is needed. The member is notified.
 */
export async function removeFamilyPhoto(formData: FormData) {
  const ctx = await requireAdminAction()
  const userId = str(formData, 'user_id')
  if (!UUID_RE.test(userId)) throw new Error('Invalid member')
  const { admin } = ctx
  const { data: photo } = await admin
    .from('profile_photos')
    .select('id, storage_path')
    .eq('profile_id', userId)
    .eq('kind', 'family_photo')
    .maybeSingle()
  if (!photo) throw new Error('This member has no family photo')

  const { error } = await admin.from('profile_photos').delete().eq('id', photo.id)
  if (error) throw new Error(error.message)
  await admin.storage.from('profile-photos').remove([photo.storage_path]).catch(() => undefined)

  await admin
    .rpc('push_notification', {
      p_user_id: userId,
      p_type: 'admin_message',
      p_title: 'Family photo removed',
      p_message:
        'Our review team removed the family photo from your profile. It may now be hidden from other members until a new family photo is added. If you believe this is a mistake, contact support.',
      p_metadata: {},
      p_link: '/profile/edit',
    })
    .then(() => undefined, () => undefined)

  await audit(ctx, 'family_photo_removed', 'profile', userId, { photo_id: photo.id })
  revalidatePath('/admin/members')
}

// ---------------------------------------------------------------------------
// Member lifecycle (PRD Y / Step 7) — hide / reactivate / approve / reject /
// edit / photos / boost / delete
// ---------------------------------------------------------------------------

/**
 * Admin HOLD on / off (admin_set_profile_hidden). Distinct from suspension,
 * expiry, the member's privacy settings and drafts: the profile's status,
 * membership, subscriptions and payments stay exactly as they are — only
 * is_profile_public() turns false until the hold is lifted.
 */
export async function setProfileHidden(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = requireUuid(str(formData, 'user_id'))
  const hide = str(formData, 'hide') === 'true'
  await memberAction(formData, targetUserId, async () => {
    const { error } = await ctx.admin.rpc('admin_set_profile_hidden', {
      p_user_id: targetUserId,
      p_hide: hide,
      p_admin_id: ctx.userId,
      p_reason: str(formData, 'reason') || null,
    })
    if (error) throw new Error(error.message)
    return hide ? 'hidden' : 'unhidden'
  })
}

/**
 * State-aware Reactivate (admin_reactivate_profile): lifts a hold and/or a
 * suspension and restores the status the member's REAL membership implies.
 * Expired stays expired without a renewal, drafts stay drafts — it never
 * creates a subscription or bypasses the publish gate.
 */
export async function reactivateMember(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = requireUuid(str(formData, 'user_id'))
  await memberAction(formData, targetUserId, async () => {
    const { data, error } = await ctx.admin.rpc('admin_reactivate_profile', {
      p_user_id: targetUserId,
      p_admin_id: ctx.userId,
    })
    if (error) throw new Error(error.message)
    const r = (data ?? {}) as RpcResult
    if (r.changed !== true) {
      const note = typeof r.note === 'string' ? friendlyAdminError(r.note) : ''
      throw new Error(note || 'Nothing to reactivate — see the visibility panel for what this member still needs.')
    }
    return 'reactivated'
  })
}

/** Approve within the existing status model (admin_approve_profile). */
export async function approveMemberProfile(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = requireUuid(str(formData, 'user_id'))
  await memberAction(formData, targetUserId, async () => {
    const { error } = await ctx.admin.rpc('admin_approve_profile', {
      p_user_id: targetUserId,
      p_admin_id: ctx.userId,
    })
    if (error) throw new Error(error.message)
    return 'approved'
  })
}

/** Send a profile back for changes (admin_reject_profile) — note is member-facing. */
export async function rejectMemberProfile(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = requireUuid(str(formData, 'user_id'))
  await memberAction(formData, targetUserId, async () => {
    const { error } = await ctx.admin.rpc('admin_reject_profile', {
      p_user_id: targetUserId,
      p_admin_id: ctx.userId,
      p_note: str(formData, 'note') || null,
    })
    if (error) throw new Error(error.message)
    return 'rejected'
  })
}

/* --------------------------- profile editing ---------------------------- */

const OPTIONAL_TEXT_FIELDS = [
  'mother_tongue',
  'gotra',
  'city',
  'state',
  'country',
  'native_place',
  'education',
  'education_details',
  'occupation',
  'company',
  'business_name',
  'annual_income',
  'about_me',
  'father_occupation',
  'mother_occupation',
  'siblings',
  'family_location',
  'family_details',
] as const

const ENUM_FIELDS = ['profile_for', 'gender', 'marital_status', 'diet', 'smoking', 'drinking', 'family_type'] as const

const PREF_TEXT_FIELDS = [
  'preferred_education',
  'preferred_occupation',
  'preferred_income',
  'preferred_native_place',
  'note',
] as const
const PREF_ENUM_FIELDS = ['preferred_gender', 'preferred_diet', 'preferred_marital_status', 'preferred_family_type'] as const
const PREF_NUMBER_FIELDS = ['min_age', 'max_age', 'min_height_cm', 'max_height_cm'] as const
const PREF_LIST_FIELDS = ['preferred_cities', 'preferred_sub_communities'] as const

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((v) => v.trim())
        .filter(Boolean)
    )
  ).slice(0, 25)
}

function firstIssue(issues: { path: (string | number)[]; message: string }[]): string {
  const i = issues[0]
  const field = String(i?.path?.[0] ?? 'value')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
  const msg = i?.message ?? 'invalid'
  return `${field}: ${msg === 'required' ? 'is required' : msg}`
}

/**
 * Admin edit of a member's profile + partner preferences.
 *
 * The form carries the same fields the member wizard writes (community
 * hierarchy, business_name separate from company, lifestyle enums, family
 * block, preferences). Only fields that actually CHANGED are sent to
 * admin_update_member_profile(), which enforces the column allow-list and
 * lets the existing triggers validate the community hierarchy. Status,
 * verification, privacy settings and identity fields are deliberately not
 * part of this form — they have their own actions.
 */
export async function updateMemberProfile(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = requireUuid(str(formData, 'user_id'))
  const { admin } = ctx
  await memberAction(formData, targetUserId, async () => {
    const [{ data: person }, { data: current }, { data: prefs }] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', targetUserId).maybeSingle(),
      admin.from('matrimony_profiles').select('*').eq('user_id', targetUserId).maybeSingle(),
      admin.from('partner_preferences').select('*').eq('profile_id', targetUserId).maybeSingle(),
    ])
    if (!person || !current) throw new Error('Member not found')
    const cur = current as unknown as Record<string, unknown>
    const pp = (prefs ?? {}) as unknown as Record<string, unknown>

    const profilePatch: Record<string, Json> = {}
    const prefPatch: Record<string, Json> = {}
    const setIf = (target: Record<string, Json>, key: string, next: Json, prev: unknown) => {
      if (!sameJson(next, prev)) target[key] = next
    }

    // --- account display name
    const fullName = str(formData, 'full_name')
    if (fullName && fullName !== person.full_name) {
      if (fullName.length < 2 || fullName.length > 80) throw new Error('Name must be between 2 and 80 characters')
      profilePatch.full_name = fullName
    }

    // --- shared limits with the member wizard (zod schemas are the source)
    const personal = personalSchema
      .pick({ heightCm: true, gotra: true, country: true, nativePlace: true })
      .partial()
      .safeParse({
        heightCm: str(formData, 'height_cm') || undefined,
        gotra: str(formData, 'gotra') || undefined,
        country: str(formData, 'country') || undefined,
        nativePlace: str(formData, 'native_place') || undefined,
      })
    if (!personal.success) throw new Error(firstIssue(personal.error.issues))
    const education = educationSchema
      .pick({ company: true, businessName: true })
      .partial()
      .safeParse({
        company: str(formData, 'company') || undefined,
        businessName: str(formData, 'business_name') || undefined,
      })
    if (!education.success) throw new Error(firstIssue(education.error.issues))
    const about = aboutSchema.pick({ aboutMe: true }).partial().safeParse({ aboutMe: str(formData, 'about_me') || undefined })
    if (!about.success) throw new Error(firstIssue(about.error.issues))
    const family = familySchema
      .pick({ fatherOccupation: true, motherOccupation: true, siblings: true, familyLocation: true, familyDetails: true })
      .partial()
      .safeParse({
        fatherOccupation: str(formData, 'father_occupation') || undefined,
        motherOccupation: str(formData, 'mother_occupation') || undefined,
        siblings: str(formData, 'siblings') || undefined,
        familyLocation: str(formData, 'family_location') || undefined,
        familyDetails: str(formData, 'family_details') || undefined,
      })
    if (!family.success) throw new Error(firstIssue(family.error.issues))

    // --- plain text columns ('' → null)
    for (const key of OPTIONAL_TEXT_FIELDS) {
      if (!formData.has(key)) continue
      setIf(profilePatch, key, str(formData, key) || null, cur[key] ?? null)
    }
    // --- enums (validated by the database enum types)
    for (const key of ENUM_FIELDS) {
      if (!formData.has(key)) continue
      const v = str(formData, key)
      if (!v) continue
      setIf(profilePatch, key, v, cur[key] ?? null)
    }
    // --- date of birth / height
    if (formData.has('date_of_birth')) {
      const dob = str(formData, 'date_of_birth')
      if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new Error('Date of birth must be YYYY-MM-DD')
      setIf(profilePatch, 'date_of_birth', dob || null, cur.date_of_birth ? String(cur.date_of_birth).slice(0, 10) : null)
    }
    if (formData.has('height_cm')) {
      const h = str(formData, 'height_cm')
      setIf(profilePatch, 'height_cm', h ? Number(h) : null, cur.height_cm ?? null)
    }
    // --- hobbies (checkbox group; an explicit marker distinguishes "none" from "not on form")
    if (formData.has('hobbies_present')) {
      const hobbies = formData
        .getAll('hobbies')
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 20)
      setIf(profilePatch, 'hobbies', hobbies, cur.hobbies ?? [])
    }
    // --- community hierarchy: the sub-community row is authoritative; the
    //     community id is derived from it so the pair is always consistent.
    // (a disabled selector is not submitted; an untouched selector — same
    //  value as when the form was rendered — is skipped so a legacy link that
    //  could not be resolved to an active row is never cleared by accident)
    if (formData.has('sub_community_id') && str(formData, 'sub_community_id') !== str(formData, 'sub_community_initial')) {
      const subId = str(formData, 'sub_community_id')
      if (subId) {
        requireUuid(subId, 'sub-community')
        const { data: sub } = await admin
          .from('sub_communities')
          .select('id, community_id')
          .eq('id', subId)
          .maybeSingle()
        if (!sub) throw new Error('COMMUNITY_INVALID: that sub-community does not exist')
        setIf(profilePatch, 'sub_community_id', sub.id, cur.sub_community_id ?? null)
        setIf(profilePatch, 'community_id', sub.community_id, cur.community_id ?? null)
      } else {
        setIf(profilePatch, 'sub_community_id', null, cur.sub_community_id ?? null)
        setIf(profilePatch, 'community_id', null, cur.community_id ?? null)
      }
    }

    // --- partner preferences
    for (const key of PREF_TEXT_FIELDS) {
      if (!formData.has(key)) continue
      const v = str(formData, key)
      if (v.length > (key === 'note' ? 500 : 120)) throw new Error(`${key.replace(/_/g, ' ')} is too long`)
      setIf(prefPatch, key, v || null, pp[key] ?? null)
    }
    for (const key of PREF_ENUM_FIELDS) {
      if (!formData.has(key)) continue
      const v = str(formData, key)
      if (key === 'preferred_gender' && !v) continue
      setIf(prefPatch, key, v || null, pp[key] ?? null)
    }
    for (const key of PREF_NUMBER_FIELDS) {
      if (!formData.has(key)) continue
      const v = str(formData, key)
      const n = v ? Number(v) : null
      if (n !== null && !Number.isFinite(n)) throw new Error(`${key.replace(/_/g, ' ')} must be a number`)
      if (n !== null && key.endsWith('_age') && (n < 18 || n > 60)) throw new Error('Age must be between 18 and 60')
      if (n !== null && key.endsWith('_height_cm') && (n < 120 || n > 220)) throw new Error('Height must be 120–220 cm')
      if (n === null && key.endsWith('_age')) continue
      setIf(prefPatch, key, n, pp[key] ?? null)
    }
    for (const key of PREF_LIST_FIELDS) {
      if (!formData.has(key)) continue
      setIf(prefPatch, key, splitList(str(formData, key)), pp[key] ?? [])
    }

    if (Object.keys(profilePatch).length === 0 && Object.keys(prefPatch).length === 0) return 'edit_noop'

    const { data, error } = await admin.rpc('admin_update_member_profile', {
      p_user_id: targetUserId,
      p_admin_id: ctx.userId,
      p_profile: profilePatch,
      p_prefs: prefPatch,
    })
    if (error) throw new Error(error.message)
    const r = (data ?? {}) as RpcResult
    return r.changed === false ? 'edit_noop' : 'edited'
  })
}

/**
 * Admin removes ONE photo (profile or family) — DB row + storage object.
 * Publicity re-evaluates live: is_profile_public() needs both a profile
 * photo and a family photo, so the profile may leave the directory until the
 * member uploads a replacement. The member is notified.
 */
export async function adminRemovePhoto(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = requireUuid(str(formData, 'user_id'))
  const photoId = Number(str(formData, 'photo_id'))
  if (!Number.isFinite(photoId)) throw new Error('Invalid photo')
  const { admin } = ctx
  await memberAction(formData, targetUserId, async () => {
    const { data: photo } = await admin
      .from('profile_photos')
      .select('id, storage_path, kind, is_primary')
      .eq('id', photoId)
      .eq('profile_id', targetUserId)
      .maybeSingle()
    if (!photo) throw new Error('Photo not found for this member')

    const { error } = await admin.from('profile_photos').delete().eq('id', photo.id)
    if (error) throw new Error(error.message)
    await admin.storage.from('profile-photos').remove([photo.storage_path]).catch(() => undefined)

    const family = photo.kind === 'family_photo'
    await admin
      .rpc('push_notification', {
        p_user_id: targetUserId,
        p_type: 'admin_message',
        p_title: family ? 'Family photo removed' : 'Profile photo removed',
        p_message: family
          ? 'Our review team removed the family photo from your profile. It may now be hidden from other members until a new family photo is added. If you believe this is a mistake, contact support.'
          : 'Our review team removed a photo from your profile. Please upload a clear, recent photo of yourself. If you believe this is a mistake, contact support.',
        p_metadata: {},
        p_link: '/profile/edit',
      })
      .then(() => undefined, () => undefined)

    await audit(ctx, family ? 'family_photo_removed' : 'profile_photo_removed', 'profile', targetUserId, {
      photo_id: photo.id,
      kind: photo.kind,
    })
    await logMemberActivity(admin, targetUserId, 'admin_member_photo_removed', { kind: photo.kind })
    return 'photo_removed'
  })
}

/**
 * Grant a support boost directly (recovery/support tooling).
 *
 * Everything happens in admin_grant_boost() (service-role RPC): it reads the
 * configured duration from profile_boost_config.duration_days, opens an
 * admin-origin entitlement (no payment attached, never counted against the
 * member's package quota), notifies the member with the real duration and
 * writes the activity event. It refuses while a boost is already live.
 */
export async function adminGrantBoost(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = await resolveMemberId(ctx.admin, str(formData, 'user_id'))
  const { admin } = ctx
  await memberAction(formData, targetUserId, async () => {
    const { data, error } = await admin.rpc('admin_grant_boost', {
      p_user_id: targetUserId,
      p_granted_by: ctx.userId,
    })
    if (error) {
      if (error.message.includes('BOOST_ALREADY_ACTIVE')) {
        throw new Error('This member already has an active boost')
      }
      if (error.message.includes('BOOST_CONFIG_MISSING') || error.message.includes('BOOST_CONFIG_INVALID')) {
        throw new Error('Boost duration is not configured — set it under Admin → Boosts first')
      }
      throw new Error(error.message)
    }

    const result = (data ?? {}) as {
      boost_id?: number
      entitlement_id?: number
      duration_days?: number
      expires_at?: string
    }
    await audit(ctx, 'boost_granted', 'profile', targetUserId, {
      boost_id: result.boost_id ?? null,
      entitlement_id: result.entitlement_id ?? null,
      duration_days: result.duration_days ?? null,
      expires_at: result.expires_at ?? null,
      source: 'admin',
    })
    revalidatePath('/admin/boosts')
    return 'boosted'
  })
}

/**
 * Admin deletes a member's account entirely — deliberately, server-side only:
 *   1. admin_prepare_member_deletion() enforces the guards (never your own
 *      account, never another admin, the member's exact email must be typed
 *      as confirmation) and records the audit row + activity events while
 *      the user id still resolves;
 *   2. storage is wiped with the SAME helper the member self-delete uses;
 *   3. the auth user is deleted — every table cascades from the profile id
 *      (subscriptions, payments, interests, messages, photos, moments,
 *      notifications, boosts, verification…); audit / activity references
 *      are SET NULL so the record of the deletion survives.
 */
export async function adminDeleteMember(formData: FormData) {
  const ctx = await requireAdminAction()
  const raw = str(formData, 'user_id')
  const targetUserId = UUID_RE.test(raw) ? raw : await resolveMemberId(ctx.admin, raw)
  const { admin } = ctx
  const returnTo = safeReturnTo(formData)
  const listPath = '/admin/members'

  let ok = false
  try {
    if (targetUserId === ctx.userId) throw new Error('ADMIN_SELF_DELETE: you cannot delete your own admin account')
    if (str(formData, 'confirm_phrase').toUpperCase() !== 'DELETE') {
      throw new Error('DELETE_CONFIRMATION_MISMATCH: type DELETE and the member’s email to confirm')
    }

    const { error: prepError } = await admin.rpc('admin_prepare_member_deletion', {
      p_user_id: targetUserId,
      p_admin_id: ctx.userId,
      p_confirm_email: str(formData, 'confirm_email'),
      p_reason: str(formData, 'reason') || null,
    })
    if (prepError) throw new Error(prepError.message)

    // Wipe storage first (best effort), then delete the auth user — every DB
    // row cascades from the profile id. Same logic as member self-delete.
    const { wipeMemberFiles } = await import('@/app/profile/actions')
    await wipeMemberFiles(admin, targetUserId)

    const { error: delError } = await admin.auth.admin.deleteUser(targetUserId)
    if (delError && !/not\s*found/i.test(delError.message)) {
      await audit(ctx, 'admin_member_delete_failed', 'profile', targetUserId, { error: delError.message })
      throw new Error(`Deletion failed after the audit record was written: ${delError.message}`)
    }
    ok = true
  } catch (err) {
    if (!returnTo) throw err
    redirect(withNotice(returnTo, 'error', friendlyAdminError(err instanceof Error ? err.message : String(err))))
  }

  revalidatePath('/admin/members')
  revalidatePath('/admin')
  if (ok) redirect(withNotice(listPath, 'ok', 'deleted'))
}
