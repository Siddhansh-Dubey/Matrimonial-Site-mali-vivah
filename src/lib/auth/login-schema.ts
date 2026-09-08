import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().trim().email(),
  mobile: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .pipe(
      z
        .string()
        .regex(/^[6-9]\d{9}$/, 'invalid-mobile')
    ),
  password: z.string().min(1),
})

export type LoginInput = z.infer<typeof loginSchema>

export function lastTenDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10)
}
