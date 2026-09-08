export const locales = ['en', 'mr'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'

type Dict = Record<string, string>

const en: Dict = {
  'site.name': 'Mali Vivah',
  'site.tagline': 'Trusted matrimony for the Mali Samaj',
  'nav.home': 'Home',
  'nav.search': 'Search',
  'nav.about': 'About',
  'nav.contact': 'Contact',
  'nav.login': 'Login',
  'nav.register': 'Register Free',
  'lang.label': 'Language',
  'setup.title': 'Project foundation is ready',
  'setup.body':
    'Next.js 14, TypeScript, Tailwind and the Supabase client layer are wired up. Share the requirements document and the full feature set will be built on top of this base.',
  'setup.env': 'Add your Supabase URL and anon key to .env.local to connect the backend.',
}

const mr: Dict = {
  'site.name': 'माळी विवाह',
  'site.tagline': 'माळी समाजासाठी विश्वासार्ह विवाह संस्था',
  'nav.home': 'मुख्यपृष्ठ',
  'nav.search': 'शोधा',
  'nav.about': 'आमच्याविषयी',
  'nav.contact': 'संपर्क',
  'nav.login': 'लॉगिन',
  'nav.register': 'मोफत नोंदणी',
  'lang.label': 'भाषा',
  'setup.title': 'प्रकल्पाचा पाया तयार आहे',
  'setup.body':
    'Next.js 14, TypeScript, Tailwind आणि Supabase क्लायंट जोडले आहेत. आवश्यकतांचा दस्तऐवज दिल्यावर संपूर्ण वैशिष्ट्ये यावर तयार केली जातील.',
  'setup.env': 'बॅकएंड जोडण्यासाठी .env.local मध्ये आपली Supabase URL आणि anon key टाका.',
}

export const dictionaries: Record<Locale, Dict> = { en, mr }

export const localeNames: Record<Locale, string> = {
  en: 'English',
  mr: 'मराठी',
}

export function translate(locale: Locale, key: string): string {
  return dictionaries[locale]?.[key] ?? dictionaries[defaultLocale][key] ?? key
}
