import type { Metadata } from 'next'
import { CheckCircle2 } from 'lucide-react'
import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = {
  title: 'Login',
  description: 'Sign in to Mali Vivah using your email ID, mobile number and password.',
}

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { deleted?: string }
}) {
  return (
    <>
      {searchParams?.deleted === '1' && (
        <div className="border-b border-emerald-200 bg-emerald-50">
          <p className="container-page flex items-center justify-center gap-2.5 py-3.5 text-center text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            Your account and everything stored with it have been permanently deleted. Take care.
          </p>
        </div>
      )}
      <LoginForm />
    </>
  )
}
