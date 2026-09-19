import { HeroSection } from '@/components/home/hero-section'
import { WhyChooseSection } from '@/components/home/why-choose-section'
import { HowItWorksSection } from '@/components/home/how-it-works-section'
import { SearchMatchesSection } from '@/components/home/search-matches-section'
import { FeaturedProfilesSection } from '@/components/home/featured-profiles-section'
import { HowItWorksSection } from '@/components/home/how-it-works-section'
import { SuccessStoriesSection } from '@/components/home/success-stories-section'
import {
  RegisterCtaSection,
  WhatsAppCommunitySection,
} from '@/components/home/whatsapp-register-sections'

/**
 * Homepage (PRD AF):
 *   Hero (community message + trust sub-line)
 *   → Why choose Mali Vivah
 *   → How it works (4 honest steps)
 *   → Basic search band (bride/groom, age, location)
 *   → Featured profiles (DB, admin-curated)
 *   → Success stories (DB, honest empty state — no fabricated claims)
 *   → WhatsApp community CTA (admin-configured, safe fallback)
 *   → Register CTA (free entry + packages)
 */
export default function HomePage() {
  return (
    <>
      <HeroSection />
      <WhyChooseSection />
      <HowItWorksSection />
      <SearchMatchesSection />
      <FeaturedProfilesSection />
      <SuccessStoriesSection />
      <WhatsAppCommunitySection />
      <RegisterCtaSection />
    </>
  )
}
