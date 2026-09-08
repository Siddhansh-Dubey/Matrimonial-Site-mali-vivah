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
        gold: { 400: '#e2b857', 500: '#d4a032', 600: '#b58326' }
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif']
      }
    }
  },
  plugins: []
}
export default config
