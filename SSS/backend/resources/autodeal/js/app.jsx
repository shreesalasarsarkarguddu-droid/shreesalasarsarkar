import '../css/app.css';
import { createInertiaApp } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import AppLayout from './Layouts/AppLayout';

const pages = import.meta.glob('./Pages/**/*.jsx');

createInertiaApp({
    title: (title) => (title ? `${title} · Auto Deal` : 'Auto Deal'),
    resolve: async (name) => {
        const page = (await pages[`./Pages/${name}.jsx`]()).default;
        // Persistent layout: the shell (bottom nav) never re-mounts between pages.
        // The public catalogue and the error page have no staff shell.
        const bare = name.startsWith('Catalogue/') || name === 'Error';
        page.layout ??= bare ? undefined : (p) => <AppLayout>{p}</AppLayout>;
        return page;
    },
    setup({ el, App, props }) {
        createRoot(el).render(<App {...props} />);
    },
    progress: { color: '#2563eb', delay: 150 },
});
