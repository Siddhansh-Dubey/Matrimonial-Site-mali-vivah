'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasActiveSubscription } from '@/lib/profile/subscription'
import { successStorySchema } from '@/lib/success-stories/schema'
import { isSupabaseConfigured } from '@/lib/env'

export type SubmitStoryResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // 5 MB

export async function submitSuccessStoryAction(
  formData: FormData
): Promise<SubmitStoryResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Database is not configured' }
  }

  // 1. Authenticate user server-side
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, error: 'You must be signed in to submit a success story.' }
  }

  // 2. Independently verify active paid subscription server-side
  const isPaid = await hasActiveSubscription(supabase, user.id)
  if (!isPaid) {
    return {
      ok: false,
      error: 'An active paid membership is required to share a success story.',
    }
  }

  const admin = createAdminClient()

  // 3. Anti-duplicate spam check: prevent multiple pending or duplicate published submissions
  const { data: existingRows } = await admin
    .from('success_stories')
    .select('id, is_published')
    .eq('submitted_by', user.id)

  if (existingRows && existingRows.length > 0) {
    const hasPending = existingRows.some((r) => !r.is_published)
    if (hasPending) {
      return {
        ok: false,
        error: 'You already have a success story under review. Our team will review it shortly.',
      }
    }
    const hasPublished = existingRows.some((r) => r.is_published)
    if (hasPublished) {
      return {
        ok: false,
        error: 'You already have a published success story on Mali Vivah.',
      }
    }
  }

  // 4. Parse form fields
  const coupleNames = (formData.get('couple_names') as string) ?? ''
  const title = (formData.get('title') as string) ?? ''
  const ratingRaw = formData.get('rating')
  const rating = ratingRaw ? Number(ratingRaw) : NaN
  const story = (formData.get('story') as string) ?? ''
  const milestoneRaw = formData.get('milestone') as string | null
  const milestone = milestoneRaw && milestoneRaw.trim() ? milestoneRaw.trim() : null
  const weddingDateRaw = formData.get('wedding_date') as string | null
  const weddingDate = weddingDateRaw && weddingDateRaw.trim() ? weddingDateRaw.trim() : null
  const futureMembersNoteRaw = formData.get('future_members_note') as string | null
  const futureMembersNote =
    futureMembersNoteRaw && futureMembersNoteRaw.trim() ? futureMembersNoteRaw.trim() : null
  const consent = formData.get('consent') === 'true'

  let valuedFeatures: string[] = []
  const valuedFeaturesRaw = formData.get('valued_features') as string | null
  if (valuedFeaturesRaw) {
    try {
      const parsed = JSON.parse(valuedFeaturesRaw)
      if (Array.isArray(parsed)) valuedFeatures = parsed.map(String)
    } catch {
      valuedFeatures = []
    }
  }

  // 5. Schema validation
  const validation = successStorySchema.safeParse({
    couple_names: coupleNames,
    title,
    rating,
    story,
    milestone,
    wedding_date: weddingDate,
    valued_features: valuedFeatures,
    future_members_note: futureMembersNote,
    consent,
  })

  if (!validation.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of validation.error.issues) {
      const key = String(issue.path[0] || 'form')
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return {
      ok: false,
      error: 'Please correct the highlighted fields before submitting.',
      fieldErrors,
    }
  }

  // 6. Handle optional couple photo upload
  let storagePath: string | null = null
  const photoFile = formData.get('photo')

  if (photoFile && photoFile instanceof File && photoFile.size > 0) {
    if (!ALLOWED_MIME_TYPES.includes(photoFile.type)) {
      return {
        ok: false,
        error: 'Photo must be a JPEG, PNG, or WebP image.',
        fieldErrors: { photo: 'Only JPG, PNG, and WebP images are supported.' },
      }
    }
    if (photoFile.size > MAX_PHOTO_BYTES) {
      return {
        ok: false,
        error: 'Photo exceeds maximum allowed size of 5 MB.',
        fieldErrors: { photo: 'Photo must be under 5 MB.' },
      }
    }

    const rawExt = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg'
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg'
    const targetPath = `${user.id}/stories-${Date.now()}.${safeExt}`

    try {
      const arrayBuffer = await photoFile.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const { error: uploadError } = await admin.storage
        .from('profile-photos')
        .upload(targetPath, buffer, {
          contentType: photoFile.type,
          upsert: false,
        })

      if (uploadError) {
        console.error('[success-stories] upload error:', uploadError.message)
        return {
          ok: false,
          error: 'Could not upload the photo. Please try again or submit without a photo.',
        }
      }
      storagePath = targetPath
    } catch (err) {
      console.error('[success-stories] photo process error:', err)
      return {
        ok: false,
        error: 'An error occurred while uploading your photo.',
      }
    }
  }

  // 7. Insert pending submission (NEVER immediately public)
  const { error: insertError } = await admin.from('success_stories').insert({
    couple_names: validation.data.couple_names,
    title: validation.data.title,
    story: validation.data.story,
    rating: validation.data.rating,
    milestone: validation.data.milestone || null,
    wedding_date: validation.data.wedding_date || null,
    photo_path: storagePath,
    valued_features: validation.data.valued_features,
    future_members_note: validation.data.future_members_note || null,
    consent_to_publish: true,
    submitted_by: user.id,
    submitted_at: new Date().toISOString(),
    is_published: false,
    sort_order: 100,
  })

  if (insertError) {
    console.error('[success-stories] insert error:', insertError.message)
    // Clean up uploaded photo if insert failed
    if (storagePath) {
      await admin.storage.from('profile-photos').remove([storagePath]).catch(() => undefined)
    }
    return {
      ok: false,
      error: 'Could not save your story. Please try again.',
    }
  }

  // 8. Push notification to the member
  await admin
    .rpc('push_notification', {
      p_user_id: user.id,
      p_type: 'admin_message',
      p_title: 'Story submitted',
      p_message:
        'Thank you for sharing your journey with Mali Vivah! Our team is reviewing your submission.',
      p_metadata: {},
      p_link: '/success-stories/submit',
    })
    .then(
      () => undefined,
      () => undefined
    )

  // 9. Revalidate relevant pages
  revalidatePath('/admin/stories')
  revalidatePath('/success-stories')
  revalidatePath('/success-stories/submit')

  return { ok: true }
}
