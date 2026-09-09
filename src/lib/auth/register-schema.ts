import { z } from 'zod'

export const forWhomOptions = ['self', 'son', 'daughter'] as const
export type ForWhom = (typeof forWhomOptions)[number]

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'short-name').max(80, 'long-name'),
    email: z.string().trim().email(),
    mobile: z
      .string()
      .transform((value) => value.replace(/\D/g, ''))
      .pipe(z.string().regex(/^[6-9]\d{9}$/, 'invalid-mobile')),
    password: z.string().min(8, 'short-password').max(100, 'long-password').regex(/[0-9]/, 'no-digit'),
    confirm: z.string().min(1, 'confirm-required'),
    forWhom: z.enum(forWhomOptions),
    terms: z.literal(true, { errorMap: () => ({ message: 'terms-required' }) }),
  })
  .refine((data) => data.password === data.confirm, {
    path: ['confirm'],
    message: 'mismatch',
  })

export type RegisterInput = z.infer<typeof registerSchema>
