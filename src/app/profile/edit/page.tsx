import type { Metadata } from 'next'
import { ProfileWizard } from '@/components/profile/profile-wizard'

export const metadata: Metadata = {
  title: 'Complete your profile',
  description: 'Build and publish your Mali Vivah matrimony profile.',
}

export default function ProfileEditPage() {
  return <ProfileWizard />
}
