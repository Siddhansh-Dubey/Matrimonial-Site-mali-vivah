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
  'login.title': 'Welcome back',
  'login.subtitle': 'Sign in with your email, mobile number and password to continue.',
  'login.panel.kicker': 'Mali Samaj matrimony',
  'login.panel.title': 'Find a partner who shares your roots',
  'login.panel.body':
    'A respectful space for verified Mali families. Your contact details stay private until you choose to share them.',
  'login.trust.verified': 'Verified community profiles',
  'login.trust.private': 'Private contact sharing',
  'login.trust.respect': 'Respectful, family-first matching',
  'login.email': 'Email ID',
  'login.email.placeholder': 'you@example.com',
  'login.mobile': 'Mobile number',
  'login.mobile.placeholder': '98765 43210',
  'login.password': 'Password',
  'login.password.placeholder': 'Enter your password',
  'login.remember': 'Remember me',
  'login.forgot': 'Forgot password?',
  'login.submit': 'Log in',
  'login.submitting': 'Signing in…',
  'login.noAccount': 'New to Mali Vivah?',
  'login.register': 'Create a free account',
  'login.showPassword': 'Show password',
  'login.hidePassword': 'Hide password',
  'login.error.email': 'Enter a valid email address.',
  'login.error.mobile': 'Enter a valid 10-digit Indian mobile number.',
  'login.error.password': 'Password is required.',
  'login.error.mismatch': 'This mobile number does not match the account.',
  'login.error.generic': 'We could not sign you in. Please check your details and try again.',
  'login.error.env': 'Login is not connected yet. Add Supabase credentials in .env.local to enable sign-in.',
  'login.forgot.hint': 'Password reset will be available once the account service is connected. Please contact support if you need help now.',
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
  'login.title': 'परत स्वागत आहे',
  'login.subtitle': 'पुढे जाण्यासाठी आपला ईमेल, मोबाइल क्रमांक आणि पासवर्ड वापरून साइन इन करा.',
  'login.panel.kicker': 'माळी समाज विवाह',
  'login.panel.title': 'आपल्या मुळांशी नाते असलेला जोडीदार शोधा',
  'login.panel.body':
    'पडताळणी केलेल्या माळी कुटुंबांसाठी आदरयुक्त व्यासपीठ. संपर्क माहिती आपण शेअर करेपर्यंत खाजगी राहते.',
  'login.trust.verified': 'पडताळणी केलेली प्रोफाइल्स',
  'login.trust.private': 'खाजगी संपर्क शेअरिंग',
  'login.trust.respect': 'कुटुंबप्रधान, आदरयुक्त जुळवणी',
  'login.email': 'ईमेल आयडी',
  'login.email.placeholder': 'you@example.com',
  'login.mobile': 'मोबाइल क्रमांक',
  'login.mobile.placeholder': '९८७६५ ४३२१०',
  'login.password': 'पासवर्ड',
  'login.password.placeholder': 'आपला पासवर्ड टाका',
  'login.remember': 'मला लक्षात ठेवा',
  'login.forgot': 'पासवर्ड विसरलात?',
  'login.submit': 'लॉगिन करा',
  'login.submitting': 'साइन इन होत आहे…',
  'login.noAccount': 'माळी विवाहावर नवीन आहात?',
  'login.register': 'मोफत खाते तयार करा',
  'login.showPassword': 'पासवर्ड दाखवा',
  'login.hidePassword': 'पासवर्ड लपवा',
  'login.error.email': 'योग्य ईमेल पत्ता टाका.',
  'login.error.mobile': 'योग्य १० अंकी भारतीय मोबाइल क्रमांक टाका.',
  'login.error.password': 'पासवर्ड आवश्यक आहे.',
  'login.error.mismatch': 'हा मोबाइल क्रमांक या खात्याशी जुळत नाही.',
  'login.error.generic': 'साइन इन करता आले नाही. कृपया तपशील तपासा आणि पुन्हा प्रयत्न करा.',
  'login.error.env': 'लॉगिन अद्याप जोडलेले नाही. साइन इनसाठी .env.local मध्ये Supabase माहिती टाका.',
  'login.forgot.hint': 'खाते सेवा जोडल्यावर पासवर्ड रीसेट उपलब्ध होईल. सध्या मदत हवी असल्यास समर्थनाशी संपर्क करा.',
}

export const dictionaries: Record<Locale, Dict> = { en, mr }

export const localeNames: Record<Locale, string> = {
  en: 'English',
  mr: 'मराठी',
}

export function translate(locale: Locale, key: string): string {
  return dictionaries[locale]?.[key] ?? dictionaries[defaultLocale][key] ?? key
}
