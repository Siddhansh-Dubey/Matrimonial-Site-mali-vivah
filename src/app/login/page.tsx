import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = {
  title: 'Login',
  description: 'Sign in to Mali Vivah using your email ID, mobile number and password.',
}

export default function LoginPage() {
  return <LoginForm />
}
