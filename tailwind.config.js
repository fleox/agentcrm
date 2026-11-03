/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // Appearance (v0.2): every themable token reads a CSS variable set by
      // src/appearance/ (defaults in src/index.css — identical to the
      // pre-v0.2 palette). Variables hold "r g b" triplets so opacity
      // modifiers (bg-accent-500/20) keep working.
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      colors: {
        // Neutral surface scale (Twenty-like grays; workspace "neutral").
        surface: {
          50: "rgb(var(--srf-50) / <alpha-value>)",
          100: "rgb(var(--srf-100) / <alpha-value>)",
          200: "rgb(var(--srf-200) / <alpha-value>)",
          300: "rgb(var(--srf-300) / <alpha-value>)",
          400: "rgb(var(--srf-400) / <alpha-value>)",
          500: "rgb(var(--srf-500) / <alpha-value>)",
          600: "rgb(var(--srf-600) / <alpha-value>)",
          700: "rgb(var(--srf-700) / <alpha-value>)",
          800: "rgb(var(--srf-800) / <alpha-value>)",
          850: "rgb(var(--srf-850) / <alpha-value>)",
          900: "rgb(var(--srf-900) / <alpha-value>)",
          950: "rgb(var(--srf-950) / <alpha-value>)",
        },
        // Accent scale generated from the workspace accent color (OKLCH).
        accent: {
          50: "rgb(var(--acc-50) / <alpha-value>)",
          100: "rgb(var(--acc-100) / <alpha-value>)",
          200: "rgb(var(--acc-200) / <alpha-value>)",
          300: "rgb(var(--acc-300) / <alpha-value>)",
          400: "rgb(var(--acc-400) / <alpha-value>)",
          500: "rgb(var(--acc-500) / <alpha-value>)",
          600: "rgb(var(--acc-600) / <alpha-value>)",
          700: "rgb(var(--acc-700) / <alpha-value>)",
          800: "rgb(var(--acc-800) / <alpha-value>)",
          900: "rgb(var(--acc-900) / <alpha-value>)",
          950: "rgb(var(--acc-950) / <alpha-value>)",
        },
        // Primary buttons (neutral near-black / white, or accent).
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          hover: "rgb(var(--primary-hover) / <alpha-value>)",
          fg: "rgb(var(--primary-fg) / <alpha-value>)",
        },
      },
      // Workspace radius: Tailwind's default radii × --radius-scale.
      borderRadius: {
        none: "0px",
        sm: "calc(0.125rem * var(--radius-scale))",
        DEFAULT: "calc(0.25rem * var(--radius-scale))",
        md: "calc(0.375rem * var(--radius-scale))",
        lg: "calc(0.5rem * var(--radius-scale))",
        xl: "calc(0.75rem * var(--radius-scale))",
        "2xl": "calc(1rem * var(--radius-scale))",
        "3xl": "calc(1.5rem * var(--radius-scale))",
        full: "9999px",
      },
      // Density: table rows, controls, card paddings.
      height: {
        row: "var(--row-h)",
        ctl: "var(--ctl-h)",
      },
      padding: {
        card: "var(--card-pad)",
        "card-head": "var(--card-head-py)",
        page: "var(--page-py)",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.05)",
        pop: "0 12px 32px -12px rgb(0 0 0 / 0.28), 0 2px 6px -2px rgb(0 0 0 / 0.08)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        "scale-in": { "0%": { opacity: 0, transform: "scale(0.97)" }, "100%": { opacity: 1, transform: "scale(1)" } },
        "slide-in-right": { "0%": { transform: "translateX(24px)", opacity: 0 }, "100%": { transform: "translateX(0)", opacity: 1 } },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "scale-in": "scale-in 0.15s ease-out",
        "slide-in-right": "slide-in-right 0.18s ease-out",
      },
    },
  },
  plugins: [],
};
