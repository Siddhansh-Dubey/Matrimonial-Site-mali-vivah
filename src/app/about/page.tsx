import type { Metadata } from 'next'
import { ComingSoon } from '@/components/layout/coming-soon'

export const metadata: Metadata = { title: 'About Us' }

export default function AboutPage() {
  return <ComingSoon titleKey="pages.about.title" bodyKey="pages.about.body" />
}
