/** @type {import('tailwindcss').Config} */
// BookWorm Tailwind config — mirrors the inline tailwind.config blocks that
// were previously in base.html, login.html, register.html, setup.html, and
// 2fa_verify.html.  Run rebuild_css.bat (or the Docker build step) to
// regenerate static/css/tailwind.css after editing templates or JS files.
module.exports = {
  darkMode: 'class',

  // Scan every template and every JS file — the JS files build large HTML
  // strings with full Tailwind class names embedded as string literals, so
  // they must be included here or the classes will be purged.
  content: [
    './templates/**/*.html',
    './static/js/**/*.js',
  ],

  theme: {
    extend: {
      colors: {
        wblue:  { DEFAULT: '#0053e2', hover: '#0060ff', press: '#003eb0' },
        wspark: { DEFAULT: '#ffc220', dark:  '#995213' },
        wred:   { DEFAULT: '#ea1100' },
        wgreen: { DEFAULT: '#2a8703' },
      },
    },
  },

  // Safelist: classes injected via JS innerHTML at runtime that the scanner
  // cannot always detect through escaped-quote string literals.
  safelist: [
    'hidden',
    'sm:inline',
  ],

  plugins: [],
};
