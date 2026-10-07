import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

// Sökväg där appen ligger, t.ex. "/VRETA/v2/" på GitHub Pages. Standard är roten.
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  resolve: { alias: { "@shared": fileURLToPath(new URL("./supabase/functions/_shared", import.meta.url)) } },
  // PGlite och dess tillägg (PostGIS, pgvector) laddar wasm och datafiler via import.meta.url
  optimizeDeps: { exclude: ["@electric-sql/pglite", "@electric-sql/pglite-postgis", "@electric-sql/pglite-pgvector"] },
  worker: { format: "es" },
  server: { fs: { allow: [".."] } },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "VRETA",
        short_name: "VRETA",
        description: "Platsens digitala minne, nervsystem och berättarröst",
        lang: "sv",
        theme_color: "#8C2F1D",
        background_color: "#F4EFE4",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Demodatabasen (PGlite, PostGIS) är stor: cachas vid första användning så att demot fungerar offline
        runtimeCaching: [
          { urlPattern: /\.(?:wasm|data|tar\.gz)$/, handler: "CacheFirst", options: { cacheName: "vreta-pglite", expiration: { maxEntries: 20 } } },
          { urlPattern: /\.(?:sql)$/, handler: "StaleWhileRevalidate", options: { cacheName: "vreta-sql" } },
        ],
        navigateFallbackDenylist: [/^\/functions\//],
      },
    }),
  ],
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          maplibre: ["maplibre-gl"],
        },
      },
    },
  },
});
