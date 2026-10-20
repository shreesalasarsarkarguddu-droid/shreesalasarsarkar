# SSS — Shree Salasar Sarkar on Laravel + React + MySQL

The same app as the Next.js + Supabase site (repo root), rebuilt for cheap shared hosting.
The Next.js site keeps running until this one is complete and the data is moved.

## Layout

- `backend/`  Laravel 12 (PHP 8.2+). JSON API under `/api`, login with Sanctum (SPA cookie + CSRF).
- `frontend/` React 19 + TypeScript + Vite + Tailwind 4 + React Router + TanStack Query. Same screens and classes as the Next app.
- `reference/` the live Supabase schema (`pg-schema.txt`) and every function / view (`pg-functions.sql`): the source of truth when porting logic.
- `scripts/`  one-off tools (data move from Supabase, checks).

Production (shared hosting): `npm run build` in frontend writes to `backend/public/app/`; Laravel serves `index.html` for every
non-API path. Document root = `backend/public`. Cron: `php artisan schedule:run` every minute (backup, Telegram summary, reminders).

## Rules kept from the old app

- Money is DECIMAL(14,2) in MySQL; PHP works in integer paise (no floats); the API sends money as strings "1234.50".
- Dates in the API are "YYYY-MM-DD"; the screens show DD/MM/YYYY everywhere.
- Times are stored in India time (app timezone Asia/Kolkata, DB session +05:30) and sent as ISO with +05:30.
- Every permission check happens on the server (policies in controllers/services), the UI only hides buttons.
- The ledger (installment rows, principal/interest split, due days) is built in the browser by the same TypeScript as now
  (`frontend/src/lib/schedule.ts` etc.); the server posts payments with the same maths as `app_private.post_payment`.
- SQL must run on MySQL 8 and MariaDB 10.4 (local test = XAMPP MariaDB).
- Users: `users.id` is a UUID (same ids as Supabase auth users) so every created_by / user_id moves over unchanged.

## Phases

- [x] 1 Core: Laravel + React skeleton, login, staff/permissions, nav, Accounts list, Account page, Loan page, Payments (collect) list,
      Collect window (split, receipt books/zone books, waiting for approval, idempotency), New loan / edit loan form, data move script
      (local copy of live data for testing), checks against Supabase totals.
- [x] 2 Reports: Day Book, Due Installments (+ tick & assign), Finance Details, Seized, Dashboard (+60 s cache), Statement print.
- [ ] 3 Control: Approvals, Daily cash, Receipt books, Zones + books + DHAMTARI main book, Remarks, Assign, My list, account zone picker.
- [ ] 4 Admin: payment edit (split) / cancel, late fee / discount / reschedule / close, loan delete, seize/release, Activity log,
      Users (create, permissions, archive, sign out), Settings (business, Telegram, WhatsApp, staff controls), notifications.
- [ ] 5 Data: backups (zip/csv), restore points, restore from file, FoxPro DBF import, final data move + totals check,
      shared-hosting install guide.

## Progress log

(newest last)

- 2026-10-20 Phase 1 done. Schema (MySQL/MariaDB), data move script (pull_from_supabase.py; bcrypt $2a$ -> $2y$), Sanctum SPA login,
  accounts list / old account / loan pages, Collect list + window + phone page, payments (split, zone receipt books, people's
  receipt books, waiting for approval, idempotency, audit log), new loan form, change password.
  Checks: `php artisan sss:parity` (pg_parity.py output) — 201 test payments and all 2,708 account rows match the live database;
  `php artisan test` — 15 feature tests; browser check of every Phase 1 page (dev server and the built app served by Laravel).
  Local test logins: database/seeders/LocalTestUserSeeder.php. The copied screens keep their Next.js imports through
  src/compat (next/link, next/navigation, next/cache, @/lib/supabase/server -> /api/rpc/{name}, @/lib/staff).

- 2026-10-20 Phase 2 done. Due report (DueReport.php), Day Book + opening, Seized, Dashboard (60 s cache), staff performance,
  statements, reports index, Due Installments tick & assign (rpc staff_names / assign_collections / unassign_collections).
  Checks: `php artisan sss:reports-parity` (pg_reports_parity.py) — due report 3 days x 1,033 accounts x every column, dashboard,
  day book 934 rows + opening, seized 173, staff performance: all match; 21 feature tests; browser check of every report.
  NOTE: on 2026-10-20 11:53 the live site's admin (Guddu) ran Settings -> Data -> "Delete (old)": the live legacy data is gone,
  restore point #32 holds it. Local tests use that restore point (pull_from_supabase.py --restore-point 32; the parity scripts put
  it into the live tables inside a transaction that is rolled back).
