import type { Metadata } from 'next'
import { SUPPORT_EMAIL } from '@/lib/contact'
import {
  LegalDocument,
  LegalLink,
  LegalPlaceholder,
  type LegalSection,
} from '@/components/legal/legal-document'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Mali Vivah collects, uses, protects and shares your personal data — matrimonial profiles, photos, contact privacy, verification, payments and your choices.',
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
    id: 'introduction',
    title: '1. Introduction',
    content: (
      <>
        <Lead>
          Mali Vivah (&ldquo;Mali Vivah&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is an online matrimonial service
          built for the Mali Samaj community. We help Members create a matrimonial profile, discover compatible
          profiles, express interest, and connect with other members and their families in a controlled,
          consent-first way.
        </Lead>
        <p>
          This Privacy Policy explains how we collect, use, disclose and protect personal information when you
          register on, browse, or use the Mali Vivah website and its related features (the &ldquo;Platform&rdquo;).
          Terms used here — <strong>Member</strong> (a registered user of the Platform) and{' '}
          <strong>Profile</strong> (the matrimonial profile a Member builds) — carry the same meaning as in our{' '}
          <LegalLink href="/terms-and-conditions">Terms &amp; Conditions</LegalLink>.
        </p>
        <p>
          This Policy covers the Platform operated by Mali Vivah. It does not cover third-party websites or
          services that we link to or that process parts of the service on our behalf (such as the payment
          provider) — those have their own privacy policies, referred to where relevant below.
        </p>
      </>
    ),
  },
  {
    id: 'information-we-collect',
    title: '2. Information We Collect',
    content: (
      <>
        <p>We collect only what is needed to run a matrimonial service: the details that make a Profile real, searchable and safe.</p>

        <SubHeading>2.1 Information you provide when registering</SubHeading>
        <Bullets
          items={[
            'Full name',
            'Email address and mobile number',
            'Password (stored only as a secure credential, never in readable form)',
            'Who the profile is for (yourself, your son or your daughter)',
          ]}
        />

        <SubHeading>2.2 Matrimonial profile information</SubHeading>
        <p>While completing your Profile you may provide:</p>
        <Bullets
          items={[
            'Gender and date of birth',
            'Height and marital status',
            'Religion/community and sub-community (including gotra, where you choose to share it)',
            'Mother tongue',
            'City, state and country of residence, and native place',
            'Education and field of study',
            'Occupation, employer/company or business name',
            'Annual income range (you can hide this from viewers at any time)',
            'Lifestyle information such as diet, smoking and drinking habits, and hobbies',
            'A free-text “About me” note and partner preferences (the age, height, location, education, community and lifestyle qualities you seek in a match)',
            'Family information such as family type and parents’ occupations (you can hide this from viewers at any time)',
          ]}
        />

        <SubHeading>2.3 Photographs and content</SubHeading>
        <Bullets
          items={[
            'Profile photographs and an optional family photograph',
            'Mali Moments — short-lived photos or clips you choose to share with the community, which expire automatically after 24 hours',
            'Success stories and accompanying photos, if you submit one for review and publication',
          ]}
        />

        <SubHeading>2.4 Verification information</SubHeading>
        <Bullets
          items={[
            'Mobile verification details: the one-time passcode (OTP) sent to your registered mobile number and whether verification succeeded',
            'Profile/photo verification material, such as a selfie submitted for review against your profile photos',
            'Optional identity-verification documents you choose to upload for administrative review',
          ]}
        />

        <SubHeading>2.5 Activity and interaction information</SubHeading>
        <Bullets
          items={[
            'Profile views recorded when other Members view your Profile, and the views you make',
            'Interests you send or receive, their statuses (pending, accepted, declined) and resulting mutual connections',
            'Messages exchanged through the Platform’s messaging feature, which is available only to paid members in a mutual connection',
            'Notifications and in-app activity updates',
            'Reports you submit and members you block (and reports made against your Profile)',
            'Login history and general activity records used to secure and audit the Platform',
          ]}
        />

        <SubHeading>2.6 Payment-related information</SubHeading>
        <p>
          When you purchase a membership or a boost, we keep a record of the order and its outcome: the package,
          amount, payment and order references, payment status and dates. Card numbers, bank-account credentials,
          CVV codes and UPI PINs are <strong>not</strong> collected or stored by Mali Vivah — payment instruments
          are handled by our payment provider (see Section&nbsp;7).
        </p>

        <SubHeading>2.7 Technical information</SubHeading>
        <Bullets
          items={[
            'Authentication session data kept in cookies while you are signed in',
            'Device, browser and IP-address information captured in server and security logs, as needed to operate and protect the service',
            'Preferences such as your chosen interface language, stored on your device so the Platform remembers it',
          ]}
        />
        <p className="text-stone-500">
          If you choose not to provide certain profile details, you can still register — but parts of the
          matchmaking experience (search visibility, matching quality, promotional eligibility) depend on those
          details being complete.
        </p>
      </>
    ),
  },
  {
    id: 'how-we-use-information',
    title: '3. How We Use Information',
    content: (
      <>
        <p>We use the information described above to:</p>
        <Bullets
          items={[
            'Create, maintain and display matrimonial Profiles according to your settings',
            'Provide matchmaking and search, show eligible Profiles, and compute compatibility suggestions such as your Daily 5 matches',
            'Process interests, mutual connections, messaging and biodata sharing according to the Platform’s connection rules',
            'Reveal contact information only when the Platform’s eligibility and mutual-consent rules are satisfied',
            'Process memberships, purchases, promotional entitlements and related support',
            'Provide mobile, photo and (where submitted) identity verification, and display the resulting status badges',
            'Prevent fraud, impersonation, abuse and misuse, and handle reports and blocks',
            'Operate moderation — our team reviews Profiles, photos, Moments and stories before or after publication and may remove content that breaches our rules',
            'Provide customer and administrative support, including responding to privacy requests',
            'Improve Platform functionality, reliability and the quality of matches',
            'Maintain security, perform auditing, and comply with legal obligations',
          ]}
        />
      </>
    ),
  },
  {
    id: 'profile-visibility',
    title: '4. Profile Visibility',
    content: (
      <>
        <p>Mali Vivah is deliberately conservative about who sees what:</p>
        <Bullets
          items={[
            'Free Members can create and complete a Profile, but a free Profile is not publicly showcased — it does not appear in the paid member directory, search results or featured lists until a membership (including a promotional grant) is active.',
            'Active paid Members appear in search results, recommendations and featured placements according to their plan and the Platform’s ranking rules.',
            'When you are not signed in, Profile details shown to you are restricted and masked (for example, partially hidden names and blurred locked fields) rather than fully exposed.',
            'Certain details — such as your “About me” text, family information, family photo and income range — can be hidden from other members at any time from Profile → Settings & privacy.',
          ]}
        />
        <p>
          Your phone number and email address are never displayed publicly on the Platform. They become visible
          to another Member only when your mutual interest connection unlocks them under the Platform&rsquo;s
          contact-reveal rules. Sensitive data such as verification documents is never shown to other Members.
        </p>
      </>
    ),
  },
  {
    id: 'photos',
    title: '5. Photos',
    content: (
      <>
        <Bullets
          items={[
            'Profile photographs are shown to other Members according to the visibility rules in Section 4. You control which photos appear on your Profile.',
            'A family photograph can be uploaded for viewers, and can be hidden at any time from your privacy settings.',
            'Verification material (selfies or identity documents submitted for verification) is used only for the verification review and is never displayed on your Profile or exposed to other Members.',
            'Mali Moments disappear automatically 24 hours after posting; until then they follow the same visibility and moderation rules as the rest of the Platform.',
            'To keep the community safe, authorized administrators can review, restrict or remove photos that breach the Terms & Conditions or applicable law — for example photos that are fake, abusive, or of another person without the uploader’s right to share them.',
          ]}
        />
        <p>
          Please upload only photos you have the right to share. Removing a photo from your Profile removes it from
          display going forward, subject to the retention matters described in Section&nbsp;10.
        </p>
      </>
    ),
  },
  {
    id: 'verification',
    title: '6. Verification',
    content: (
      <>
        <p>The Platform offers verification tracks to strengthen trust between families:</p>
        <Bullets
          items={[
            'Mobile verification — a one-time passcode sent by SMS confirms you control the mobile number on the account.',
            'Profile/photo verification — a submitted selfie is compared with your profile photos by our team before a verified status is granted.',
            'Identity verification — where offered, an optional identity document may be uploaded for restricted administrative review.',
          ]}
        />
        <p>
          A verification badge indicates that a particular check was completed at a point in time. It is not — and
          must not be relied upon as — a guarantee that a person is genuine, honest, safe, or suitable, and it
          does not extend to a member&rsquo;s conduct off the Platform. Verification material is kept confidential
          and shown to other Members not at all; only the resulting status is visible.
        </p>
      </>
    ),
  },
  {
    id: 'payments',
    title: '7. Payments',
    content: (
      <>
        <p>
          Membership and boost payments on the Platform are processed through a third-party payment provider
          (currently Razorpay). Payment flows pass through the provider&rsquo;s checkout systems; Mali Vivah
          receives and stores the transaction references and statuses needed to activate memberships and support
          billing queries — not your card or bank credentials.
        </p>
        <p>
          Your payment provider processes your payment instrument and related data under its own terms and privacy
          policy. Any queries about how your payment instrument itself is handled should be directed to the
          provider.
        </p>
      </>
    ),
  },
  {
    id: 'cookies-and-technical-data',
    title: '8. Cookies and Technical Data',
    content: (
      <>
        <Bullets
          items={[
            'Authentication cookies — keep you signed in and protect your session. These are necessary for the Platform to work.',
            'On-device preferences — for example your language choice (English or Marathi) is remembered on your device.',
            'Server and security logs — request and login records used for operations, auditing and abuse prevention.',
            'In-service activity records — interactions such as interests, views and moderation events are stored within the Platform’s own database so the service can function and be analysed internally.',
          ]}
        />
        <p>
          The Platform does not currently use third-party advertising trackers or cross-site marketing cookies.
          If tracking technologies are ever introduced, this Policy will be updated first.
        </p>
      </>
    ),
  },
  {
    id: 'data-sharing',
    title: '9. Data Sharing',
    content: (
      <>
        <p>We do not sell your personal information. We share it only in the following circumstances:</p>
        <Bullets
          items={[
            'With other Members, as an inherent part of a matrimonial service — subject always to the visibility, membership and mutual-consent rules described in Sections 3 and 4.',
            'With service providers we rely on to operate the Platform, such as database/hosting and authentication providers, the SMS gateway that delivers OTPs, and payment processing.',
            'With the payment provider, for membership purchases and refunds where applicable.',
            'Where required by law, or in response to a lawful request from government, law-enforcement or judicial authorities.',
            'To protect the Platform and its users — for example investigating fraud, abuse or security incidents, or enforcing our Terms & Conditions (which may involve disclosing relevant records to the affected party or to authorities).',
            'In connection with a business transfer (reorganization or transfer of the service), where user information may be part of the transferred assets — subject to this Policy.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'data-retention',
    title: '10. Data Retention',
    content: (
      <>
        <p>
          We keep personal information while your account is active, and afterwards for reasonable periods where
          necessary to:
        </p>
        <Bullets
          items={[
            'Comply with legal, tax and accounting obligations (for example, payment and invoice records)',
            'Maintain security, audit and anti-fraud records',
            'Handle disputes, reports and investigations',
            'Meet other legitimate operational requirements of running the service',
          ]}
        />
        <p>
          Specific retention periods depend on the type of record and the obligations that apply to them. Content
          you delete (or that moderation removes) may persist briefly in backups or logs before cycling out, and
          anonymised records may be kept indefinitely for statistics and safety.
        </p>
      </>
    ),
  },
  {
    id: 'account-deletion',
    title: '11. Account Deletion',
    content: (
      <>
        <p>
          You can delete your account directly from Profile → Settings &amp; privacy, using the{' '}
          <LegalLink href="/profile/settings">Delete my account</LegalLink> control. Deletion is self-service and
          takes effect immediately: your Profile is unlisted, your photos and moments are erased, and your matches,
          interests, notifications and history are removed.
        </p>
        <p>
          Deletion does not immediately erase information we are entitled or required to keep — for example
          anonymised payment and billing records, records of reports and safety actions, and audit logs — which may
          be retained for legal, security, fraud-prevention and audit purposes as described in Section&nbsp;10.
        </p>
      </>
    ),
  },
  {
    id: 'your-rights-and-choices',
    title: '12. Your Rights and Privacy Choices',
    content: (
      <>
        <p>Where applicable under the law in force for you, you may:</p>
        <Bullets
          items={[
            'Access your information — much of it is simply your own Profile, visible to you at any time in the app; for other records, write to us at the contact in Section 17.',
            'Correct or update your information — most profile fields can be edited directly from Profile → Edit Profile; changes that require our side to adjust will be actioned on request.',
            'Withdraw consent you have given (for example, opt-in preferences) — doing so will not affect processing that already took place with your consent.',
            'Delete your account at any time, as described in Section 11.',
            'Ask us to restrict or explain specific processing of your personal information.',
          ]}
        />
        <p>
          We will consider every request in line with applicable law; in some cases we may need to verify your
          identity or may be unable to act because of legal obligations — we will explain when that happens.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: '13. Security',
    content: (
      <>
        <p>
          We use technical and organizational measures designed to protect personal information, including:
        </p>
        <Bullets
          items={[
            'Authenticated access — accounts are protected by sign-in credentials and session controls',
            'Server-side authorization — visibility and contact-reveal rules are enforced by the server on every request, not just hidden in the interface',
            'Database-level access policies and restricted administrative access, with privileged operations limited to authorized roles',
            'Access controls and review workflows for verification documents and moderation tools',
            'Payment processing through a dedicated payment provider with its own security controls, including server-side verification of payment signatures',
            'Monitoring and auditing of logins, administrative actions and safety-relevant events',
          ]}
        />
        <p>
          No method of transmission or storage is completely secure. We work to protect your information, but we
          cannot promise absolute security, and no platform can. Please safeguard your password and report any
          suspected compromise to us immediately.
        </p>
      </>
    ),
  },
  {
    id: 'childrens-privacy',
    title: "14. Children's Privacy",
    content: (
      <>
        <p>
          Mali Vivah is a matrimonial service intended for adults. Members must be at least 18 years of age (and
          of marriageable age under applicable law). The Platform is not directed at minors, and we do not
          knowingly accept registrations from them. If we become aware that a minor has provided personal
          information, we will take steps to delete it.
        </p>
      </>
    ),
  },
  {
    id: 'third-party-services',
    title: '15. Third-Party Services',
    content: (
      <>
        <p>Parts of the Platform are provided by third parties, each subject to its own terms and privacy policy:</p>
        <Bullets
          items={[
            'Razorpay — payment gateway used for membership and boost purchases',
            'Our database, hosting and authentication provider (currently Supabase), which stores Platform data and issues sign-in sessions and OTP messages via a configured SMS gateway',
            'Communication channels published on the Platform, such as the WhatsApp support chat, which operate under those providers’ own policies',
          ]}
        />
        <p>
          We encourage you to read the privacy policies of these providers. We are not responsible for their
          independent practices once data passes to them under their own terms.
        </p>
      </>
    ),
  },
  {
    id: 'changes-to-this-policy',
    title: '16. Changes to This Policy',
    content: (
      <>
        <p>
          Mali Vivah may update this Privacy Policy to reflect changes in the Platform, in how we process
          information, or in applicable law. The updated version will be published on this page with a revised
          &ldquo;Last updated&rdquo; date, and we may highlight material changes within the Platform (for example
          through notifications) where practical. Your continued use of the Platform after changes take effect
          means the updated Policy applies to you.
        </p>
      </>
    ),
  },
  {
    id: 'contact',
    title: '17. Contact',
    content: (
      <>
        <p>
          For privacy questions, requests concerning your personal data, or concerns about how the Platform handles
          them, contact us:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-stone-400 sm:pl-6">
          <li>
            By email: <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-maroon underline underline-offset-2 hover:text-maroon-dark">{SUPPORT_EMAIL}</a>
          </li>
          <li>Through the support channels published on the Platform (including the WhatsApp support chat linked from this site)</li>
          <li>Through the Contact section on our About page (<LegalLink href="/about#contact">/about#contact</LegalLink>)</li>
        </ul>
        <p className="text-stone-500 text-sm">
          A designated grievance or data-protection contact for the operating entity:{' '}
          <LegalPlaceholder>[GRIEVANCE / DATA-PROTECTION CONTACT TO BE CONFIRMED BY THE BUSINESS]</LegalPlaceholder>
        </p>
      </>
    ),
  },
]

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      eyebrow="Policies & Safety"
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      intro={
        <>
          Your matrimonial profile carries personal and family information. This Policy explains, in plain
          language, exactly what Mali Vivah collects, why we collect it, who can see it, and the choices you
          control — including how contact details stay private until mutual interest unlocks them.
        </>
      }
      sections={sections}
      closingNote={
        <p className="rounded-2xl border border-stone-200 bg-stone-100/80 px-5 py-4 text-xs text-stone-500 sm:text-sm">
          This document is the current published Privacy Policy of the Platform. It is a product and policy draft
          that should be reviewed with legal counsel for your jurisdiction before formal reliance. Bracketed
          placeholders mark items awaiting confirmation by the business.
        </p>
      }
    />
  )
}
