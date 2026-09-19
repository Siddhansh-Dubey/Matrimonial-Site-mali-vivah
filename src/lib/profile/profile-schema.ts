import { z } from 'zod'

/**
 * Shared constants + zod schema for the matrimony profile onboarding flow
 * ("Create your profile" → "Tell us what you seek").
 *
 * The option lists here mirror the search form on the home page so that
 * saved values and search filters line up exactly.
 */

export const genderOptions = ['male', 'female'] as const
export const maritalStatusOptions = ['never_married', 'divorced', 'widowed', 'awaiting_divorce'] as const
export const dietOptions = ['vegetarian', 'non_vegetarian', 'eggetarian', 'jain', 'vegan'] as const
export const lifestyleOptions = ['never', 'occasionally', 'regularly'] as const
export const familyTypeOptions = ['joint', 'nuclear'] as const

export const subCommunityOptions = ['Mali', 'Phul Mali', 'Maratha Mali', 'Lal Mali', 'Other'] as const
export const cityOptions = [
  'Mumbai',
  'Pune',
  'Nashik',
  'Nagpur',
  'Thane',
  'Aurangabad',
  'Solapur',
  'Kolhapur',
  'Other',
] as const
export const motherTongueOptions = ['Marathi', 'Hindi', 'Other'] as const
export const educationOptions = [
  'High School',
  'Diploma',
  'Bachelors',
  'Masters',
  'Doctorate',
  'Professional Degree (CA/CS/LLB/MBBS…)',
  'Other',
] as const
export const occupationOptions = [
  'Working Professional',
  'Business Owner / Self-employed',
  'Government Employee',
  'Doctor / Medical',
  'Engineer',
  'Teacher / Academic',
  'Student',
  'Homemaker',
  'Other',
] as const
export const incomeOptions = [
  'Not earning',
  'Under 3 LPA',
  '3 - 5 LPA',
  '5 - 10 LPA',
  '10 - 20 LPA',
  '20 - 40 LPA',
  '40 LPA+',
] as const

export const HOBBY_OPTIONS = [
  'Reading',
  'Music',
  'Travel',
  'Cooking',
  'Sports',
  'Movies',
  'Photography',
  'Gardening',
  'Yoga',
  'Volunteering',
] as const

const ageFromOptions = Array.from({ length: 43 }, (_, i) => 18 + i)
export const AGE_OPTIONS = ageFromOptions

export const lifestyleOptions = ['never', 'occasionally', 'regularly'] as const
export const familyTypeOptions = ['joint', 'nuclear'] as const

export const personalSchema = z.object({
  gender: z.enum(genderOptions),
  profileFor: z.enum(['self', 'son', 'daughter']),
  dateOfBirth: z.string().min(1, 'required'),
  heightCm: z.coerce.number().min(120).max(220).optional(),
  maritalStatus: z.enum(maritalStatusOptions),
  diet: z.enum(dietOptions),
  motherTongue: z.string().min(1, 'required'),
  subCommunity: z.string().min(1, 'required'),
  gotra: z.string().optional(),
  city: z.string().min(1, 'required'),
  state: z.string().min(1, 'required'),
  country: z.string().min(1).max(80).default('India'),
  nativePlace: z.string().max(80).optional(),
})

export const educationSchema = z.object({
  education: z.string().min(1, 'required'),
  educationDetails: z.string().optional(),
  occupation: z.string().min(1, 'required'),
  company: z.string().max(120).optional(),
  annualIncome: z.string().optional(),
})

export const familySchema = z.object({
  fatherOccupation: z.string().max(160).optional(),
  motherOccupation: z.string().max(160).optional(),
  siblings: z.string().max(240).optional(),
  familyType: z.enum(familyTypeOptions).optional(),
  familyLocation: z.string().max(160).optional(),
  familyDetails: z.string().max(500).optional(),
})

export const aboutSchema = z.object({
  aboutMe: z.string().max(1000).optional(),
  hobbies: z.array(z.string()).optional(),
  smoking: z.enum(lifestyleOptions).default('never'),
  drinking: z.enum(lifestyleOptions).default('never'),
})

/** The family block (PRD FAMILY section). */
export const familySchema = z.object({
  fatherOccupation: z.string().max(120).optional(),
  motherOccupation: z.string().max(120).optional(),
  siblings: z.string().max(120).optional(),
  familyType: z.enum(familyTypeOptions).default('joint'),
  familyLocation: z.string().max(120).optional(),
  familyDetails: z.string().max(500).optional(),
})

export type FamilyInput = z.infer<typeof familySchema>

export const preferencesSchema = z
  .object({
    preferredGender: z.enum(genderOptions),
    minAge: z.coerce.number().min(18).max(60),
    maxAge: z.coerce.number().min(18).max(60),
    minHeightCm: z.coerce.number().min(120).max(220).optional(),
    maxHeightCm: z.coerce.number().min(120).max(220).optional(),
    preferredCities: z.array(z.string()).optional(),
    preferredSubCommunities: z.array(z.string()).optional(),
    preferredEducation: z.string().optional(),
    preferredOccupation: z.string().optional(),
    preferredIncome: z.string().optional(),
    preferredDiet: z.enum(dietOptions).optional(),
    preferredMaritalStatus: z.enum(maritalStatusOptions).optional(),
    preferredNativePlace: z.string().max(80).optional(),
    preferredFamilyType: z.enum(familyTypeOptions).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((d) => d.minAge <= d.maxAge, {
    path: ['maxAge'],
    message: 'min-max-age',
  })
  .refine(
    (d) =>
      d.minHeightCm == null ||
      d.maxHeightCm == null ||
      d.minHeightCm <= d.maxHeightCm,
    { path: ['maxHeightCm'], message: 'min-max-height' }
  )

export type PersonalInput = z.infer<typeof personalSchema>
export type EducationInput = z.infer<typeof educationSchema>
export type FamilyInput = z.infer<typeof familySchema>
export type AboutInput = z.infer<typeof aboutSchema>
export type PreferencesInput = z.infer<typeof preferencesSchema>

/** Compute a readable age in years from a date (server-friendly). */
export function ageFromDate(dob: string | null | undefined): number | null {
  if (!dob) return null
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1
  return age
}

/** Convert a user-facing label back to its enum value (for select options). */
export function enumValue<T extends string>(value: T): T {
  return value
}
