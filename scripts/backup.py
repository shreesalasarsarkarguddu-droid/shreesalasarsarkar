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


def describe(url):
    """host / port / user of the secret, never the password (for the error message)"""
    try:
        i = psycopg.conninfo.conninfo_to_dict(url)
        return "host=%s port=%s user=%s password=%s" % (i.get("host"), i.get("port"), i.get("user"), "set" if i.get("password") else "MISSING")
    except Exception as e:
        return "the secret is not a valid connection URL (%s)" % type(e).__name__


def open_password(password):
    """Just the database password (no URL, nothing to encode): connect through the pooler."""
    from db_connect import REF
    last = None
    for h in POOLERS:
        try:
            conn = psycopg.connect(host=h, port=5432, dbname="postgres", user=f"postgres.{REF}", password=password,
                                   connect_timeout=8, sslmode="require")
            print("connected via", h)
            return conn
        except Exception as e:
            last = e
            if "password authentication failed" in str(e):
                break  # right server, wrong password: no point trying the others
    raise last or RuntimeError("no pooler reachable")


pw = os.environ.get("DB_PASSWORD")
if pw:
    try:
        conn = open_password(pw)
    except Exception as e:
        print("::error::Could not connect to the database with BACKUP_DB_PASSWORD: %s" % (str(e).splitlines()[0] if str(e) else type(e).__name__))
        sys.exit(1)
elif url:
    try:
        conn = open_url(url)
    except Exception as e:
        msg = str(e).splitlines()[0] if str(e) else type(e).__name__
        # ::error:: lines show up as annotations on the GitHub run page
        print("::error::Could not connect to the database: %s [%s]" % (msg, describe(url)))
        sys.exit(1)
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
