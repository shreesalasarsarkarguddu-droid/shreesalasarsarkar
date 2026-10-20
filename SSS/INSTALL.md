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

Build again on the PC (step 1), upload the changed files (`app/`, `routes/`, `database/`, `public/app/`, ...), then:

```bash
php artisan migrate --force
php artisan config:cache
php artisan route:cache
```

A migration that adds a column to a data table must add it to its restore-point copy `rp_<table>` too
(see `database/migrations/2026_10_21_000100_create_data_safety_tables.php`).

## Screens and API on two domains (Hostinger: businesstradecore.in + api.businesstradecore.in)

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

## Local development

```bash
cd backend && php artisan serve            # API on 127.0.0.1:8000
cd frontend && npm run dev                 # screens on localhost:5173 (calls the API through the Vite proxy)
php artisan test                               # feature tests (on the local copy, rolled back)
```
