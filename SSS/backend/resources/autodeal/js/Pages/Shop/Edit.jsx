import { Head, Link, useForm } from '@inertiajs/react';
import { Button, Card, Field, Icon, Input, Textarea } from '@/Components/ui';

/** Owner-only: the shop's contact details, shown to customers on the public catalogue and printed on receipts. */
export default function ShopEdit({ shop, fallback }) {
    const form = useForm(Object.fromEntries(Object.entries(shop).map(([k, v]) => [k, v ?? ''])));
    const field = (name, label, props = {}, hint) => (
        <Field label={label} error={form.errors[name]} hint={hint}>
            <Input value={form.data[name]} onChange={(e) => form.setData(name, e.target.value)} {...props} />
        </Field>
    );
    const save = (e) => {
        e.preventDefault();
        form.put(route('autodeal.shop.update'), { preserveScroll: true });
    };

    return (
        <>
            <Head title="Shop details" />
            <div className="mb-3 flex items-center gap-2">
                <Link href={route('autodeal.account')} className="-ml-2 rounded-full p-2 hover:bg-slate-200" aria-label="Back">
                    <Icon name="chevronLeft" />
                </Link>
                <div className="min-w-0 flex-1">
                    <h1 className="text-lg font-bold">Shop details</h1>
                    <p className="text-xs text-slate-500">Customers see these on the public catalogue; receipts print the name, address, phones, email and GSTIN.</p>
                </div>
                <a href={route('autodeal.catalogue.index')} target="_blank" className="shrink-0 text-sm font-semibold text-brand-700">
                    View catalogue ↗
                </a>
            </div>

            <form onSubmit={save} className="space-y-4">
                <Card className="space-y-4">
                    <h2 className="font-bold">Shop</h2>
                    {field('shop_name', 'Shop name', { placeholder: fallback.name, maxLength: 120 })}
                    {field('tagline', 'Tagline (optional)', { placeholder: 'Trusted used bikes & cars since 2010', maxLength: 160 })}
                    <Field label="Address" error={form.errors.address}>
                        <Textarea rows={2} value={form.data.address} onChange={(e) => form.setData('address', e.target.value)} placeholder={fallback.address || 'Shop no., road, town, district, PIN'} maxLength={255} />
                    </Field>
                    {field('map_url', 'Google Maps link (optional)', { type: 'url', placeholder: 'https://maps.app.goo.gl/…' }, 'Google Maps → your shop → Share → Copy link. Customers get a “Directions” button.')}
                    {field('hours', 'Opening hours (optional)', { placeholder: 'Mon–Sat 9:30 AM – 7:30 PM', maxLength: 120 })}
                </Card>

                <Card className="space-y-4">
                    <h2 className="font-bold">Contact</h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                        {field('phone', 'Mobile no.', { type: 'tel', inputMode: 'tel', placeholder: fallback.phone || '98765 43210' })}
                        {field('phone2', 'Mobile no. 2 (optional)', { type: 'tel', inputMode: 'tel' })}
                        {field('whatsapp', 'WhatsApp no. (optional)', { type: 'tel', inputMode: 'tel' }, 'Empty = the first mobile no.')}
                        {field('email', 'Email (optional)', { type: 'email', inputMode: 'email' })}
                    </div>
                </Card>

                <Card className="space-y-4">
                    <h2 className="font-bold">More</h2>
                    {field('gstin', 'GSTIN (optional, receipts only)', { maxLength: 20, className: 'uppercase' })}
                    <Field label="About the shop (optional)" error={form.errors.about} hint="A few lines for customers: what you sell, finance help, exchange…">
                        <Textarea rows={4} value={form.data.about} onChange={(e) => form.setData('about', e.target.value)} maxLength={2000} />
                    </Field>
                </Card>

                <Button type="submit" loading={form.processing} className="w-full sm:w-auto">
                    Save shop details
                </Button>
            </form>
        </>
    );
}
