import type { Config } from "tailwindcss";

// Färger hämtade från byggnadsvårdens material: kalkputs, linoljefärg,
// Falu rödfärg, ockra, järnvitriol, mossa och lera.
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
      },
      fontFamily: {
        serif: ['"Fraunces Variable"', "Georgia", "serif"],
        sans: ['"Source Sans 3 Variable"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        papper: "0 1px 0 rgba(42,40,36,0.06), 0 2px 6px -2px rgba(42,40,36,0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
