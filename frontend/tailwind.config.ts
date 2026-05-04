import type { Config } from 'tailwindcss';

/**
 * Tailwind v4: design tokens live in `src/app/globals.css` (`@theme`, `:root`).
 * Minimal config — avoids legacy custom palettes conflicting with Cognie Vision.
 */
const config = {
  content: [],
  darkMode: 'class',
} satisfies Config;

export default config;
