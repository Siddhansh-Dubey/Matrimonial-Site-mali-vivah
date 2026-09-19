import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  BadgeCheck,
  Banknote,
  BarChart3,
  FileText,
  FileWarning,
  Gauge,
  Heart,
  Images,
  LayoutDashboard,
  MessageCircle,
  Rocket,
  Settings2,
  ShieldBan,
  Star,
  Users,
} from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'

export const dynamic = 'force-dynamic'

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/members', label: 'Members', icon: Users },
  { href: '/admin/verification', label: 'Verification', icon: BadgeCheck },
  { href: '/admin/packages', label: 'Packages', icon: Star },
  { href: '/admin/payments', label: 'Payments', icon: Banknote },
  { href: '/admin/reports', label: 'Reports', icon: FileWarning },
  { href: '/admin/blocks', label: 'Blocked', icon: ShieldBan },
  { href: '/admin/boosts', label: 'Boosts', icon: Rocket },
  { href: '/admin/moments', label: 'Moments', icon: Images },
  { href: '/admin/featured', label: 'Featured', icon: Heart },
  { href: '/admin/stories', label: 'Stories', icon: Heart },
  { href: '/admin/matching', label: 'Matching', icon: Settings2 },
  { href: '/admin/content', label: 'Content', icon: FileText },
  { href: '/admin/whatsapp', label: 'WhatsApp', icon: MessageCircle },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAdminPage()
  } catch {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="border-b border-stone-200 bg-maroon-deep text-white">
        <div className="container-page flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <Gauge className="h-6 w-6 text-gold-300" aria-hidden />
            <div>
              <p className="font-display text-lg font-bold">Mali Vivah Admin</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-gold-300/80">
                Restricted · audited
              </p>
            </div>
          </div>
          <Link href="/profile" className="text-xs font-semibold text-white/80 hover:text-white">
            ← Member view
          </Link>
        </div>
      </div>

      <div className="container-page grid gap-8 py-8 lg:grid-cols-[220px_1fr]">
        <nav className="leaders flex flex-wrap gap-1.5 lg:flex-col" aria-label="Admin">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-maroon-deep hover:text-white"
            >
              <n.icon className="h-4 w-4" aria-hidden />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
