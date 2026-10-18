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

# Supabase's direct address (db.<ref>.supabase.co) is IPv6-only and GitHub's runners have no IPv6,
# so when it cannot be reached, connect through the session pooler (IPv4) with the same password.
POOLERS = [f"{p}-{r}.pooler.supabase.com" for p in ("aws-0", "aws-1") for r in (
    "ap-southeast-1", "ap-south-1", "ap-northeast-1", "ap-northeast-2", "ap-southeast-2", "us-east-1", "us-east-2",
    "us-west-1", "eu-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "ca-central-1", "sa-east-1", "eu-north-1", "eu-central-2")]


def open_url(url):
    try:
        return psycopg.connect(url, connect_timeout=20, sslmode="require")
    except Exception as first:
        info = psycopg.conninfo.conninfo_to_dict(url)
        host = info.get("host", "")
        if not (host.startswith("db.") and host.endswith(".supabase.co")):
            raise
        ref = host.split(".")[1]
        print("direct address not reachable (%s); trying the pooler" % str(first).splitlines()[0])
        for h in POOLERS:
            try:
                conn = psycopg.connect(host=h, port=5432, dbname=info.get("dbname", "postgres"), user=f"postgres.{ref}",
                                       password=info.get("password"), connect_timeout=8, sslmode="require")
                print("connected via", h)
                return conn
            except Exception:
                continue
        raise first


if url:
    conn = open_url(url)
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
