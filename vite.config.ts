import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Sökväg där appen ligger, t.ex. "/VRETA/" på GitHub Pages. Standard är roten.
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "VRETA",
        short_name: "VRETA",
        description: "Återbruk, regenerativ platsutveckling och berättande",
        lang: "sv",
        theme_color: "#8C2F1D",
        background_color: "#F4EFE4",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      // VRETA 2 ligger i v2/ på samma sida – prototypens service worker ska inte svara för den
      workbox: { globPatterns: ["**/*.{js,css,html,svg,woff2}"], navigateFallbackDenylist: [/\/v2(\/|$)/] },
    }),
  ],
  worker: { format: "es" },
  build: {
    rollupOptions: {
      output: {
        // Bibliotek i egna filer: de ändras sällan och cachas mellan versioner
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
  },
});
