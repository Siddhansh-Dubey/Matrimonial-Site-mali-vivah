import type { Metadata } from 'next'
import { SUPPORT_EMAIL } from '@/lib/contact'
import {
  LegalDocument,
  LegalLink,
  LegalPlaceholder,
  type LegalSection,
} from '@/components/legal/legal-document'

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description:
    'The rules for using Mali Vivah — eligibility, profiles and conduct, memberships and payments, verification, safety actions, disclaimers and liability.',
}

const LAST_UPDATED = 'September 21, 2026'

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="font-medium text-stone-800">{children}</p>
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-stone-400 sm:pl-6">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 text-sm font-bold uppercase tracking-wide text-stone-500 sm:text-[13px]">{children}</h3>
}

const sections: LegalSection[] = [
  {
    id: 'acceptance-of-terms',
    title: '1. Acceptance of These Terms',
    content: (
      <>
        <Lead>
          These Terms &amp; Conditions (the &ldquo;Terms&rdquo;) form a binding agreement between you and Mali
          Vivah for your use of the Mali Vivah website and its features (the &ldquo;Platform&rdquo;).
        </Lead>
        <p>
          By creating an account, submitting a profile, or using the Platform, you confirm that you have read
          these Terms, accept them, and accept our <LegalLink href="/privacy-policy">Privacy Policy</LegalLink>.
          If you do not agree, please do not register or use the Platform.
        </p>
        <p>
          &ldquo;Member&rdquo; means a registered user of the Platform. &ldquo;Profile&rdquo; means the matrimonial
          profile a Member builds on the Platform. Where we write &ldquo;Mali Vivah&rdquo;, &ldquo;we&rdquo; or
          &ldquo;us&rdquo; in these Terms, we mean the business that operates the Mali Vivah Platform.
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    title: '2. Eligibility',
    content: (
      <>
        <Bullets
          items={[
            'You must be an adult — at least 18 years of age — and of the age permitted to marry under the law that applies to you.',
            'You must provide truthful, accurate and current information in your registration and Profile. A profile may be created for yourself, your son or your daughter; if you register on behalf of someone else, you confirm you are authorised to do so and that the details you provide are accurate.',
            'You are responsible for everything done under your account. Keep your login credentials private and do not share your account with anyone.',
            'One person should maintain one profile. Do not operate duplicate or misleading profiles.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'nature-of-the-service',
    title: '3. Nature of the Service',
    content: (
      <>
        <p>
          Mali Vivah is an online matrimonial and matchmaking platform for the Mali Samaj community. We provide
          the tools: profile publishing, search, compatibility matching, interest exchanges, private messaging,
          biodata sharing, verification tracks and paid visibility options.
        </p>
        <p>
          We facilitate discovery and communication between Members and their families. We are not a marriage
          broker, an employment or background-investigation agency, or a party to any relationship. Mali Vivah
          does not guarantee marriage, compatibility, relationship success, or the identity, character, education,
          employment, financial status, marital status or any other claim a Member makes. Every profile is
          self-reported by the Member who created it.
        </p>
      </>
    ),
  },
  {
    id: 'account-registration',
    title: '4. Account Registration',
    content: (
      <>
        <Bullets
          items={[
            'Accurate information is required at registration and when completing your Profile. Update your Profile when circumstances change (for example, marital status or contact details).',
            'Do not create profiles to mislead, defraud, harass, or impersonate anyone — including profiles using another person’s identity or photographs.',
            'You choose a password at registration; keep it confidential. You are responsible for all activity that happens under your account, and you must tell us promptly about any suspected unauthorised use.',
            'Your registered email and mobile number are used for account security, including sign-in confirmations and verification OTPs.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'profile-information',
    title: '5. Profile Information',
    content: (
      <>
        <p>On your Profile, you must not:</p>
        <Bullets
          items={[
            'impersonate another person or create a profile for someone without their consent;',
            'knowingly provide false or misleading information;',
            'upload photographs of another person without the right and authority to do so;',
            'misrepresent marital status (for example, concealing that a divorce is pending or final);',
            'misrepresent age, education, employment, occupation or income;',
            'post content that is unlawful, abusive, threatening, defamatory, obscene, or intended to scam or solicit money from other Members.',
          ]}
        />
        <p>
          Profiles are reviewed by our team before they go live in the community directory. Review is an
          operational safety measure, not an approval or guarantee of the accuracy of what a Member states.
        </p>
      </>
    ),
  },
  {
    id: 'photos-and-content',
    title: '6. Photos and Content',
    content: (
      <>
        <p>
          You are responsible for every photo, Moment, story or text you upload. By uploading content, you confirm
          you have the rights to it and the consent of the people shown, and you allow Mali Vivah to display and
          distribute it within the Platform the way the relevant feature works (for example, profile photos shown
          to members according to visibility rules, and Moments shown for 24 hours).
        </p>
        <p>
          You keep ownership of your content. Mali Vivah takes no ownership of your photos or text; we only use
          them to operate the service you signed up for.
        </p>
        <p>
          Mali Vivah may moderate, restrict, or remove content that breaches these Terms or applicable law, in
          our discretion and as needed to keep the community safe — including after a report from another Member.
          Repeated violations may lead to action under Section&nbsp;15.
        </p>
      </>
    ),
  },
  {
    id: 'matrimonial-interactions',
    title: '7. Matrimonial Interactions and Your Judgement',
    content: (
      <>
        <Bullets
          items={[
            'Mali Vivah does not guarantee compatibility, responses, interest acceptance, or any outcome. Matching and Daily 5 suggestions are computed from profile details and preferences; they are introductions, not verdicts.',
            'You are responsible for your own decisions and interactions with other Members, online and offline.',
            'Independently verify information about families you engage with — talk to them, ask questions, and verify through your own channels, including through family and community contacts.',
            'Use appropriate caution before sharing personal information (addresses, financial details, documents) and before meeting anyone. Consider meeting first in a safe, public setting with family present, as community practice allows.',
            'Never send money to someone you have met online, whatever the reason given. Financial dealings between Members are solely their responsibility.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'contact-information',
    title: '8. Contact Information and How It Unlocks',
    content: (
      <>
        <p>
          Phone numbers and email addresses are never published on the Platform. Contact details become available
          only through Mali Vivah&rsquo;s connection rules: an interest must be sent and accepted by both parties,
          and the relevant unlock (contact details, messaging, biodata download) then applies according to the
          plan features and privacy settings in effect.
        </p>
        <p>
          Purchasing a membership buys visibility and features for your own account — payment alone never gives
          you automatic access to another person&rsquo;s private contact details, messages, or biodata. Those
          unlock only through the mutual-consent mechanism, and can be cut off by blocks or account actions.
        </p>
      </>
    ),
  },
  {
    id: 'memberships-and-paid-plans',
    title: '9. Memberships and Paid Plans',
    content: (
      <>
        <SubHeading>Plans on the Platform</SubHeading>
        <ul className="space-y-2">
          <li>
            <strong>Smart — ₹999 for 90 days.</strong> Your profile goes live in the directory, appears in search
            and recommendations, can express and receive interests, and gets the Daily 5 compatible matches.
          </li>
          <li>
            <strong>Premium — ₹2,499 for 180 days.</strong> Everything in Smart, plus advanced search filters
            (height, income, native place, lifestyle), who-viewed-your-profile, and eligibility for featured
            placement.
          </li>
          <li>
            <strong>VIP — ₹4,999 for 365 days.</strong> Everything in Premium, with priority placement in search
            and featured sections and extended benefits for a full year.
          </li>
        </ul>
        <SubHeading>How membership works</SubHeading>
        <Bullets
          items={[
            'Memberships are one-time purchases for a fixed duration and activate when payment is confirmed. They are not auto-renewing subscriptions; nothing recurs silently when a plan ends.',
            'When a membership expires, the paid visibility and unlock benefits lapse automatically (your profile stops being publicly showcased, and member-only unlocks pause) — history is not deleted. Buying a fresh plan restores the experience.',
            'You can renew or upgrade at any time by purchasing another plan; renewal of an expired plan re-activates the paid state for that new duration.',
            'Profile boosts and featured visibility: plans include boost allowances and featured eligibility, and boosts can also be purchased separately. Featured placement on the home page and search is subject to the Platform’s curation and plan rules.',
            'Promotional memberships (such as the Platinum launch grants in Section 11) work the same as paid memberships while they last, but cost nothing and follow their own eligibility rules.',
          ]}
        />
        <p>
          Prices shown on the Packages page are the prices that apply at the time of purchase and may be revised
          for future purchases. Buying a membership improves your reach and access — it never guarantees matches,
          responses, interest acceptance, or a marriage.
        </p>
      </>
    ),
  },
  {
    id: 'payments-and-refunds',
    title: '10. Payments and Refunds',
    content: (
      <>
        <p>
          Payments are processed through our third-party payment provider (currently Razorpay) using their
          checkout and payment infrastructure. By paying, you also deal with the provider under its own terms.
          Please complete payment only from an account or instrument you are authorised to use.
        </p>
        <p>
          Refunds and cancellations for memberships and boosts are governed by the{' '}
          <LegalLink href="/cancellation-and-refund">Cancellation &amp; Refund Policy</LegalLink> published on the
          Platform, together with any specific conditions shown at checkout. The final commercial refund and
          cancellation terms remain subject to the business&rsquo;s confirmation:
        </p>
        <p>
          <LegalPlaceholder>[FINAL REFUND/CANCELLATION POLICY TO BE CONFIRMED BY THE BUSINESS]</LegalPlaceholder>
        </p>
      </>
    ),
  },
  {
    id: 'promotional-offers',
    title: '11. Promotional Offers',
    content: (
      <>
        <p>
          From time to time the Platform runs promotions with their own eligibility, duration and availability
          rules. The current example is the <strong>Platinum Launch Offer</strong>: the first 100 members who
          complete their profile receive a free 30-day Platinum membership, and after those slots are taken,
          members who complete the required profile details receive a one-time free 24-hour Platinum demo.
        </p>
        <Bullets
          items={[
            'Promotional memberships are granted free — they are never sold and no payment is created for them.',
            'Eligibility depends on completing the required profile details while the promotion is live and slots remain; a promotion may be paused, changed or withdrawn.',
            'A promotional grant never reduces, replaces or overrides an active paid membership, and it never unlocks things that only real verification can grant (such as the verified badge itself).',
          ]}
        />
      </>
    ),
  },
  {
    id: 'prohibited-conduct',
    title: '12. Prohibited Conduct',
    content: (
      <>
        <p>You agree not to:</p>
        <Bullets
          items={[
            'harass, stalk, threaten, defame, or abuse any person, including other Members;',
            'use the Platform to scam, solicit money, or defraud anyone;',
            'impersonate any person or entity, or misstate your affiliation with one;',
            'spam, solicit, or send unsolicited commercial messages;',
            'distribute viruses or malicious software, or attempt to gain unauthorized access to any system, account or data;',
            'scrape, harvest or collect profile data (including restricted or private data) by automated means, or misuse another Member’s information;',
            'upload content that is unlawful or in breach of these Terms;',
            'abuse the reporting, blocking or moderation mechanisms (for example, false reports or coordinated harassment);',
            'attempt to bypass membership gates, contact-unlock rules, privacy settings, verification requirements or any other access control;',
            'sell, resell, or commercially exploit the Platform without our written permission.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'reports-and-blocking',
    title: '13. Reports and Blocking',
    content: (
      <>
        <p>
          The Platform provides safety tools where applicable: you can report a profile, photo, Moment or
          interaction, and you can block a member. A blocked member cannot view your profile, send you an
          interest, or message you; you likewise stop seeing them. You can manage and undo your own blocks from
          Settings &amp; privacy.
        </p>
        <p>
          Mali Vivah may investigate reports and take action under its policies — including content removal,
          warnings, visibility restrictions, suspension or termination. We act based on what we can observe on
          the Platform; our response to a report is at our discretion and does not make us a judge between
          Members. For criminal matters, please also approach the appropriate authorities.
        </p>
      </>
    ),
  },
  {
    id: 'verification',
    title: '14. Verification',
    content: (
      <>
        <p>
          The Platform may show verification statuses such as mobile-verified or profile/photo-verified. A badge
          means only that the particular verification process was completed at the time it was granted — for
          example, that a mobile number was confirmed by OTP, or that a submitted selfie matched profile photos on
          review.
        </p>
        <p>
          Verification is not a guarantee of a person&rsquo;s character, honesty, safety, marital status,
          financial status, employment, or matrimonial suitability, and it does not extend to anything that
          happens outside the Platform. Treat every interaction with normal family diligence.
        </p>
      </>
    ),
  },
  {
    id: 'suspension-and-termination',
    title: '15. Suspension and Termination',
    content: (
      <>
        <p>
          Mali Vivah may warn, restrict visibility, suspend, hide or terminate an account — temporarily or
          permanently — where it believes there is:
        </p>
        <Bullets
          items={[
            'a breach of these Terms or the Privacy Policy;',
            'fraud, scam behaviour or forgery of profile details or documents;',
            'abuse of other Members or of platform mechanisms;',
            'a security concern for the Platform or its users;',
            'unlawful activity conducted through or via the Platform;',
            'misleading or materially inaccurate information; or',
            'any other misuse of the Platform.',
          ]}
        />
        <p>
          Where practical and safe, we will give notice and an opportunity to respond. You may stop using and
          delete your account at any time (see the Privacy Policy, Section 11). Account, payment and safety
          records may be retained where legally or operationally necessary, as described in the Privacy Policy.
        </p>
      </>
    ),
  },
  {
    id: 'intellectual-property',
    title: '16. Intellectual Property',
    content: (
      <>
        <p>
          The Platform — including the Mali Vivah name, branding and logos, the software, design, layout,
          matchmaking configuration and original platform content — is owned by or licensed to Mali Vivah and is
          protected by intellectual-property laws. You may use it only to participate as a Member as described in
          these Terms.
        </p>
        <p>
          Nothing in these Terms transfers your rights in your own content (your profile text and photos) to Mali
          Vivah beyond the limited display licence described in Section&nbsp;6. If you believe content on the
          Platform infringes your rights, contact us through the details in Section&nbsp;22.
        </p>
      </>
    ),
  },
  {
    id: 'third-party-services',
    title: '17. Third-Party Services',
    content: (
      <>
        <p>
          The Platform relies on third-party providers — for example, payment processing, database, hosting and
          authentication services, and SMS delivery for OTPs. These providers have their own terms, privacy
          policies and security practices, and their services are provided to you (where you deal with them
          directly, such as a payment checkout) under those terms. Mali Vivah is not responsible for the acts or
          omissions of third-party providers to the extent permitted by law.
        </p>
      </>
    ),
  },
  {
    id: 'disclaimers',
    title: '18. Disclaimers',
    content: (
      <>
        <p>
          The Platform is provided on an &ldquo;as available&rdquo; basis for matrimonial introductions within the
          community. Without limiting Section&nbsp;3, Mali Vivah does not guarantee:
        </p>
        <Bullets
          items={[
            'that you will meet a suitable match, receive responses, or marry;',
            'the compatibility of any match or the accuracy of any computation of it;',
            'the accuracy or completeness of information provided by Members (profiles, photos, claims);',
            'the identity, background or intentions of any particular member;',
            'uninterrupted, error-free or secure operation of the Platform, though we work toward all three.',
          ]}
        />
        <p>
          You use the Platform and interact with other Members at your own discretion and with your own diligence.
        </p>
      </>
    ),
  },
  {
    id: 'limitation-of-liability',
    title: '19. Limitation of Liability',
    content: (
      <>
        <p>
          To the maximum extent permitted by applicable law, Mali Vivah shall not be liable for indirect or
          consequential losses arising from your use of, or reliance on, the Platform — including loss caused by a
          Member&rsquo;s conduct or misrepresentation, interactions between Members outside the Platform, or
          service interruptions. Where Mali Vivah is responsible for a matter, that responsibility is limited to
          foreseeable losses arising from our own failure to exercise reasonable care, and — for paid services —
          will not exceed the amount you paid for the affected membership, except where the law provides otherwise.
        </p>
        <p>
          Nothing in these Terms limits liability that cannot lawfully be limited, including liability for fraud
          or wilful misconduct. The final formulation of this clause should be tailored by counsel to the
          governing law once confirmed:{' '}
          <LegalPlaceholder>[LIMITATION OF LIABILITY — TO BE REVIEWED WITH LEGAL COUNSEL]</LegalPlaceholder>
        </p>
      </>
    ),
  },
  {
    id: 'governing-law',
    title: '20. Governing Law and Jurisdiction',
    content: (
      <>
        <p>
          These Terms are governed by, and disputes will be resolved under, the law of{' '}
          <LegalPlaceholder>[GOVERNING LAW AND JURISDICTION TO BE CONFIRMED BY THE BUSINESS/LEGAL COUNSEL]</LegalPlaceholder>,
          with the courts identified in that confirmation having the jurisdiction agreed for disputes arising out
          of these Terms. This placeholder exists because the operating entity has not yet finalised the venue;
          until it is confirmed, no specific court or venue is asserted by these Terms.
        </p>
      </>
    ),
  },
  {
    id: 'changes-to-these-terms',
    title: '21. Changes to These Terms',
    content: (
      <>
        <p>
          Mali Vivah may update these Terms as the Platform evolves or as law changes. Updated Terms will be
          published on this page with a revised &ldquo;Last updated&rdquo; date, and material changes may be
          highlighted within the Platform where practical. Continued use of the Platform after an update takes
          effect means you accept the updated Terms; if you disagree with a change, you may stop using the
          Platform and delete your account.
        </p>
      </>
    ),
  },
  {
    id: 'contact',
    title: '22. Contact',
    content: (
      <>
        <p>
          Questions about these Terms, or concerns about a Member&rsquo;s conduct, can be sent to{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-maroon underline underline-offset-2 hover:text-maroon-dark">
            {SUPPORT_EMAIL}
          </a>
          , or raised through the support channels published on the Platform (including the WhatsApp support chat
          linked from this site and the Contact section on the About page at{' '}
          <LegalLink href="/about#contact">/about#contact</LegalLink>).
        </p>
        <p className="text-sm text-stone-500">
          A designated grievance contact for the operating entity:{' '}
          <LegalPlaceholder>[GRIEVANCE CONTACT TO BE CONFIRMED BY THE BUSINESS]</LegalPlaceholder>
        </p>
      </>
    ),
  },
]

export default function TermsAndConditionsPage() {
  return (
    <LegalDocument
      eyebrow="Policies & Safety"
      title="Terms & Conditions"
      lastUpdated={LAST_UPDATED}
      intro={
        <>
          These Terms set out the rules for using Mali Vivah: what you can expect from us, what we ask of you, and
          how memberships, profiles, verification and safety tools work. Please read them before creating your
          account — they are written to be clear, and to tell you honestly what a matrimonial platform can and
          cannot guarantee.
        </>
      }
      sections={sections}
      closingNote={
        <p className="rounded-2xl border border-stone-200 bg-stone-100/80 px-5 py-4 text-xs text-stone-500 sm:text-sm">
          This document is the current published Terms &amp; Conditions of the Platform. It is a product and policy
          draft that should be reviewed with legal counsel for your jurisdiction before formal reliance. Bracketed
          placeholders mark items awaiting confirmation by the business.
        </p>
      }
    />
  )
}
