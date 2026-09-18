import { z } from 'zod'

export const MILESTONES = ['found_match', 'engaged', 'married'] as const
export type Milestone = (typeof MILESTONES)[number]

export const VALUED_FEATURES = [
  'genuine_profiles',
  'community_matching',
  'easy_connect',
  'helpful_details',
  'privacy_safety',
  'compatible_match',
  'family_friendly',
  'other',
] as const
export type ValuedFeature = (typeof VALUED_FEATURES)[number]

export const successStorySchema = z.object({
  couple_names: z
    .string()
    .trim()
    .min(2, 'Couple display names must be at least 2 characters')
    .max(100, 'Couple display names cannot exceed 100 characters'),
  title: z
    .string()
    .trim()
    .min(3, 'Story title must be at least 3 characters')
    .max(120, 'Story title cannot exceed 120 characters'),
  rating: z.coerce
    .number()
    .int('Rating must be an integer')
    .min(1, 'Please select a rating from 1 to 5 stars')
    .max(5, 'Rating cannot exceed 5 stars'),
  story: z
    .string()
    .trim()
    .min(100, 'Please share a little more of your journey (at least 100 characters)')
    .max(2500, 'Story text cannot exceed 2,500 characters'),
  milestone: z.enum(MILESTONES).nullable().optional(),
  wedding_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid wedding date')
    .nullable()
    .optional()
    .or(z.literal('')),
  valued_features: z.array(z.string()).default([]),
  future_members_note: z
    .string()
    .trim()
    .max(800, 'Note to future members cannot exceed 800 characters')
    .nullable()
    .optional()
    .or(z.literal('')),
  consent: z
    .boolean()
    .refine((v) => v === true, 'You must confirm consent to publish before submitting'),
})

export type SuccessStoryInput = z.infer<typeof successStorySchema>
