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
import { audit, requireAdminAction, type AdminContext } from '@/lib/admin/server'
import type { Json } from '@/lib/supabase/database.types'

function str(fd: FormData, key: string): string {
  const v = fd.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type AdminClient = AdminContext['admin']

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

/** Suspend or unsuspend a member's profile (blocks discovery + contact). */
export async function setProfileSuspended(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = str(formData, 'user_id')
  const suspend = str(formData, 'suspend') === 'true'
  const { admin } = ctx
  const status = suspend ? 'suspended' : 'active'
  const { error } = await admin
    .from('matrimony_profiles')
    .update({ status })
    .eq('user_id', targetUserId)
  if (error) throw new Error(error.message)
  await audit(ctx, suspend ? 'profile_suspend' : 'profile_unsuspend', 'profile', targetUserId)
  revalidatePath('/admin/members')
  revalidatePath('/admin')
}

/** Toggle the verified badge directly (usually goes through the queue). */
export async function setProfileVerified(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = str(formData, 'user_id')
  const verify = str(formData, 'verify') === 'true'
  const { admin } = ctx
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
  revalidatePath('/admin/members')
}

/** Feature (homepage) or un-feature a profile. */
export async function setFeatured(formData: FormData) {
  const ctx = await requireAdminAction()
  const targetUserId = str(formData, 'user_id')
  const feature = str(formData, 'feature') === 'true'
  const position = Number(str(formData, 'position') || '0')
  const { admin } = ctx
  if (feature) {
    const { error } = await admin
      .from('featured_profiles')
      .upsert({ profile_id: targetUserId, position, created_by: ctx.userId })
    if (error) throw new Error(error.message)
  } else {
    await admin.from('featured_profiles').delete().eq('profile_id', targetUserId)
  }
  await audit(ctx, feature ? 'feature_profile' : 'unfeature_profile', 'profile', targetUserId, {
    position,
  })
  revalidatePath('/admin/members')
  revalidatePath('/admin/featured')
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
  if (!Number.isFinite(packageId)) throw new Error('Choose a package')
  const targetUserId = await resolveMemberId(ctx.admin, str(formData, 'user_id'))
  const { admin } = ctx
  const { data, error } = await admin.rpc('activate_membership', {
    p_user_id: targetUserId,
    p_package_id: packageId,
  })
  if (error) throw new Error(error.message)
  await audit(ctx, 'manual_activation', 'user', targetUserId, { package_id: packageId, note, result: data })
  revalidatePath('/admin/payments')
  revalidatePath('/admin/members')
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

// NOTE: the old "account deletion request queue" lived here. Members now
// delete their own account directly via the server action in
// src/app/profile/actions.ts, so admins no longer process anything — and no
// half-deleted "pending request" state can exist in between.
