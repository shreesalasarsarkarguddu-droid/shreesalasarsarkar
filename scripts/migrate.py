"""Apply supabase/migrations/*.sql in order, each once, each in its own transaction."""
import pathlib
from db_connect import connect

MIGRATIONS = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "migrations"

with connect() as conn:
    conn.execute("create schema if not exists app_private")
    conn.execute("create table if not exists app_private.applied_migrations (name text primary key, applied_at timestamptz not null default now())")
    conn.commit()
    done = {r[0] for r in conn.execute("select name from app_private.applied_migrations")}
    for f in sorted(MIGRATIONS.glob("*.sql")):
        if f.name in done:
            print("skip   ", f.name)
            continue
        with conn.transaction():
            conn.execute(f.read_text(encoding="utf-8"))
            conn.execute("insert into app_private.applied_migrations (name) values (%s)", (f.name,))
        print("applied", f.name)
