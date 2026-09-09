import type { Metadata } from 'next'
import { ComingSoon } from '@/components/layout/coming-soon'

export const metadata: Metadata = { title: 'Contact Us' }

export default function ContactPage() {
  return <ComingSoon titleKey="pages.contact.title" bodyKey="pages.contact.body" />
}
