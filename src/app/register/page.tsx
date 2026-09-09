import type { Metadata } from 'next'
import { RegisterForm } from '@/components/auth/register-form'

export const metadata: Metadata = {
  title: 'Register',
  description: 'Create a free account on Mali Vivah — verified matrimony for the Mali Samaj.',
}

export default function RegisterPage() {
  return <RegisterForm />
}
