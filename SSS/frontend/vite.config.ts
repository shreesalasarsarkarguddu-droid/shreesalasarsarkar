import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

const src = (p: string) =>
  fileURLToPath(new URL(`./src/${p}`, import.meta.url));

// Apache (Hostinger) on the screens' own domain: every page that is not a file is index.html.
const htaccess: Plugin = {
  name: "spa-htaccess",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: ".htaccess",
      source: [
        "RewriteEngine On",
        "RewriteCond %{REQUEST_FILENAME} !-f",
        "RewriteCond %{REQUEST_FILENAME} !-d",
        "RewriteRule ^ index.html [L]",
        "",
      ].join("\n"),
    });
  },
};

// Dev: Vite on :5173 forwards /api and /sanctum to Laravel on :8000 (same origin, so the session cookie works).
// Build: the app goes to ../backend/public/app and Laravel serves its index.html for every page.
// Build with --mode split (npm run build:split, .env.split): the screens go to dist/ for their own domain and call the API at
// VITE_API_URL (businesstradecore.in + api.businesstradecore.in).
export default defineConfig(({ command, mode }) => {
  const split = !!loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL;
  return {
    base: command === "build" && !split ? "/app/" : "/",
    plugins: [react(), tailwindcss(), ...(split ? [htaccess] : [])],
    resolve: {
      alias: [
        // components copied from the Next.js app keep their imports
        { find: /^next\/link$/, replacement: src("compat/link.tsx") },
        {
          find: /^next\/navigation$/,
          replacement: src("compat/navigation.ts"),
        },
        { find: /^next\/cache$/, replacement: src("compat/cache.ts") },
        {
          find: /^@\/lib\/supabase\/server$/,
          replacement: src("compat/supabase.ts"),
        },
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
      outDir: split ? "dist" : "../backend/public/app",
      emptyOutDir: true,
      chunkSizeWarningLimit: 900,
    },
  };
});
