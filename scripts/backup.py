"""Full data backup: one CSV per table (public schema) + login emails, zipped.

Usage:  DATABASE_URL=postgresql://... python scripts/backup.py out.zip
Without DATABASE_URL it uses .env.local like the other scripts.
Restore: the schema is in supabase/migrations; load each CSV with COPY ... FROM ... CSV HEADER.
"""
import io
import os
import sys
import zipfile
import datetime
import psycopg

out = sys.argv[1] if len(sys.argv) > 1 else "backup.zip"
url = os.environ.get("DATABASE_URL")
if url:
    conn = psycopg.connect(url, connect_timeout=20, sslmode="require")
else:
    from db_connect import connect
    conn = connect()

with conn, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    tables = [r[0] for r in conn.execute(
        "select tablename from pg_tables where schemaname = 'public' order by 1").fetchall()]
    summary = []
    for t in tables:
        buf = io.BytesIO()
        with conn.cursor().copy(f'copy (select * from public."{t}") to stdout with (format csv, header true)') as cp:
            for chunk in cp:
                buf.write(bytes(chunk))
        z.writestr(f"{t}.csv", buf.getvalue())
        n = conn.execute(f'select count(*) from public."{t}"').fetchone()[0]
        summary.append((t, n))
    # who can log in (no passwords)
    buf = io.BytesIO()
    with conn.cursor().copy("copy (select id, email, created_at from auth.users) to stdout with (format csv, header true)") as cp:
        for chunk in cp:
            buf.write(bytes(chunk))
    z.writestr("auth_users.csv", buf.getvalue())
    z.writestr("README.txt", "Backup taken %s UTC\n\n%s\n" % (
        datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M"),
        "\n".join(f"{t}: {n} rows" for t, n in summary)))
    print("\n".join(f"{t}: {n} rows" for t, n in summary))
print("wrote", out, os.path.getsize(out) // 1024, "KB")
