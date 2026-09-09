import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf3f3', 100: '#fce7e7', 200: '#f9d0d2', 300: '#f4aab0',
          400: '#ec7a86', 500: '#df4c60', 600: '#c92c4b', 700: '#a8203e',
          800: '#8d1e3a', 900: '#791d37', 950: '#430b19'
        },
        maroon: {
          DEFAULT: '#9e0b1e',
          dark: '#7c0818',
          deep: '#5f0612',
        },
        gold: {
          300: '#e8c87e',
          400: '#e2b857',
          500: '#d4a032',
          600: '#b58326',
          700: '#97702a',
        },
        cream: {
          DEFAULT: '#fff9ef',
          dark: '#f7ecd9',
          deeper: '#f3e3c8',
        },
        ink: '#232030',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
        script: ['var(--font-script)', '"Great Vibes"', 'cursive'],
      },
      boxShadow: {
        'card-float': '0 18px 45px -12px rgba(122, 20, 35, 0.22)',
      },
    }
  },
  plugins: []
}
export default config
