'use client'

import { useState } from 'react'
import { useI18n } from '@/lib/i18n/provider'

export function ContactSharingCard({ 
  groomName, 
  brideName, 
  onShareClick 
}: { 
  groomName: string 
  brideName: string 
  onShareClick: () => void 
}) {
  const { t } = useI18n()
  const [showContact, setShowContact] = useState(false)

  return (
    <section className="bg-white p-6 rounded-2xl shadow-card-float ring-1 ring-stone-100/80 mt-8">
      <div className="flex flex-col sm:flex-row items-start gap-6">
        <div className="w-full sm:w-1/2">
          <h2 className="font-display text-xl font-bold text-maroon mb-4">
            {t('home.why.private.title')}
          </h2>
          <p className="text-stone-600 mb-6">
            {t('home.why.privateBody')}
          </p>
        </div>

        <div className="w-full sm:w-1/2">
          <div className="p-4 bg-maroon-50 rounded-xl mb-4">
            <div className="flex items-center gap-3">
              <GroomIcon className="h-5 w-5 text-maroon" aria-hidden />
              <span className="font-medium text-maroon">{groomName}</span>
            </div>
            <p className="text-sm text-stone-500">
              {t('home.trust.privateBody')}
            </p>
          </div>

          <button
            onClick={onShareClick}
            className="w-full rounded-full bg-maroon px-6 py-3 text-[13px] font-semibold text-white shadow-md shadow-maroon/25 transition-all hover:bg-maroon-dark"
            aria-label={t('home.trust.privateBody')}
          >
            {t('home.trust.verified')}
          </button>
        </div>
      </div>

      {showContact && (
        <div className="mt-6 p-4 bg-gold-50 rounded-xl">
          <p className="text-stone-600 mb-4">
            {t('home.trust.privateBody')}
          </p>
          <div className="grid grid-cols-2 gap-4 text-stone-700 text-sm">
            <div>
              <span className="font-medium">Bride's Information</span>
              <p className="mt-1 line-clamp-2">Available after consent</p>
            </div>
            <div>
              <span className="font-medium">Groom's Information</span>
              <p className="mt-1 line-clamp-2">Available after consent</p>
            </div>
          </div>
          <button
            onClick={() => setShowContact(false)}
            className="mt-3 w-full rounded-full bg-stone-200 px-6 py-3 text-[13px] font-medium text-stone-800 transition-colors hover:bg-stone-300"
          >
            Close
          </button>
        </div>
      )}
    </section>
  )
}

function GroomIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 512 512"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        d="M264 400c-15 0-26-11-26-26V158c0-15 11-26 26-26h86c15 0 26 11 26 26v210c0 15-11 26-26 26z"
      />
      <circle cx="256" cy="300" r="34" stroke="#FFD700" strokeWidth="8" fill="none" />
      <circle cx="256" cy="164" r="12" fill="#FFD700" />
      <path d="M160 272c-25 0-43 17.5-43 41v53c0 12 13 21 28 21h81c15 0 28-9 28-21v-53c0-23.5-18-41-43-41H160z" />
      <path d="M352 272c-25 0-43 17.5-43 41v53c0 12 13 21 28 21h56c15 0 28-9 28-21v-53c0-23.5-18-41-43-41H352z" />
    </svg>
  )
}