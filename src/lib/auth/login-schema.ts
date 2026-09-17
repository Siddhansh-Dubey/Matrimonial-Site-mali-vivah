import { z } from 'zod'

/**
 * Sign-in identity: the member may use EITHER their registered email ID OR
 * their mobile number — each field is optional only in relation to the other
 * (at least one must be present). The password is always required.
 * When BOTH are provided, the form additionally keeps the second-factor
 * check that the mobile matches the one stored on the account.
 */
export const loginSchema = z
  .object({
    email: z.string().trim(),
    mobile: z
      .string()
      .transform((value) => value.replace(/\D/g, '')),
    password: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    const hasEmail = data.email.length > 0
    const hasMobile = data.mobile.length > 0
    if (!hasEmail && !hasMobile) {
      ctx.addIssue({ code: 'custom', message: 'identifier-required', path: ['email'] })
      return
    }
    if (hasEmail && !z.string().email().safeParse(data.email).success) {
      ctx.addIssue({ code: 'custom', message: 'invalid-email', path: ['email'] })
    }
    if (hasMobile && !/^[6-9]\d{9}$/.test(data.mobile)) {
      ctx.addIssue({ code: 'custom', message: 'invalid-mobile', path: ['mobile'] })
    }
  })

export type LoginInput = z.infer<typeof loginSchema>

export function lastTenDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10)
}
