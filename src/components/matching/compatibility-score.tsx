'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/lib/i18n/provider'

type CompatibilityFactors = {
  education: number // 0-20
  occupation: number // 0-20
  age: number // 0-20
  subCommunity: number // 0-20
  values: number // 0-20
}

export function CompatibilityScore({ brideParams, groomParams }: { brideParams: any; groomParams: any }) {
  const { t } = useI18n()
  const [score, setScore] = useState(0)
  const [factors, setFactors] = useState<CompatibilityFactors>({
    education: 0,
    occupation: 0,
    age: 0,
    subCommunity: 0,
    values: 0,
  })

  useEffect(() => {
    let totalScore = 0
    let totalWeight = 0

    // Education match (0-20 points)
    const eduDiff = Math.abs(brideParams.educationLevel - groomParams.educationLevel)
    const eduScore = eduDiff <= 2 ? 20 : eduDiff <= 5 ? 15 : 5
    totalScore += eduScore
    totalWeight += 20

    // Occupation match (0-20 points)
    const occMatch = brideParams.occupation === groomParams.occupation ? 20 : 10
    totalScore += occMatch
    totalWeight += 20

    // Age compatibility (0-20 points)
    const ageDiff = Math.abs(brideParams.age - groomParams.age)
    const ageScore = ageDiff <= 3 ? 20 : ageDiff <= 5 ? 15 : ageDiff <= 10 ? 10 : 5
    totalScore += ageScore
    totalWeight += 20

    // Sub-community match (0-20 points)
    const subComMatch = brideParams.subCommunity === groomParams.subCommunity ? 20 : 5
    totalScore += subComMatch
    totalWeight += 20

    // Values compatibility (0-20 points) - based on shared preferences
    const valuesScore = 15 // Base score for shared cultural values
    totalScore += valuesScore
    totalWeight += 20

    const finalScore = Math.round((totalScore / totalWeight) * 100)
    setScore(finalScore)

    // Calculate individual factor scores
    setFactors({
      education: eduScore,
      occupation: occMatch,
      age: ageScore,
      subCommunity: subComMatch,
      values: valuesScore,
    })
  }, [brideParams, groomParams])

  const percentage = Math.min(score, 100)
  const percentageColor = percentage >= 80 ? 'text-gold-600' : percentage >= 60 ? 'text-amber-500' : 'text-violet-500'

  return (
    <section className="bg-white p-6 rounded-2xl shadow-card-float ring-1 ring-stone-100/80">
      <div className="flex flex-col sm:flex-row items-start gap-4">
        {/* Score display */}
        <div className="flex-1">
          <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-stone-500 mb-2">
            {t('home.hero.compat.title')}
          </p>
          <div className="relative">
            <div
              className={`absolute inset-0 bg-gradient-to-r from-gold-500 to-amber-500 rounded-[22px] opacity-[0.15] animate-bounce-slow`}
            /></div>
            <div
              className={`rounded-[22px] h-24 w-full overflow-hidden bg-gradient-to-b from-${percentageColor === 'text-gold-600' ? 'maroon-deep' : percentageColor === 'text-amber-500' ? 'amber-700' : 'violet-800'} to-${percentageColor === 'text-gold-600' ? 'maroon-deep' : percentageColor === 'text-amber-500' ? 'amber-300' : 'violet-600'} ${percentageColor === 'text-gold-600' ? 'text-gold-600' : percentageColor === 'text-amber-500' ? 'text-amber-300' : 'text-violet-300'}`}

            >
              <span className={`absolute inset-0 rounded-[22px] ${percentage >= 80 ? 'bg-gold-500/20' : percentage >= 60 ? 'bg-amber-500/20' : 'bg-violet-500/20'}`}></span>
              <span className="absolute top-3 left-3 text-5xl font-bold">{percentage}%</span>
              <span className="absolute bottom-3 right-3 text-[13px] font-medium opacity-70">{t('home.hero.compat.sub')}</span>
            </div>
          </div>
        </div>

        {/* Factors breakdown */}
        <div className="w-full sm:w-48">
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-maroon-deep" aria-hidden /></span>
              <span className="text-stone-700">{t('home.featured.smart.title')}:</span>
              <span className={percentageColor}>{factors.education}/20</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-600" aria-hidden /></span>
              <span className="text-stone-700">{t('home.whyChoose.express.title')}:</span>
              <span className={percentageColor}>{factors.occupation}/20</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-violet-600" aria-hidden /></span>
              <span className="text-stone-700">{t('home.how.step2.title')}:</span>
              <span className={percentageColor}>{factors.age}/20</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gold-600" aria-hidden /></span>
              <span className="text-stone-700">{t('home.search.subCommunity')}:</span>
              <span className={percentageColor}>{factors.subCommunity}/20</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}