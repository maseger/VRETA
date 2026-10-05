import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
        start_url: "/",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,woff2}"] },
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
