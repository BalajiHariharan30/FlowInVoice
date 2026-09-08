/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          900: "#064e3b",
          950: "#022c22"
        },
        obsidian: {
          800: "#131a29",
          850: "#0e1524",
          900: "#0a0f1d",
          950: "#060913"
        }
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        "glass-sm": "0 4px 16px 0 rgba(0, 0, 0, 0.25)",
        "glass-lg": "0 12px 48px 0 rgba(0, 0, 0, 0.5)",
        "neon-emerald": "0 0 20px -3px rgba(16, 185, 129, 0.35)",
        "neon-blue": "0 0 20px -3px rgba(59, 130, 246, 0.35)",
        "neon-purple": "0 0 20px -3px rgba(168, 85, 247, 0.35)",
        "neon-amber": "0 0 20px -3px rgba(245, 158, 11, 0.35)"
      },
      animation: {
        shimmer: "shimmer 2.5s infinite linear",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite"
      },
      keyframes: {
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" }
        }
      }
    }
  },
  plugins: []
};
