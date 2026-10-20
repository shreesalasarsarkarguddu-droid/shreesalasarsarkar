"""public.due_report rows from the live Supabase database for some days, to check DueReport.php (php artisan sss:due-parity FILE).

    python SSS/scripts/pg_due_parity.py OUT.json 2026-10-20 2026-07-20 2027-03-01 [--restore-point N]

--restore-point N: compute on that restore point's data. Inside one transaction the restore point's rows are put into the
(empty) live tables, the report is read, and everything is rolled back - nothing is kept, no notifications are sent.

The output holds customer data: delete it after use.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from db_connect import connect  # noqa: E402

COLS = ["source", "ref_id", "folio", "borrower_name", "vehicle_model", "mobile", "vehicle_no", "seized", "search_text", "emi", "balance",
        "arrears", "overdue_emis", "due_emis", "next_due", "agreement_date", "tenure", "finance_amount", "interest_amount",
        "other_charges", "total_amount", "total_paid", "last_paid", "late_days"]

TABLES = ["import_batches", "legacy_accounts", "zones", "receipt_series", "legacy_payments", "borrowers", "loans", "payments",
          "pending_payments", "adjustments", "seizures"]
args = sys.argv[2:]
rp = None
if "--restore-point" in args:
    i = args.index("--restore-point")
    rp = int(args[i + 1])
    del args[i:i + 2]

out = {}
with connect() as conn:
    if rp:
        conn.execute("set local app.restoring = 'on'")
        for t in TABLES:
            if conn.execute(f"select count(*) from public.{t}").fetchone()[0] and t not in ("zones", "receipt_series"):
                raise SystemExit(f"public.{t} is not empty; refusing")
            cols = [r[0] for r in conn.execute("""select column_name from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = %s and c.is_generated = 'NEVER'
                       and exists (select 1 from information_schema.columns x where x.table_schema = 'app_private'
                                    and x.table_name = %s and x.column_name = c.column_name) order by ordinal_position""",
                                                  (t, f"rp{rp}_{t}")).fetchall()]
            names = ", ".join(cols)
            if t in ("zones", "receipt_series"):
                conn.execute(f"insert into public.{t} ({names}) overriding system value select {names} from app_private.rp{rp}_{t} "
                             f"where id not in (select id from public.{t})")
            else:
                conn.execute(f"insert into public.{t} ({names}) overriding system value select {names} from app_private.rp{rp}_{t}")
    for day in args:
        rows = conn.execute(f"select {', '.join(COLS)} from public.due_report(%s)", (day,)).fetchall()
        out[day] = [dict(zip(COLS, r)) for r in rows]
    conn.rollback()
Path(sys.argv[1]).write_text(json.dumps(out, default=str), encoding="utf-8")
print({d: len(v) for d, v in out.items()})
