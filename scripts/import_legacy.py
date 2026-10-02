"""Import the 4 legacy files into Supabase.

Usage (from the project root):
    python scripts/import_legacy.py            # first import; refuses if data already exists
    python scripts/import_legacy.py --replace  # wipe legacy tables and re-import (one transaction)

Everything happens in ONE transaction: if any check fails, nothing is written.
Money is handled with Decimal parsed from the original text - never floats.
"""
import re
import sys
import pathlib
from datetime import date
from decimal import Decimal
from collections import Counter

from psycopg.types.json import Jsonb

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "analysis" / "phase1" / "tools"))
sys.path.insert(0, str(ROOT / "scripts"))

import extract_accounts      # noqa: E402
import extract_installments  # noqa: E402
from db_connect import connect  # noqa: E402

FILES = {
    "F_ACC": ("F_ACC(1).xlsx", "closed"),
    "P_ACCOUNT": ("P_ACCOUNT(1).xlsx", "pending"),
    "F_INSMENT": ("F_INSMENT(1).xlsx", "closed"),
    "P_INSMENT": ("P_INSMENT.xlsx", "pending"),
}
MOBILE = re.compile(r"^[6-9]\d{9}$")
SUSPECT_BEFORE = date(2015, 1, 1)


def clean(v):
    return v.replace("\x7f", " ").strip() if isinstance(v, str) else v


def text(v):
    v = clean(v)
    return v or None


def money(v):
    v = clean(v)
    return Decimal(v) if v else None


def integer(v):
    v = clean(v)
    return int(v) if v and re.fullmatch(r"-?\d+", v) else None


def ymd(v):
    v = clean(v)
    if not v:
        return None
    try:
        return date(int(v[:4]), int(v[4:6]), int(v[6:8]))
    except ValueError:
        return None


def receipt_no(raw):
    # RNO is a 4-byte little-endian integer; the dump kept only bytes >= 0x20.
    # Exactly two surviving bytes = the full value (verified against the old app: 22509, 33149).
    if raw and len(raw) == 2 and "\x01" not in raw:
        return ord(raw[0]) + ord(raw[1]) * 256
    return None


def raw_json(rec):
    out = {}
    for k, v in rec.items():
        if k in ("RNO_raw", "IM_raw"):
            out[k + "_hex"] = " ".join(f"{ord(c):02X}" for c in v)
        elif isinstance(v, str):
            out[k] = clean(v)
        else:
            out[k] = v
    return out


def build_accounts():
    accounts, skipped = [], []
    for key in ("F_ACC", "P_ACCOUNT"):
        fname, ledger = FILES[key]
        recs, _ = extract_accounts.run(str(ROOT / fname))
        seen = {}
        for r in recs:
            sno = integer(r["SNO"])
            if sno in seen:
                if raw_json(r) | {"src_index": 0} == raw_json(seen[sno]) | {"src_index": 0}:
                    skipped.append((key, r["src_index"], sno, "exact duplicate of an earlier record"))
                    continue
                raise SystemExit(f"{key}: SNO {sno} appears twice with different data - stop and review")
            seen[sno] = r
            accounts.append((key, ledger, r))
    return accounts, skipped


def account_row(key, ledger, r, fno_counts):
    flags = []
    famt, iamt, aamt, hpamt, tamt = (money(r[k]) for k in ("FAMT", "IAMT", "AAMT", "HPAMT", "TAMT"))
    if famt is not None and famt <= 1:
        flags.append("test_or_zero_amount")
    if tamt != famt + iamt + aamt + hpamt:
        flags.append("total_not_equal_parts")
    if r["recovery"] in ("AMBIGUOUS", "PARTIAL"):
        flags.append("address_or_contact_uncertain")
    mob = text(r["BMNO1"])
    if mob and not MOBILE.match(mob):
        flags.append("mobile_invalid")
    if not mob:
        flags.append("mobile_missing")
    fno = integer(r["FNO"])
    if fno_counts[fno] > 1:
        flags.append("fno_shared")
    adate = ymd(r["ADATE"])
    if adate is None:
        flags.append("agreement_date_invalid")
    sez = clean(r["SEZIED"])
    return dict(
        ledger=ledger, sno=integer(r["SNO"]), fno=fno, fcode=text(r["FCODE"]),
        borrower_name=text(r["BNAME"]) or "(blank)", borrower_father=text(r["BFNAME"]),
        borrower_address=text(r["BADD"]), borrower_mobile=mob, borrower_mobile2=text(r["BMNO2"]),
        guarantor_name=text(r["GNAME"]), guarantor_father=text(r["GFNAME"]), guarantor_address=text(r["GADD"]),
        guarantor_mobile=text(r["GMNO1"]), guarantor_mobile2=text(r["GMNO2"]),
        finance_mode=text(r["BCODE"]), zone=text(r["ZONE"]),
        vehicle_condition=text(r["NU"]), vehicle_model=text(r["MODEL"]), vehicle_variant=text(r["COLOR"]),
        chassis_no=text(r["CNO"]), engine_no=text(r["ENO"]), model_year=integer(r["MAKE"]) or None,
        registration_no=text(r["VNO"]), agreement_date=adate,
        tenure_months=integer(r["TMONTHS"]), interval_months=integer(r["PIVAL"]),
        finance_amount=famt, interest_amount=iamt, agreement_amount=aamt, hp_amount=hpamt,
        total_amount=tamt, emi_amount=money(r["IRATE"]),
        seized=True if sez == "T" else False if sez == "F" else None,
        data_flags=flags, recovery=r["recovery"], raw=Jsonb(raw_json(r) | {"source_file": FILES[key][0]}),
    )


def payment_row(key, ledger, r, acct):
    flags = []
    sno = integer(r["SNO"])
    due, paid = ymd(r["DDATE"]), ymd(r["PDATE"])
    if acct is None:
        flags.append("no_matching_account")
    elif acct["ledger"] != ledger:
        flags.append("account_in_other_ledger")
    if (due and due < SUSPECT_BEFORE) or (paid and paid < SUSPECT_BEFORE):
        flags.append("date_suspect")
    rno = receipt_no(r["RNO_raw"])
    if rno is None:
        flags.append("receipt_no_unrecoverable")
    bal = money(r["BAMT"])
    if bal is None:
        flags.append("balance_blank")
    elif bal < 0:
        flags.append("negative_balance")
    return dict(
        ledger=ledger, sno=sno, account_id=acct["id"] if acct else None,
        installment_no=integer(r["INO"]), due_amount=money(r["IAMT"]), due_date=due,
        paid_amount=money(r["PAMT"]), paid_date=paid, balance_after=bal,
        delay_days=integer(r["DDAYS"]), payment_mode=text(r["BCODE"]), cheque_no=text(r["CHNO"]),
        receipt_no=rno, data_flags=flags, raw=Jsonb(raw_json(r) | {"source_file": FILES[key][0]}),
    )


def insert(cur, table, rows, batch_id):
    cols = list(rows[0].keys()) + ["import_batch_id"]
    sql = f"insert into public.{table} ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) returning id, sno"
    ids = {}
    for row in rows:
        cur.execute(sql, list(row.values()) + [batch_id])
        rid, sno = cur.fetchone()
        ids[sno] = rid
    return ids


def new_batch(cur, key, total, imported, skipped, flagged, notes):
    cur.execute(
        "insert into public.import_batches (source_file, imported_by, total_records, imported_records,"
        " skipped_records, flagged_records, status, notes) values (%s,%s,%s,%s,%s,%s,'completed',%s) returning id",
        (FILES[key][0], "scripts/import_legacy.py", total, imported, skipped, flagged, Jsonb(notes)),
    )
    return cur.fetchone()[0]


def main():
    replace = "--replace" in sys.argv
    print("parsing account files ...")
    accounts, skipped = build_accounts()
    fno_counts = Counter(integer(r["FNO"]) for _, _, r in accounts)
    print("parsing installment files ...")
    payments = []
    for key in ("F_INSMENT", "P_INSMENT"):
        recs, issues, _ = extract_installments.run(str(ROOT / FILES[key][0]))
        if issues:
            raise SystemExit(f"{key}: {sum(issues.values())} rows could not be parsed - stop")
        payments += [(key, FILES[key][1], r) for r in recs]

    with connect() as conn, conn.cursor() as cur:
        existing = cur.execute("select count(*) from public.legacy_accounts").fetchone()[0]
        if existing and not replace:
            raise SystemExit(f"legacy_accounts already has {existing} rows - use --replace to re-import")
        if replace:
            cur.execute("delete from public.legacy_payments; delete from public.legacy_accounts; delete from public.import_batches;")

        sno_to_acct = {}
        for key in ("F_ACC", "P_ACCOUNT"):
            rows = [account_row(k, l, r, fno_counts) for k, l, r in accounts if k == key]
            sk = [s for s in skipped if s[0] == key]
            bid = new_batch(cur, key, len(rows) + len(sk), len(rows), len(sk),
                            sum(1 for r in rows if r["data_flags"]),
                            {"skipped": [{"src_index": s[1], "sno": s[2], "reason": s[3]} for s in sk],
                             "recovery": dict(Counter(r["recovery"] for r in rows))})
            ledger = FILES[key][1]
            for sno, rid in insert(cur, "legacy_accounts", rows, bid).items():
                sno_to_acct[sno] = {"id": rid, "ledger": ledger}
            print(f"  {key}: {len(rows)} accounts imported, {len(sk)} skipped")

        for key in ("F_INSMENT", "P_INSMENT"):
            rows = [payment_row(k, l, r, sno_to_acct.get(integer(r["SNO"]))) for k, l, r in payments if k == key]
            bid = new_batch(cur, key, len(rows), len(rows), 0, sum(1 for r in rows if r["data_flags"]),
                            {"flags": dict(Counter(f for r in rows for f in r["data_flags"]))})
            cols = list(rows[0].keys()) + ["import_batch_id"]
            cur.executemany(
                f"insert into public.legacy_payments ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})",
                [list(r.values()) + [bid] for r in rows],
            )
            print(f"  {key}: {len(rows)} payments imported")

        # ---- verification against the source files (inside the transaction) ----
        problems = []
        for ledger, key in (("closed", "F_ACC"), ("pending", "P_ACCOUNT")):
            src = [r for k, _, r in accounts if k == key]
            db_n, db_total = cur.execute(
                "select count(*), coalesce(sum(total_amount),0) from public.legacy_accounts where ledger=%s", (ledger,)
            ).fetchone()
            src_total = sum(money(r["TAMT"]) for r in src)
            if db_n != len(src) or db_total != src_total:
                problems.append(f"{key}: db {db_n}/{db_total} vs source {len(src)}/{src_total}")
            print(f"  check {key}: {db_n} accounts, total payable {db_total} (source {src_total})")
        for ledger, key in (("closed", "F_INSMENT"), ("pending", "P_INSMENT")):
            src = [r for k, _, r in payments if k == key]
            db_n, db_paid = cur.execute(
                "select count(*), coalesce(sum(paid_amount),0) from public.legacy_payments where ledger=%s", (ledger,)
            ).fetchone()
            src_paid = sum(money(r["PAMT"]) for r in src)
            if db_n != len(src) or db_paid != src_paid:
                problems.append(f"{key}: db {db_n}/{db_paid} vs source {len(src)}/{src_paid}")
            print(f"  check {key}: {db_n} payments, total paid {db_paid} (source {src_paid})")
        if problems:
            conn.rollback()
            raise SystemExit("VERIFICATION FAILED - nothing was saved:\n  " + "\n  ".join(problems))
        conn.commit()
        print("committed.")


if __name__ == "__main__":
    main()
