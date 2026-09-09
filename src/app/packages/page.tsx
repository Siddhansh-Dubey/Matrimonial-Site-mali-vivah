import type { Metadata } from 'next'
import { ComingSoon } from '@/components/layout/coming-soon'

export const metadata: Metadata = { title: 'Packages' }

export default function PackagesPage() {
  return <ComingSoon titleKey="pages.packages.title" bodyKey="pages.packages.body" />
}
