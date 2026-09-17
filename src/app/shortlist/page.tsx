import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Shortlist' }

/**
 * The PRD removed the Shortlist concept — interests are the single way to
 * save and progress a connection. Existing shortlists data stays in the
 * database untouched; the route simply forwards to Interests forever.
 */
export default function ShortlistPage() {
  redirect('/interests')
}
