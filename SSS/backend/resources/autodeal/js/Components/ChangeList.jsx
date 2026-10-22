/** Renders an activity-log diff: { field: [old, new] }. */
export default function ChangeList({ changes }) {
    return (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
            {Object.entries(changes).map(([field, [from, to]]) => (
                <li key={field}>
                    <span className="font-medium">{field.replaceAll('_', ' ')}</span>: <span className="line-through">{String(from ?? '—')}</span> → {String(to ?? '—')}
                </li>
            ))}
        </ul>
    );
}
