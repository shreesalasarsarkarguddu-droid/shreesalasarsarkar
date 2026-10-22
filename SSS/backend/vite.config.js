import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Auto Deal's screens (resources/autodeal), built into public/autodeal-build. That folder is committed, so the server only
// needs `git pull` (no Node there). The SSS screens are the separate React app in SSS/frontend.
export default defineConfig({
    plugins: [
        laravel({
            input: 'resources/autodeal/js/app.jsx',
            buildDirectory: 'autodeal-build',
            hotFile: 'public/autodeal.hot',
            refresh: ['resources/autodeal/views/**'],
        }),
        react(),
        tailwindcss(),
    ],
    resolve: {
        // "@/Components/ui" etc. are Auto Deal's (checked before laravel-vite-plugin's own "@" → resources/js)
        alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./resources/autodeal/js/', import.meta.url)) }],
    },
    build: {
        // Keep vendor code in one long-cached chunk; pages are split per route.
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom', '@inertiajs/react'],
                },
            },
        },
    },
    server: {
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
});
