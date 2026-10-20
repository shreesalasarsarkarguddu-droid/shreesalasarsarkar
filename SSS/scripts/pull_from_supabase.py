"""Copy the live Supabase data into the MySQL database of the Laravel app.

    python SSS/scripts/pull_from_supabase.py OUT.sql [--keep-notifications] [--restore-point N]
    mysql -u root sss < OUT.sql

Writes one SQL file (India-time DATETIMEs, JSON for jsonb/arrays). Users come from auth.users + staff with their
bcrypt password hashes, so everyone keeps the same login. By default Telegram / WhatsApp are switched off in the copy
(a test copy must never message the real group); pass --keep-notifications for the final move.
--restore-point N reads the business tables from that restore point (app_private.rpN_*) instead of the live ones
(users and settings still come from the live tables).
The output holds customer data: keep it out of git and delete it after loading.
"""
import datetime as dt
import decimal
import json
import sys
import uuid
import zoneinfo
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from db_connect import connect  # noqa: E402

IST = zoneinfo.ZoneInfo("Asia/Kolkata")

# (mysql table, postgres select). Column names are the same on both sides.
TABLES = [
    ("import_batches", "select * from public.import_batches order by id"),
    ("legacy_accounts", "select * from public.legacy_accounts order by id"),
    ("zones", "select * from public.zones order by id"),
    ("receipt_series", "select * from public.receipt_series order by id"),
    ("legacy_payments", "select * from public.legacy_payments order by id"),
    ("borrowers", "select * from public.borrowers order by id"),
    ("loans", "select * from public.loans order by id"),
    ("payments", "select * from public.payments order by id"),
    ("pending_payments", "select * from public.pending_payments order by id"),
    ("adjustments", "select * from public.adjustments order by id"),
    ("seizures", "select * from public.seizures order by id"),
    ("receipt_books", "select * from public.receipt_books order by id"),
    ("cash_closings", "select * from public.cash_closings order by id"),
    ("collection_assignments", "select * from public.collection_assignments order by id"),
    ("visit_remarks", "select * from public.visit_remarks order by id"),
    ("data_audit", "select * from public.data_audit order by id"),
]
SKIP_COLUMNS = {"legacy_accounts": {"search_text"}}  # generated in MySQL


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, decimal.Decimal)):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, dt.datetime):
        if v.tzinfo is not None:
            v = v.astimezone(IST).replace(tzinfo=None)
        return "'" + v.isoformat(sep=" ") + "'"
    if isinstance(v, dt.date):
        return "'" + v.isoformat() + "'"
    if isinstance(v, uuid.UUID):
        return "'" + str(v) + "'"
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False, default=str)
    s = str(v).replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r").replace("\x00", "")
    return "'" + s + "'"


def dump(cur, out, table, query):
    cur.execute(query)
    cols = [d.name for d in cur.description]
    keep = [i for i, c in enumerate(cols) if c not in SKIP_COLUMNS.get(table, set())]
    names = ", ".join(f"`{cols[i]}`" for i in keep)
    rows = cur.fetchall()
    for start in range(0, len(rows), 500):
        chunk = rows[start:start + 500]
        values = ",\n".join("(" + ", ".join(lit(r[i]) for i in keep) + ")" for r in chunk)
        out.write(f"insert into `{table}` ({names}) values\n{values};\n")
    return len(rows)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    keep_notifications = "--keep-notifications" in sys.argv
    rp = sys.argv[sys.argv.index("--restore-point") + 1] if "--restore-point" in sys.argv else None
    target = Path(sys.argv[1])
    counts = {}
    with connect() as conn, target.open("w", encoding="utf-8", newline="\n") as out:
        cur = conn.cursor()
        out.write("set names utf8mb4;\nset time_zone = '+05:30';\nset foreign_key_checks = 0;\n")
        for t in ["data_audit", "visit_remarks", "collection_assignments", "cash_closings", "receipt_books", "seizures",
                  "adjustments", "pending_payments", "payments", "loans", "borrowers", "legacy_payments", "receipt_series",
                  "zones", "legacy_accounts", "import_batches", "sessions", "users"]:
            out.write(f"delete from `{t}`;\n")

        # users: the auth login (email + bcrypt hash) joined with the staff row
        # bcrypt from Supabase is "$2a$"; PHP / Laravel read the same hash as "$2y$" (same algorithm, other prefix)
        cur.execute("""select s.user_id, u.email, regexp_replace(u.encrypted_password, '^[$]2a[$]', '$2y$'), s.full_name, s.role, s.active, to_jsonb(s.permissions),
                              s.force_logout_at, s.archived_at, u.last_sign_in_at, s.created_at
                         from public.staff s join auth.users u on u.id = s.user_id order by s.created_at""")
        users = cur.fetchall()
        for r in users:
            out.write("insert into users (id, email, password, full_name, role, active, permissions, force_logout_at, archived_at,"
                      " last_sign_in_at, created_at, updated_at) values (" + ", ".join(lit(x) for x in r) + f", {lit(r[-1])});\n")
        counts["users"] = len(users)

        for table, query in TABLES:
            if rp and table != "data_audit":
                query = query.replace(f"public.{table} ", f"app_private.rp{int(rp)}_{table} ")
            counts[table] = dump(cur, out, table, query)

        cur.execute("select * from public.app_settings where id = 1")
        cols = [d.name for d in cur.description]
        row = dict(zip(cols, cur.fetchone()))
        if not keep_notifications:
            row.update(telegram_enabled=False, whatsapp_enabled=False, telegram_bot_token=None, whatsapp_api_key=None)
        sets = ", ".join(f"`{k}` = {lit(v)}" for k, v in row.items() if k != "id")
        out.write(f"update app_settings set {sets} where id = 1;\n")
        out.write("set foreign_key_checks = 1;\n")
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
