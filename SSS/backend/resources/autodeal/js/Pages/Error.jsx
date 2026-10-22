import { Head } from '@inertiajs/react';

const MESSAGES = {
    403: ['Not allowed', 'You don’t have access to this page.'],
    404: ['Not found', 'This vehicle or page doesn’t exist, or was deleted.'],
    500: ['Something went wrong', 'The server hit an error. Please try again in a moment.'],
    503: ['Down for maintenance', 'We’ll be back shortly.'],
};

export default function ErrorPage({ status, message, home }) {
    const [title, fallback] = MESSAGES[status] ?? MESSAGES[500];
    const text = (status === 403 && message) || fallback;

    return (
        <div className="flex min-h-dvh items-center justify-center bg-ink px-6 text-center text-slate-200">
            <Head title={title} />
            <div>
                <img src="/icons/icon-192.png" alt="" className="mx-auto size-16 rounded-2xl" />
                <p className="mt-4 text-sm font-semibold text-slate-400">{status}</p>
                <h1 className="text-xl font-bold text-white">{title}</h1>
                <p className="mt-1 text-slate-400">{text}</p>
                <a href={status === 403 ? home || '/' : '/autodeal/vehicles'} className="mt-6 inline-block rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white">
                    {status === 403 ? 'Back to Shree Salasar Sarkar' : 'Go to stock'}
                </a>
            </div>
        </div>
    );
}

// Rendered outside the normal middleware stack (shared props may be missing), so no app shell.
ErrorPage.layout = (page) => page;
