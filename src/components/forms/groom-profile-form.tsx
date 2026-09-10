'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useI18n } from '@/lib/i18n/provider'
import { Heart, CalendarDays, MapPin, GraduationCap, Building, HeartHandshake } from 'lucide-react'

type GroomProfile = {
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
  photo?: File | string
}

export function GroomProfileForm({ initial }: { initial?: GroomProfile }) {
  const { t } = useI18n()
  const [form, setForm] = useState<GroomProfile>({
    name: initial?.name || '',
    age: initial?.age || 29,
    city: initial?.city || 'Mumbai',
    subCommunity: initial?.subCommunity || 'Mali',
    education: initial?.education || 'MBA',
    occupation: initial?.occupation || 'Business Owner',
    partnerEducation: initial?.partnerEducation || 'Any',
    partnerOccupation: initial?.partnerOccupation || 'Any',
    about: initial?.about || '',
    preferences: initial?.preferences || '',
    photo: undefined,
  })

  const [photoPreview, setPhotoPreview] = useState<string | undefined>(initial?.photo)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value, name } = e.target
    const numValue = value === '' ? 0 : parseInt(value)
    setForm(prev => ({
      ...prev,
      [name]: isNaN(numValue) ? (name === 'age' ? 29 : '') : numValue,
    }))
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => setPhotoPreview(e.target?.asResult || e.target.result as string)
      reader.readAsDataURL(file)
    }
  }

  return (
    <section className="bg-cream">
      <div className="container-page py-24">
        <div className="mx-auto max-w-2xl">
          <h1 className="font-display text-3xl font-bold text-maroon mb-6">{t('pages.grooms.title')}</h1>
          
          <form className="bg-white p-8 rounded-2xl shadow-card-float ring-1 ring-stone-100/80">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              <div>
                <label className="block text-stone-700 mb-2 font-medium">{t('register.name')}</label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  className="w-full rounded-full border border-stone-300 px-4 py-3 placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors"
                  placeholder="As it appears in your documents"
                />
              </div>
              <div>
                <label className="block text-stone-700 mb-2 font-medium">Age</label>
                <input
                  type="number"
                  name="age"
                  value={form.age.toString()}
                  onChange={handleChange}
                  className="w-full rounded-full border border-stone-300 px-4 py-3 placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors"
                  placeholder="29"
                />
              </div>
              <div>
                <label className="block text-stone-700 mb-2 font-medium">City</label>
                <input
                  type="text"
                  name="city"
                  value={form.city}
                  onChange={handleChange}
                  className="w-full rounded-full border border-stone-300 px-4 py-3 placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors"
                  placeholder="Mumbai"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              <div>
                <label className="block text-stone-700 mb-2 font-medium">Sub-community</label>
                <select
                  name="subCommunity"
                  value={form.subCommunity}
                  onChange={handleChange}
                  className="w-full rounded-full border border-stone-300 px-4 py-3 placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors"
                >
                  <option value="Mali">Mali</option>
                  <option value="Phul Mali">Phul Mali</option>
                  <option value="Maratha Mali">Maratha Mali</option>
                  <option value="Lal Mali">Lal Mali</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-stone-700 mb-2 font-medium">Education</label>
                <input
                  type="text"
                  name="education"
                  value={form.education}
                  onChange={handleChange}
                  className="w-full rounded-full border border-stone-300 px-4 py-3 placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors"
                  placeholder="MBA"
                />
              </div>
              <div>
                <label className="block text-stone-700 mb-2 font-medium">Occupation</label>
                <input
                  type="text"
                  name="occupation"
                  value={form.occupation}
                  onChange={handleChange}
                  className="w-full rounded-full border border-stone-300 px-4 py-3 placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors"
                  placeholder="Business Owner"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-stone-700 mb-2 font-medium">Partner's Education</label>
                <select
                  name="partnerEducation"
                  value={form.partnerEducation}
                  onChange={handleChange}
                  className="w-full rounded-full border border-stone-300 px-4 py-3 placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors"
                >
                  <option value="Any">Any</option>
                  <option value="B.E.">B.E.</option>
                  <option value="MBA">MBA</option>
                  <option value="CA">CA</option>
                  <option value="12th">12th</option>
                  <option value="Graduate">Graduate</option>
                </select>
              </div>
              <div>
                <label className="block text-stone-700 mb-2 font-medium">Partner's Occupation</label>
                <select
                  name="partnerOccupation"
                  value={form.partnerOccupation}
                  onChange={handleChange}
                  className="w-full rounded-full border border-stone-300 px-4 py-3 placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors"
                >
                  <option value="Any">Any</option>
                  <option value="Working Professional">Working Professional</option>
                  <option value="Business Owner">Business Owner</option>
                  <option value="Govt. Job">Govt. Job</option>
                  <option value="Student">Student</option>
                </select>
              </div>
            </div>

            <div className="mt-6">
              <label className="block text-stone-700 mb-2 font-medium">About Yourself</label>
              <textarea
                rows={3}
                name="about"
                value={form.about}
                onChange={handleChange}
                className="w-full rounded-full border border-stone-300 px-4 py-3 resize-none placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors h-[120px]"
                placeholder="Tell us about yourself, your values, and what matters most to your family..."
              ></textarea>
            </div>

            <div className="mt-6">
              <label className="block text-stone-700 mb-2 font-medium">Partner Preferences</label>
              <textarea
                rows={3}
                name="preferences"
                value={form.preferences}
                onChange={handleChange}
                className="w-full rounded-full border border-stone-300 px-4 py-3 resize-none placeholder-stone-400 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-colors h-[120px]"
                placeholder="e.g., Age 25-30, Same sub-community, Educated family..."
              ></textarea>
            </div>

            <div className="mt-8">
              <label className="block text-stone-700 mb-2 font-medium">
                <span className="hidden sm:block">Photograph</span>
                Upload Photo
              </label>
              <input
                type="file"
                accept="image/*"
                name="photo"
                onChange={handlePhotoChange}
                className="hidden"
              />
              <div className="flex items-center gap-3">
                {photoPreview ? (
                  <Image
                    src={photoPreview}
                    alt="Groom profile photograph"
                    className="h-24 w-24 rounded-full object-cover"
                    fill
                  />
                ) : (
                  <div
                    className="h-24 w-24 rounded-2xl border-2 border-stone-300/50 flex items-center justify-center text-stone-400"
                  >
                    <Heart className="h-8 w-8 text-maroon" aria-hidden />
                  </div>
                )}
                <span>
                  <span className="text-stone-500 ml-2">Add photo</span>
                  <input
                    type="submit"
                    className="ml-2 rounded-full bg-maroon px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-maroon-dark"
                    value="Choose File"
                  />
                </span>
              </div>
            </div>

            <div className="mt-10 pt-8 border-t border-stone-200/50">
              <button
                type="submit"
                className="w-full rounded-full bg-maroon px-8 py-3.5 text-[14px] font-semibold text-white shadow-lg shadow-maroon/25 transition-all hover:bg-maroon-dark"
              >
                Find Your Partner
              </button>
            </div>
          </form>
        </div>
      </section>
    </section>
  )
}