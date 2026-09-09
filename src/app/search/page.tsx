import type { Metadata } from 'next'
import { ComingSoon } from '@/components/layout/coming-soon'

export const metadata: Metadata = { title: 'Search' }

export default function SearchPage({
  searchParams,
}: {
  searchParams?: { lookingFor?: string }
}) {
  const lookingFor = searchParams?.lookingFor
  const titleKey =
    lookingFor === 'bride' ? 'pages.brides.title' : lookingFor === 'groom' ? 'pages.grooms.title' : 'pages.search.title'
  return <ComingSoon titleKey={titleKey} bodyKey="pages.search.body" />
}
