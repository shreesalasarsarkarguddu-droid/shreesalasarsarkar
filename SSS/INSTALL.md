# Installing on shared hosting (cPanel / Hostinger style)

Paths are inside the SSS folder, which is the root of the deploy repo (github.com/TarunKumarDewangan/shreesalasarsarkarfin1).

The site is one Laravel app (`backend/`). The React screens are built once into `backend/public/app/` and Laravel serves them,
so the hosting needs only PHP + MySQL. Nothing runs on Vercel or Supabase any more.

## What the hosting needs

- PHP 8.2 or newer with: pdo_mysql, mbstring, openssl, zlib, ctype, fileinfo, tokenizer, xml (all standard on cPanel).
  The zip extension is NOT needed (the backup zip is written by `app/Services/ZipWriter.php`).
- MySQL 8 or MariaDB 10.4+, one empty database and its user.
- Cron jobs (every cPanel has "Cron Jobs").
- SSH / Terminal is easiest. Without it, run the composer and artisan steps on your PC and upload the folder.

## 1. Build on your PC

```bash
cd frontend
npm ci
npm run build          # writes backend/public/app/
cd ../backend
composer install --no-dev --optimize-autoloader
```

## 2. Upload

Upload the whole `backend` folder to the hosting, **outside** `public_html`, e.g. `/home/USER/sss`.
Then make the domain's document root point to `/home/USER/sss/public`:

- cPanel → Domains → (your domain) → Document Root → `sss/public`.
- If the document root cannot be changed: put the contents of `sss/public` into `public_html` and edit
  `public_html/index.php`: `__DIR__.'/../vendor/...'` → `__DIR__.'/../sss/vendor/...'` and `__DIR__.'/../bootstrap/app.php'` →
  `__DIR__.'/../sss/bootstrap/app.php'`.

`storage/` and `bootstrap/cache/` must be writable (755, or 775 if the host needs it).

## 3. Settings file

Copy `.env.example` to `.env` and fill in:

```
APP_ENV=production
APP_DEBUG=false
APP_URL=https://your-domain.in
DB_DATABASE=...   DB_USERNAME=...   DB_PASSWORD=...
SANCTUM_STATEFUL_DOMAINS=your-domain.in,www.your-domain.in
SESSION_SECURE_COOKIE=true
BACKUP_PASSWORD=...              # optional: nightly backup encryption
BACKUP_TELEGRAM_TOKEN=...        # optional: bot that posts the nightly backup
BACKUP_TELEGRAM_CHAT_ID=...      # optional: chat that receives it
```

Then (SSH, inside the folder):

```bash
php artisan key:generate
php artisan migrate --force
php artisan config:cache
php artisan route:cache
```

## 4. Cron (notifications + nightly backup)

One cron line, every minute:

```
* * * * * cd /home/USER/sss && php artisan schedule:run >> /dev/null 2>&1
```

This sends the hourly Telegram daily summary / WhatsApp due reminders, and makes the nightly backup at 22:00 India time
(kept in `storage/app/backups`, last 7; sent encrypted to Telegram when the 3 BACKUP_ values are set).

## 5. Move the data from Supabase (one time, at the switch-over)

Stop entries on the old site first (tell staff), then on your PC:

```bash
python SSS/scripts/pull_from_supabase.py move.sql --keep-notifications   # from the full project folder on the PC
```

`move.sql` holds every user (same email + password as before), account, receipt, loan, payment, setting and the activity log.
Import it with phpMyAdmin (Import → move.sql) or `mysql -u USER -p DB < move.sql`, then **delete move.sql** (customer data).

Check the totals: Settings → Data → "Data now" must show the same counts as the old site's Settings → Data, and the
Dashboard / Day Book of today must match the old site.

Without Python: create the users on the new site (Users page), then on the old site download Settings → Backup (.zip) and on
the new site use Settings → Data → Restore from a backup file. (Telegram / WhatsApp settings are then typed in again.)

## 6. Updating later

With git on the server: `git pull` (the screens in `public/app` and `public/autodeal-build` are committed), then:

```bash
php artisan migrate --force
php artisan config:cache
php artisan route:cache
```

A migration that adds a column to a data table must add it to its restore-point copy `rp_<table>` too
(see `database/migrations/2026_10_21_000100_create_data_safety_tables.php`).

## Hostinger: everything on businesstradecore.in (screens, API, Auto Deal)

Laravel serves the screens (`public/app`, committed) for every page that is not `/api`, `/sanctum`, `/autodeal` or `/storage`,
so one domain does it all and the session cookie is never cross-site. The code is in `~/domains/api.businesstradecore.in/sss`.

```bash
cd ~/domains/businesstradecore.in
mv public_html public_html_old                       # the old dist/ upload (delete it once all works)
ln -s ~/domains/api.businesstradecore.in/sss/backend/public public_html
cd ~/domains/api.businesstradecore.in/sss/backend
sed -i 's#^APP_URL=.*#APP_URL=https://businesstradecore.in#' .env
php artisan config:cache && php artisan route:cache && php artisan view:clear
```

Keep `SESSION_DOMAIN=.businesstradecore.in`, `FRONTEND_URL` and `SANCTUM_STATEFUL_DOMAINS` as below: people stay signed in, and
api.businesstradecore.in keeps working for old links. After a change to the screens: `cd frontend && npm run build`
(writes `backend/public/app`), commit, `git pull` on the server.

## Screens and API on two domains (the older way: businesstradecore.in + api.businesstradecore.in)

- API: clone into `~/domains/api.businesstradecore.in/sss`, replace that domain's `public_html` with a link to
  `sss/backend/public`, and add to `.env`:
  ```
  APP_URL=https://api.businesstradecore.in
  FRONTEND_URL=https://businesstradecore.in,https://www.businesstradecore.in
  SANCTUM_STATEFUL_DOMAINS=businesstradecore.in,www.businesstradecore.in
  SESSION_DOMAIN=.businesstradecore.in
  SESSION_SECURE_COOKIE=true
  ```
- Screens: on the PC `cd frontend && npm run build:split` (API address in `.env.split`) writes `dist/` with an `.htaccess`;
  upload the contents of `dist/` (including `.htaccess`) into `~/domains/businesstradecore.in/public_html`.

## Auto Deal (used-vehicle stock and sales, `/autodeal`)

Part of the backend (`app/AutoDeal`, `routes/autodeal.php`, `resources/autodeal`, tables `ad_*`). It uses the SSS login:
admins are owners (cost, profit, reports, delete); other users need the "Auto Deal" power on the Users page and never see cost
or profit. Its screens are already built in `backend/public/autodeal-build` (committed), so the server needs no Node.

After `git pull` on the server:

```bash
composer install --no-dev --optimize-autoloader
php artisan migrate --force          # creates the ad_* tables (and their rp_ad_* restore copies)
php artisan storage:link             # once: vehicle photos are served from public/storage
                                     # Hostinger (exec / symlink switched off): ln -s ../storage/app/public public/storage
php artisan config:cache && php artisan route:cache && php artisan view:clear
```

Optional `.env` lines (defaults in `config/autodeal.php`):

```
AUTODEAL_ENABLED=true                # false hides the screens and the menu link; the data stays
DEALER_NAME="Shree Salasar Sarkar · Auto Deal"
DEALER_ADDRESS=...
DEALER_PHONE=...
DEALER_GSTIN=...
CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>   # vehicle photos on Cloudinary (Dashboard -> API Keys)
AUTODEAL_IMAGE_KB=200                # largest stored image
```

Photos: every image (vehicle photos, ID proofs, sale papers) is shrunk to 200 KB or less, on the phone first and again on
the server (PHP GD) if a bigger one arrives. With `CLOUDINARY_URL` set, new vehicle photos go to Cloudinary (folder
`autodeal/vehicles/<id>`) and are deleted there when removed; without it they stay in `storage/app/public/autodeal`.
Photos added earlier stay where they are. ID proofs and sale papers always stay on this server (private).

Links: `https://businesstradecore.in/autodeal/vehicles` (the Next.js site's menu link goes there; change it with
`NEXT_PUBLIC_AUTODEAL_URL`, empty hides it). Public catalogue for customers: `https://businesstradecore.in/autodeal/catalogue`.

Backups: the backup zip and restore points include the `ad_*` tables. Photos and ID proofs are files, not rows: Settings →
Data → "Download Auto Deal photos & documents" (Cloudinary photos are downloaded into it too), and the nightly job keeps the last 3 `autodeal-files-DATE.zip` in
`storage/app/backups`.

Removing it for good: `php artisan autodeal:remove` saves a backup zip and the files zip in `storage/app/backups`, drops the
`ad_*` tables and prints the files to delete (`app/AutoDeal`, `routes/autodeal.php`, ...). Just hiding it: `AUTODEAL_ENABLED=false`.

Changing its screens: `cd backend && npm install && npm run build` (writes `public/autodeal-build`, commit it); `npm run dev`
for hot reload.

## Local development

```bash
cd backend && php artisan serve            # API on 127.0.0.1:8000
cd frontend && npm run dev                 # screens on localhost:5173 (calls the API through the Vite proxy; /autodeal too)
php artisan test                               # feature tests (on the local copy, rolled back)
```
