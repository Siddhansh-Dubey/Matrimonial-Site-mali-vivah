import type { Metadata } from 'next'
import { ComingSoon } from '@/components/layout/coming-soon'

export const metadata: Metadata = { title: 'Success Stories' }

export default function SuccessStoriesPage() {
  return <ComingSoon titleKey="pages.stories.title" bodyKey="pages.stories.body" />
}
