"""Reference numbers from the live Supabase database, to check the Laravel maths against (php artisan sss:parity FILE).

    python SSS/scripts/pg_parity.py OUT.json [sample_size]

For a sample of open accounts it posts a test payment of one EMI with app_private.post_payment inside a transaction that is
rolled back (nothing is saved), and records the number, due date, EMI, balance and delay it got. It also records every row of
the all_accounts view (balance, paid, payments count, seized, closed). The output holds customer data: delete it after use.
"""
import json
import random
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from db_connect import connect  # noqa: E402


def main():
    out_path = Path(sys.argv[1])
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 150
    res = {"next_payment": [], "all_accounts": []}
    with connect() as conn:
        cur = conn.cursor()
        today = cur.execute("select (now() at time zone 'Asia/Kolkata')::date").fetchone()[0].isoformat()
        admin = cur.execute("select user_id from public.staff where role = 'admin' order by created_at limit 1").fetchone()[0]
        old = [r[0] for r in cur.execute("""select a.sno from public.legacy_accounts a
                    where a.ledger = 'pending' and not public.legacy_settled(a.id) and a.emi_amount > 0""").fetchall()]
        new = [r[0] for r in cur.execute("select id from public.loans where status in ('active', 'seized')").fetchall()]
        random.seed(7)
        sample = [("old", s) for s in random.sample(old, min(size, len(old)))] + [("new", i) for i in new]
        conn.commit()
        for source, ref in sample:
            emi = cur.execute("select emi_amount from public.legacy_accounts where sno = %s" if source == "old"
                              else "select emi_amount from public.loans where id = %s", (ref,)).fetchone()[0]
            p = {"source": source, "ref_id": ref, "paid_amount": str(emi), "paid_date": today, "payment_mode": "CASH",
                 "receipt_no": 990000000 + random.randint(0, 9999999), "installments_covered": 1, "idempotency_key": str(uuid.uuid4())}
            try:
                cur.execute("set local app.restoring = 'on'")  # no Telegram / audit triggers
                row = cur.execute("select installment_no, due_date, due_amount, balance_after, delay_days from app_private.post_payment(%s::jsonb, %s, now())",
                                  (json.dumps(p), admin)).fetchone()
                res["next_payment"].append({"source": source, "ref": ref, "amount": str(emi), "paid_date": today,
                                            "installment_no": row[0], "due_date": row[1].isoformat() if row[1] else None,
                                            "due_amount": str(row[2]), "balance_after": str(row[3]), "delay_days": row[4]})
            finally:
                conn.rollback()
        for r in cur.execute("""select source, ref_id, ledger, payments_count, seized, total_amount::text, emi_amount::text,
                                       total_paid::text, balance::text from public.all_accounts""").fetchall():
            res["all_accounts"].append(dict(zip(["source", "ref_id", "ledger", "payments_count", "seized", "total_amount", "emi_amount",
                                                 "total_paid", "balance"], r)))
        conn.rollback()
    out_path.write_text(json.dumps(res, default=str), encoding="utf-8")
    print(len(res["next_payment"]), "test payments,", len(res["all_accounts"]), "accounts")


if __name__ == "__main__":
    main()
