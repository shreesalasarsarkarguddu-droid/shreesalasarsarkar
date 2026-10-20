"""Reference reports from the live Supabase database, to check the Laravel ports (php artisan sss:reports-parity FILE).

    python SSS/scripts/pg_reports_parity.py OUT.json DAY [--restore-point N]

Writes: due_report for DAY, DAY-3 months and DAY+5 months; dashboard(DAY); staff_performance for DAY's month;
day_book_entries + day_book_opening for DAY's month; seized_accounts. Runs as the first admin (permission checks).
--restore-point N: inside one transaction the restore point's rows are put into the (empty) live tables, everything is read,
then rolled back - nothing is kept, no notifications are sent. The output holds customer data: delete it after use.
"""
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from db_connect import connect  # noqa: E402

DUE = ["source", "ref_id", "folio", "borrower_name", "vehicle_model", "mobile", "vehicle_no", "seized", "search_text", "emi", "balance",
       "arrears", "overdue_emis", "due_emis", "next_due", "agreement_date", "tenure", "finance_amount", "interest_amount",
       "other_charges", "total_amount", "total_paid", "last_paid", "late_days"]
DAYBOOK = ["entry_date", "kind", "particulars", "folio", "due_amount", "due_date", "delay_days", "im", "mode", "receipt_no", "debit",
           "credit", "source", "ref_id", "receipt_book"]
SEIZED = ["source", "ref_id", "folio", "ledger", "borrower_name", "mobile", "vehicle_model", "vehicle_no", "total_amount", "total_paid",
          "balance", "seized_on", "remarks", "from_old_software", "search_text"]
TABLES = ["import_batches", "legacy_accounts", "zones", "receipt_series", "legacy_payments", "borrowers", "loans", "payments",
          "pending_payments", "adjustments", "seizures", "receipt_books", "cash_closings"]


def add_months(d, n):
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    import calendar
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


args = sys.argv[1:]
rp = None
if "--restore-point" in args:
    i = args.index("--restore-point")
    rp = int(args[i + 1])
    del args[i:i + 2]
out_path, day = Path(args[0]), dt.date.fromisoformat(args[1])
m0 = day.replace(day=1)
m_end = add_months(m0, 1) - dt.timedelta(days=1)

out = {}
with connect() as conn:
    conn.execute("set local app.restoring = 'on'")
    admin = conn.execute("select user_id from public.staff where role = 'admin' order by created_at limit 1").fetchone()[0]
    if rp:
        for t in TABLES:
            cols = [r[0] for r in conn.execute("""select column_name from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = %s and c.is_generated = 'NEVER'
                       and exists (select 1 from information_schema.columns x where x.table_schema = 'app_private'
                                    and x.table_name = %s and x.column_name = c.column_name) order by ordinal_position""",
                                                  (t, f"rp{rp}_{t}")).fetchall()]
            names = ", ".join(cols)
            extra = f" where id not in (select id from public.{t})"  # rows still in the live table stay as they are
            conn.execute(f"insert into public.{t} ({names}) overriding system value select {names} from app_private.rp{rp}_{t}{extra}")
    conn.execute("delete from app_private.dashboard_cache")
    conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": str(admin), "role": "authenticated", "iat": 9999999999}),))
    conn.execute("set local role authenticated")
    out["due"] = {}
    for d in (day, add_months(day, -3), add_months(day, 5)):
        rows = conn.execute(f"select {', '.join(DUE)} from public.due_report(%s)", (d,)).fetchall()
        out["due"][d.isoformat()] = [dict(zip(DUE, r)) for r in rows]
    out["dashboard"] = {"day": day.isoformat(), "data": conn.execute("select public.dashboard(%s)", (day,)).fetchone()[0]}
    cur = conn.execute("select * from public.staff_performance(%s, %s)", (m0, m_end))
    out["staff_performance"] = {"from": m0.isoformat(), "to": m_end.isoformat(),
                                "rows": [dict(zip([c.name for c in cur.description], r)) for r in cur.fetchall()]}
    rows = conn.execute(f"select {', '.join(DAYBOOK)} from public.day_book_entries where entry_date between %s and %s "
                        "order by entry_date, kind_order, particulars, ref_id", (add_months(m0, -1), m_end)).fetchall()
    out["day_book"] = {"from": add_months(m0, -1).isoformat(), "to": m_end.isoformat(), "rows": [dict(zip(DAYBOOK, r)) for r in rows],
                       "opening": [str(x) for x in conn.execute("select * from public.day_book_opening(%s)", (add_months(m0, -1),)).fetchone()]}
    out["seized"] = [dict(zip(SEIZED, r)) for r in conn.execute(f"select {', '.join(SEIZED)} from public.seized_accounts").fetchall()]
    conn.rollback()
out_path.write_text(json.dumps(out, default=str), encoding="utf-8")
print({"due": {k: len(v) for k, v in out["due"].items()}, "day_book": len(out["day_book"]["rows"]), "seized": len(out["seized"]),
       "staff": len(out["staff_performance"]["rows"])})
