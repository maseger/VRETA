import type { Config } from "tailwindcss";

// Vreta Regenerative Initiative – grafisk profil (brand book, oktober 2026). Skogsgrön bär identiteten,
// rost får saker att hända, brun brödtext på kalk. Solros, mossa och våtmarksblå är dekor, inte text.
// De äldre namnen (kalk, sot, falu, linolja, lera …) pekar på profilens färger så att hela appen följer med.
const palette = {
  forest: "#1F4D2E", // Skogsgrön: rubriker, navigering, starka knappar, fokus
  moss: "#6B7F46", // Mossa: ikoner och dekor (inte brödtext)
  rust: "#B5523C", // Rost: primära knappar, ordmärket
  rustPressed: "#A1402D", // Rost nedtryckt: hover, länkar och små etiketter (5.7:1 på kalk)
  sunflower: "#F2B233", // Solros: markering och märken, aldrig text på kalk
  cream: "#F8F2E6", // Kalk: bakgrunden för allt
  wetland: "#6B8F9A", // Våtmark: vatten och dekor
  bark: "#5A4636", // Bark: brödtext (8:1)
  mist: "#D8D8D3", // Dimgrå: hårlinjer, kortramar, chips
  tra: "#A2724D", // Trä: virke och ramar, bara dekor
  ockra: "#D99D36", // Ockra: varma markeringar, bara dekor
};

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: palette.forest, light: "#2E6A42", pale: "#E1E7D6" },
        moss: palette.moss,
        rust: { DEFAULT: palette.rust, pressed: palette.rustPressed },
        sunflower: palette.sunflower,
        cream: palette.cream,
        wetland: palette.wetland,
        bark: palette.bark,
        mist: palette.mist,
        tra: palette.tra,
        kalk: { DEFAULT: palette.cream, 2: "#F0E8D8", 3: "#E5DBC6" },
        sot: { DEFAULT: palette.bark, 2: "#6A5545", 3: "#75604F" },
        falu: { DEFAULT: palette.rust, dark: palette.rustPressed, light: "#D08A78" },
        ockra: { DEFAULT: palette.ockra, light: "#EDCB86" },
        linolja: { DEFAULT: palette.forest, light: palette.moss, pale: "#E1E7D6" },
        jarn: { DEFAULT: "#77786F", light: palette.mist },
        lera: { DEFAULT: "#BDB6A6", light: palette.mist },
        papper: "#FCF8F0",
      },
      fontFamily: {
        sans: ['"Sora Variable"', "system-ui", "sans-serif"],
        // Fraunces kursiv bara för citat och uttrycksfulla rader – högst en gång per vy
        serif: ['"Fraunces Variable"', "Georgia", "serif"],
        // Caveat bara för handskrivna avslutningar på 2–5 ord, aldrig för gränssnitt eller rubriker
        script: ['"Caveat Variable"', "cursive"],
      },
      boxShadow: {
        // Mjuk och grönaktig, aldrig gråsvart
        papper: "0 1px 2px rgba(31,77,46,0.06), 0 4px 12px -4px rgba(31,77,46,0.14)",
        upphojd: "0 2px 4px rgba(31,77,46,0.08), 0 10px 24px -8px rgba(31,77,46,0.24)",
      },
      maxWidth: { falt: "768px" },
    },
  },
  plugins: [],
} satisfies Config;
