/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace'],
      },
      colors: {
        // Slate-based dark theme
        terminal: {
          bg: '#0f172a',
          fg: '#e2e8f0',
        },
      },
    },
  },
  plugins: [],
};
