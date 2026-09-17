import { redirect } from 'next/navigation'

/**
 * The contact content now lives as the second section of /about.
 * This stub keeps any old links/bookmarks pointing at /contact working.
 */
export default function ContactPage() {
  redirect('/about#contact')
}
