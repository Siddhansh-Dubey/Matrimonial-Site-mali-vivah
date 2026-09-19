import { HeroSection } from '@/components/home/hero-section'
import { WhyChooseSection } from '@/components/home/why-choose-section'
import { HowItWorksSection } from '@/components/home/how-it-works-section'
import { SearchMatchesSection } from '@/components/home/search-matches-section'
import { FeaturedProfilesSection } from '@/components/home/featured-profiles-section'

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <WhyChooseSection />
      <HowItWorksSection />
      <SearchMatchesSection />
      <FeaturedProfilesSection />
    </>
  )
}
