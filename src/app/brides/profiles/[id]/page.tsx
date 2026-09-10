import Image from 'next/image'
import { Heart, CalendarDays, MapPin, GraduationCap } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useI18n } from '@/lib/i18n/provider'

interface BrideProfile {
  id: string
  name: string
  age: number
  city: string
  subCommunity: string
  education: string
  occupation: string
  partnerEducation: string
  partnerOccupation: string
  about: string
  preferences: string
  photo: string
  alt: string
}

export default function BrideProfilePage() {
  const { t } = useI18n()
  const params = useParams()
  const profileId = params.id as string

  // Sample profile data - in a real app, this would fetch from Supabase
  const profile: BrideProfile = {
    id: profileId,
    name: 'A***** K*****',
    age: 26,
    city: 'Pune',
    subCommunity: 'Mali',
    education: 'B.E. (Computer)',
    occupation: 'Working Professional',
    partnerEducation: 'B.E. or above',
    partnerOccupation: 'Working Professional',
    about: 'I am a software engineer passionate about preserving our cultural values. I believe in a respectful and family-oriented relationship.',
    preferences: 'Looking for a compatible match within the Mali community, aged 25-30, with similar educational background.',
    photo: '/images/profiles/bride-1.jpg',
    alt: 'Featured Mali bride profile photograph',
  }

  return (
    <section className="bg-cream">
      <div className="container-page py-24">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-3xl font-bold text-maroon mb-6">{t('pages.brides.title')}: {profile.name}</h1>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Photo side */}
            <div>
              <Image
                src={profile.photo}
                alt={profile.alt}
                className="rounded-2xl w-full h-[300px] object-cover"
                fill
              />
              <div className="mt-6 p-4 bg-white rounded-xl">
                <h2 className="font-display text-xl font-bold text-maroon mb-4">Profile Details</h2>
                <ul className="space-y-3 text-stone-700">
                  <li className="flex items-center gap-3">
                    <CalendarDays className="h-4 w-4 text-amber-600" aria-hidden /> <span>Age: {profile.age}</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <MapPin className="h-4 w-4 text-maroon/60" aria-hidden /> <span>City: {profile.city}</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <GraduationCap className="h-4 w-4 text-maroon/60" aria-hidden /> <span>Education: {profile.education}</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Building className="h-4 w-4 text-maroon/60" aria-hidden /> <span>Occupation: {profile.occupation}</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Details side */}
            <div>
              <h2 className="font-display text-xl font-bold text-maroon mb-4">About</h2>
              <p className="text-stone-700 line-clamp-4">{profile.about}</p>
              
              <h3 className="font-display font-medium text-maroon mb-3">Partner Preferences</h3>
              <p className="text-stone-600 line-clamp-3">{profile.preferences}</p>
              
              <div className="mt-6 pt-6 border-t border-stone-200/30">
                <h3 className="font-display font-semibold text-maroon mb-3">Connect</h3>
                <p className="text-stone-500 text-sm">
                  Contact details will be shared when both families agree. Register to send a connection request.
                </p>
                <button
                  className="mt-3 w-full rounded-full bg-maroon px-6 py-2.5 text-[13px] font-semibold text-white shadow-md shadow-maroon/25 transition-all hover:bg-maroon-dark"
                >
                  Send Interest
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}