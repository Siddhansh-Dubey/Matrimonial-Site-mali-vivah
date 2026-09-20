import { NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { ageFromDate } from '@/lib/profile/profile-schema'

export const dynamic = 'force-dynamic'

/**
 * Biodata PDF — ONLY for:
 *  • the member themselves (self-download to share offline), or
 *  • a paid viewer with MUTUAL (accepted) interest in the member.
 * Exactly the same gate as the phone number: payment alone never unlocks it;
 * an accepted interest is always required.
 */

const MAROON = rgb(0.55, 0.06, 0.12)
const GOLD = rgb(0.79, 0.63, 0.29)
const INK = rgb(0.15, 0.12, 0.1)
const MUTE = rgb(0.42, 0.38, 0.34)
const HAIR = rgb(0.87, 0.83, 0.78)

const BUCKET = 'profile-photos'

export async function GET(_req: Request, { params }: { params: { userId: string } }) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })

  const targetId = params.userId
  const isSelf = targetId === user.id

  if (!isSelf) {
    // Same gates as get_profile_contact: paid + mutual + unblocked + target
    // currently public (so expired / suspended / hidden / deleted never leak).
    const [mutualRes, paidRes, blockedRes, publicRes] = await Promise.all([
      supabase.rpc('mutual_interest_exists', { p_a: user.id, p_b: targetId }),
      supabase.rpc('has_live_membership', { p_user_id: user.id }),
      supabase.rpc('is_blocked', { p_a: user.id, p_b: targetId }),
      supabase.rpc('is_profile_public', { p_user_id: targetId }),
    ])
    const mutual = mutualRes.data === true
    const paid = paidRes.data === true
    const blocked = blockedRes.data === true
    const isPublic = publicRes.data === true
    if (!mutual || !paid || blocked || !isPublic) {
      return NextResponse.json(
        { error: 'Biodata unlocks after a mutual, accepted interest.' },
        { status: 403 }
      )
    }
  }

  const admin = createAdminClient()
  const [profileRes, mpRes, photoRes] = await Promise.all([
    admin.from('profiles').select('full_name, mobile').eq('id', targetId).maybeSingle(),
    admin
      .from('matrimony_profiles')
      .select('*, community:communities(name), sub_community_row:sub_communities(name)')
      .eq('user_id', targetId)
      .maybeSingle(),
    admin
      .from('profile_photos')
      .select('storage_path, kind, is_primary, sort_order')
      .eq('profile_id', targetId)
      .order('is_primary', { ascending: false })
      .order('sort_order'),
  ])
  const person = profileRes.data
  const mp = mpRes.data
  if (!person || !mp) {
    return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
  }

  // Privacy toggles are honoured for other members (self-download is the
  // member's own copy). Contact for others comes from get_profile_contact,
  // never from the service-role profiles.mobile read.
  const privacy = (mp.privacy_settings ?? {}) as Record<string, unknown>
  const show = (key: string) => isSelf || privacy[key] !== false

  let phone: string | null = null
  if (isSelf) {
    phone = person.mobile
  } else {
    const { data: gatedPhone } = await supabase.rpc('get_profile_contact', { p_user_id: targetId })
    phone = (gatedPhone as string | null) ?? null
  }

  const profilePhotos = (photoRes.data ?? []).filter((p) => p.kind === 'profile_photo')
  const familyPhoto = show('show_family_photo')
    ? (photoRes.data ?? []).find((p) => p.kind === 'family_photo')
    : undefined
  const primaryPath = profilePhotos[0]?.storage_path ?? null

  // ----- build the PDF -----
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${person.full_name} — Biodata | Mali Vivah`)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const page = pdf.addPage([595, 842]) // A4
  let y = 802
  const M = 48
  const W = page.getWidth() - M * 2

  // header band
  page.drawRectangle({ x: 0, y: 780, width: 595, height: 62, color: MAROON })
  page.drawText('MALI VIVAH BIODATA', {
    x: M,
    y: 812,
    size: 18,
    font: bold,
    color: rgb(1, 1, 1),
  })
  page.drawText('Same community. Brighter tomorrows.', {
    x: M,
    y: 795,
    size: 9,
    font,
    color: GOLD,
  })

  y = 748
  const label = (l: string) => page.drawText(l, { x: M, y, size: 8, font, color: MUTE })
  const value = (v: string) => page.drawText(v, { x: M + 150, y, size: 10, font: bold, color: INK })
  const line = (l: string, v: string | null | undefined) => {
    if (!v) return
    label(l)
    value(v)
    y -= 22
  }
  const rule = () => {
    y -= 8
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1, color: HAIR })
    y -= 18
  }
  const section = (title: string, p: PDFPage, f: PDFFont) => {
    p.drawText(title.toUpperCase(), { x: M, y, size: 11, font: f, color: MAROON })
    y -= 20
  }

  // photo (right side of header block)
  let photoBottom = y
  if (primaryPath) {
    const img = await fetchImage(admin, primaryPath)
    if (img) {
      const embedded = img.kind === 'png' ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes)
      const h = 150
      const w = (embedded.width / embedded.height) * h
      page.drawImage(embedded, { x: 595 - M - w, y: y - h, width: w, height: h })
      photoBottom = y - h - 8
    }
  }

  page.drawText(person.full_name, { x: M, y, size: 20, font: bold, color: INK })
  y -= 22
  line('Age / Gender', `${ageFromDate(mp.date_of_birth) ?? '—'} years · ${titleCase(mp.gender ?? '—')}`)
  line('Height', mp.height_cm ? `${mp.height_cm} cm` : null)
  line('Marital status', titleCase(mp.marital_status))
  if (y > photoBottom) y = photoBottom
  rule()

  section('Personal', page, bold)
  line('Religion', mp.religion)
  // Community from the DB hierarchy (IDs authoritative; legacy text fallback).
  const communityName = (mp.community as { name: string } | null)?.name ?? null
  const subCommunityName = (mp.sub_community_row as { name: string } | null)?.name ?? mp.sub_community
  line('Community', [communityName, subCommunityName].filter(Boolean).join(' · ') || null)
  line('Mother tongue', mp.mother_tongue)
  line('Gotra', mp.gotra)
  line('Diet', titleCase(mp.diet))
  line('Smoking / Drinking', `${titleCase(mp.smoking)} / ${titleCase(mp.drinking)}`)
  if (mp.hobbies.length > 0) line('Hobbies', mp.hobbies.map(titleCase).join(', '))
  rule()

  section('Education & career', page, bold)
  line('Education', mp.education)
  line('Details', mp.education_details)
  line('Occupation', mp.occupation)
  line('Company', mp.company)
  // `line()` skips empty values, so a member without a business name never
  // sees an empty "Business Name:" row in the PDF.
  line('Business Name', mp.business_name)
  line('Annual income', show('show_income') ? mp.annual_income : null)
  rule()

  section('Location', page, bold)
  line('Lives in', [mp.city, mp.state, mp.country].filter(Boolean).join(', '))
  line('Native place', mp.native_place)
  rule()

  const familyDetails = show('show_family_details') ? mp.family_details : null
  const hasFamily = Boolean(
    mp.father_occupation ||
      mp.mother_occupation ||
      mp.siblings ||
      mp.family_type ||
      mp.family_location ||
      familyDetails ||
      familyPhoto
  )
  if (hasFamily) {
    section('Family', page, bold)
    line('Father', mp.father_occupation)
    line('Mother', mp.mother_occupation)
    line('Siblings', mp.siblings)
    line('Family type', mp.family_type ? titleCase(mp.family_type) : null)
    line('Family lives in', mp.family_location)
    if (familyDetails) {
      label('About the family')
      y = drawWrapped(page, familyDetails, M + 150, y, 330, bold, 10, INK)
      y -= 12
      label('')
    }
    rule()
  }

  if (show('show_about') && mp.about_me) {
    section('About', page, bold)
    y = drawWrapped(page, mp.about_me, M, y, W, font, 10, INK)
    y -= 6
    rule()
  }

  // Reaching here already means self or paid+mutual — the only cases where
  // the phone may appear (exactly the contact-unlock gate).
  if (phone) {
    line('Phone', phone)
  }

  // footer
  page.drawText(`Generated by Mali Vivah · ${new Date().toLocaleDateString('en-IN')}`, {
    x: M,
    y: 32,
    size: 8,
    font,
    color: MUTE,
  })

  if (familyPhoto) {
    const img = await fetchImage(admin, familyPhoto.storage_path)
    if (img) {
      const p2 = pdf.addPage([595, 842])
      p2.drawText('FAMILY PHOTO', { x: M, y: 800, size: 12, font: bold, color: MAROON })
      const embedded = img.kind === 'png' ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes)
      const maxW = 595 - M * 2
      const maxH = 720
      const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1)
      const w = embedded.width * scale
      const h = embedded.height * scale
      p2.drawImage(embedded, { x: (595 - w) / 2, y: 780 - h, width: w, height: h })
    }
  }

  const bytes = await pdf.save()
  const safeName = person.full_name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'member'
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="mali-vivah-biodata-${safeName}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}

function titleCase(v: string): string {
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Download raw bytes of a photo through the private bucket (service role). */
async function fetchImage(
  admin: ReturnType<typeof createAdminClient>,
  path: string
): Promise<{ bytes: ArrayBuffer; kind: 'png' | 'jpg' } | null> {
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(path)
    if (error || !data) return null
    const type = (data.type || '').toLowerCase()
    const kind: 'png' | 'jpg' = type.includes('png') || path.toLowerCase().endsWith('.png') ? 'png' : 'jpg'
    return { bytes: await data.arrayBuffer(), kind }
  } catch {
    return null
  }
}

/** Naive word-wrap: draws `text` at (x, y), returns y after the block. */
function drawWrapped(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  width: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>
): number {
  const words = text.replace(/\s+/g, ' ').split(' ')
  let line = ''
  let cy = y
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(trial, size) > width && line) {
      page.drawText(line, { x, y: cy, size, font, color })
      cy -= size + 5
      line = w
    } else {
      line = trial
    }
  }
  if (line) {
    page.drawText(line, { x, y: cy, size, font, color })
    cy -= size + 5
  }
  return cy
}
