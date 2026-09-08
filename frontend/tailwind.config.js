/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Dark surfaces (Application shell, AI workflow, Developer Center, logs)
        dark: {
          DEFAULT: "#010308",
          bg: "#010308",
          primary: "#010308",
          surface: "#0A0D14",
          secondary: "#0A0D14",
          elevated: "#10141D",
          card: "#10141D",
          "card-hover": "#161B26",
          border: "#1D2430",
          hover: "#171D2A"
        },
        // Light workspace (Tables, invoice details, document viewer, financial data)
        workspace: {
          bg: "#F7F8FA",
          card: "#FFFFFF",
          border: "#E5E7EB",
          text: "#111827",
          muted: "#667085",
          hover: "#F3F4F6",
          subtle: "#F9FAFB"
        },
        // Accents
        accent: {
          primary: "#1841C9",
          hover: "#1435A8",
          secondary: "#4997C6",
          subtle: "#EEF2FF",
          border: "#C7D2FE"
        },
        // Semantic
        semantic: {
          success: "#16A34A",
          "success-bg": "#F0FDF4",
          "success-border": "#BBF7D0",
          warning: "#D97706",
          "warning-bg": "#FFFBEB",
          "warning-border": "#FDE68A",
          error: "#DC2626",
          "error-bg": "#FEF2F2",
          "error-border": "#FECACA",
          info: "#2563EB",
          "info-bg": "#EFF6FF",
          "info-border": "#BFDBFE"
        }
      },
      fontFamily: {
        sans: ["Inter", "Geist", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      boxShadow: {
        subtle: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        card: "0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.08)",
        elevated: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
        "dark-elevated": "0 10px 25px -5px rgba(0, 0, 0, 0.5)"
      }
    }
  },
  plugins: []
};
