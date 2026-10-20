import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

// Dev: Vite on :5173 forwards /api and /sanctum to Laravel on :8000 (same origin, so the session cookie works).
// Build: the app goes to ../backend/public/app and Laravel serves its index.html for every page.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/app/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // components copied from the Next.js app keep their imports
      { find: /^next\/link$/, replacement: src("compat/link.tsx") },
      { find: /^next\/navigation$/, replacement: src("compat/navigation.ts") },
      { find: /^next\/cache$/, replacement: src("compat/cache.ts") },
      { find: /^@\/lib\/supabase\/server$/, replacement: src("compat/supabase.ts") },
      { find: /^@\/lib\/staff$/, replacement: src("compat/staff.ts") },
      { find: /^@\//, replacement: src("") },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/sanctum": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "../backend/public/app",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
}));
