import { HeroSection } from '@/components/home/hero-section'
import { WhyChooseSection } from '@/components/home/why-choose-section'
import { SearchMatchesSection } from '@/components/home/search-matches-section'
import { FeaturedProfilesSection } from '@/components/home/featured-profiles-section'
import { BrideProfileForm } from '@/components/forms/bride-profile-form'
import { CompatibilityScore } from '@/components/matching/compatibility-score'
import { ContactSharingCard } from '@/components/contact/contact-sharing'

export default function BridesPage() {
  return (
    <section className="relative overflow-bg">
      <HeroSection />
      <WhyChooseSection />
      <SearchMatchesSection />
      <FeaturedProfilesSection />
      <BrideProfileForm />
      <CompatibilityScore
        brideParams={{ age: 26, educationLevel: 15, subCommunity: 1, occupation: 'Working Professional' }}
        groomParams={{ age: 28, educationLevel: 14, subCommunity: 1, occupation: 'Business Owner' }}
      />
      <ContactSharingCard
        groomName="R***** J*****"
        brideName="A***** K*****"
        onShareClick={() => alert('Contact sharing initiated')}
      />
    </section>
  )
}