import type { Config } from "tailwindcss";

// Uttrycket är hämtat från den svenska gården och byggnadsvården: kalkputs, falufärg, ockra,
// linoljefärg, järn och lera, på en varm pappersbakgrund (Designdokument 2.0, Visuell design).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        kalk: { DEFAULT: "#F4EFE4", 2: "#EAE2D1", 3: "#DED3BC" },
        sot: { DEFAULT: "#2A2824", 2: "#4A463F", 3: "#6E685E" },
        falu: { DEFAULT: "#8C2F1D", dark: "#6B2215", light: "#B4553F" },
        ockra: { DEFAULT: "#B9852B", light: "#E3C27E" },
        linolja: { DEFAULT: "#4F5E3A", light: "#7C8A5C", pale: "#DCE0C9" },
        jarn: { DEFAULT: "#7D8079", light: "#B9BBB3" },
        lera: { DEFAULT: "#B49E7E", light: "#D6C7AE" },
        papper: "#FBF8F1",
      },
      fontFamily: {
        serif: ['"Fraunces Variable"', "Georgia", "serif"],
        sans: ['"Source Sans 3 Variable"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        papper: "0 1px 0 rgba(42,40,36,0.06), 0 2px 6px -2px rgba(42,40,36,0.14)",
        upphojd: "0 1px 0 rgba(42,40,36,0.08), 0 6px 16px -6px rgba(42,40,36,0.25)",
      },
      maxWidth: { falt: "768px" },
    },
  },
  plugins: [],
} satisfies Config;
