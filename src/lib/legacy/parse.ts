// Rebuilds accounts and receipts from the old software's 4 export files.
// This is a line-by-line port of analysis/phase1/tools/extract_accounts.py, extract_installments.py and the row
// builders in scripts/import_legacy.py (the code that made the data in the database today). It was checked to give
// exactly the same rows for the original files. Python string semantics (strip, isdigit, slicing) are copied on
// purpose — do not "simplify" them.
//
// Anything unexpected throws an ImportError: the import is refused rather than guessed.

import { readDumpCells } from "./xlsx";

export class ImportError extends Error {}

// ---------------------------------------------------------------- Python string helpers
// str.strip() whitespace set
const PY_WS = new Set([..."\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0                　"]);
function pyStrip(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && PY_WS.has(s[a])) a++;
  while (b > a && PY_WS.has(s[b - 1])) b--;
  return s.slice(a, b);
}
const ND = /^\p{Nd}$/u;
const PY_DIGIT_EXTRA = new Set([..."²³¹⁰⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉①②③④⑤⑥⑦⑧⑨"]);
const isdigit = (c: string | undefined) => c !== undefined && (ND.test(c) || PY_DIGIT_EXTRA.has(c));
const isalpha = (c: string | undefined) => c !== undefined && /^\p{L}$/u.test(c);
/** s[i] that throws like Python's IndexError instead of returning undefined */
function at(s: string, i: number): string {
  const j = i < 0 ? s.length + i : i;
  if (j < 0 || j >= s.length) throw new ImportError("A record is shorter than expected.");
  return s[j];
}
const sp = (n: number) => " ".repeat(Math.max(0, n));
const D = "\\p{Nd}";

// ---------------------------------------------------------------- accounts (extract_accounts.py)
const FIELDS: [string, number, number][] = [["DEL",0,1],["SNO",1,5],["FCODE",6,3],["FNO",9,5],["PNO",14,6],["ZONE",20,20],["FINANCER",40,40],["BCODE",80,5],["BNAME",85,40],["BFNAME",125,40],["BVCP",165,20],["BTAH",185,20],["BDISTT",205,20],["BSTATE",225,20],["BADD",245,254],["BSMS1",499,1],["BMNO1",500,22],["BSMS2",522,1],["BMNO2",523,11],["GNAME",534,40],["GFNAME",574,40],["GVCP",614,20],["GTAH",634,20],["GDISTT",654,20],["GSTATE",674,20],["GADD",694,254],["GMNO1",948,22],["GMNO2",970,11],["NU",981,4],["SBY",985,5],["MODEL",990,20],["COLOR",1010,10],["CNO",1020,20],["ENO",1040,20],["MAKE",1060,4],["VNO",1064,14],["KNO",1078,10],["ADATE",1088,8],["IEDATE",1096,8],["TMONTHS",1104,4],["PIVAL",1108,2],["FAMT",1110,12],["IAMT",1122,12],["AAMT",1134,12],["HPAMT",1146,12],["TAMT",1158,12],["IRATE",1170,12],["SEZIED",1182,1],["ACTIVE",1183,1]];
const R = 1184;

function midOk(m: string): boolean {
  return (
    " 01".includes(at(m, 0)) &&
    " 01".includes(at(m, 23)) &&
    new RegExp(`^[${D} ]*$`, "u").test(m.slice(1, 23)) &&
    new RegExp(`^[${D} ]*$`, "u").test(m.slice(24, 35)) &&
    /^[A-Za-z0-9 .,/()&'-]*$/.test(m.slice(35, 195))
  );
}

export type Rec = Record<string, unknown>;

function noAstral(s: string) {
  if (/[\ud800-\udfff]/.test(s)) throw new ImportError("The file contains characters the old software cannot have written.");
}

export function extractAccounts(file: Uint8Array): Rec[] {
  const s = readDumpCells(file).join("\x01");
  noAstral(s);
  const i = s.indexOf("ACTIVEN");
  if (i < 0) throw new ImportError("This does not look like an account file (P_ACCOUNT / F_ACC).");
  const data = s.slice(i + 9).replace(/^\x01+/, "");
  let clean = "";
  const marks: number[] = [];
  for (const ch of data) {
    if (ch === "\x01") marks.push(clean.length);
    else clean += ch;
  }
  const END = new RegExp(`(?:${D}{8}| {8})(?:${D}{8}| {8})[ ${D}]{4}[ ${D}]{2}(?:[ ${D}-]{9}\\.${D}${D}){6}[TF ?][ ${D}]`, "gu");
  const ends = [...clean.matchAll(END)].map((m) => m.index! + m[0].length);
  const starts = [0, ...ends];
  const out: Rec[] = [];
  let r: string | null = null;
  for (let k = 0; k < ends.length; k++) {
    const a = starts[k];
    const b = ends[k];
    const seg = clean.slice(a, b);
    const ms = marks.filter((x) => a < x && x < b).map((x) => x - a);
    const miss = R - seg.length;
    const q: Rec = { src_index: k + 1, lost_bytes: miss, split_points: ms };
    if (miss === 0) {
      r = seg;
      q.recovery = "exact";
    } else {
      const valid = (x: number) => {
        if (x < 0 || x > miss) return false;
        if (ms.some((p) => 499 - x <= p && p < 694 - x)) return false;
        if (x > 254) return false;
        return midOk(seg.slice(499 - x, 694 - x));
      };
      const bm0 = ms.filter((p) => p < 499 - miss);
      const gm0 = ms.filter((p) => p >= 694);
      let hyp: number | null = null;
      if (ms.length && bm0.length === ms.length) hyp = miss;
      else if (ms.length && gm0.length === ms.length) hyp = 0;
      let ok: number[];
      if (hyp !== null && valid(hyp)) {
        ok = [hyp];
        q.recovery = "realigned";
      } else {
        ok = [];
        for (let x = 0; x <= miss; x++) if (valid(x)) ok.push(x);
        const vals = new Set(ok.map((x) => seg.slice(499 - x, 694 - x)));
        if (!ok.length) {
          q.recovery = "PARTIAL";
          ok = [Math.min(miss, 254)];
          q.unreliable_fields = "BADD,BSMS1,BMNO1,BSMS2,BMNO2,GNAME,GFNAME,GVCP,GTAH,GDISTT,GSTATE,GADD";
        } else if (vals.size > 1) {
          const score = (x: number) => {
            const m = seg.slice(499 - x, 694 - x);
            return (
              +"01".includes(at(m, 0)) +
              +isdigit(at(m, 1)) +
              +"01".includes(at(m, 23)) +
              +(isdigit(at(m, 24)) || pyStrip(m.slice(24, 35)) === "") +
              +isalpha(at(m, 35)) +
              +(isalpha(at(m, 75)) || pyStrip(m.slice(75, 115)) === "") +
              +(at(m, 34) === " ") +
              +(at(m, 22) === " ")
            );
          };
          // sorted(((score(x), x) ...), reverse=True)
          const sc = ok.map((x) => [score(x), x] as const).sort((p, q2) => q2[0] - p[0] || q2[1] - p[1]);
          const top = sc.filter(([s_]) => s_ === sc[0][0]).map(([, x]) => x);
          if (new Set(top.map((x) => seg.slice(499 - x, 694 - x))).size === 1) {
            ok = top;
            q.recovery = "realigned-scored";
          } else {
            q.recovery = "AMBIGUOUS";
            q.candidates = top;
            ok = top;
            q.unreliable_fields = "BSMS1,BMNO1,BSMS2,BMNO2,GNAME,GFNAME";
          }
        } else q.recovery = "realigned";
      }
      if (ok.length) {
        const x = ok[0];
        const y = miss - x;
        const bm = ms.filter((p) => 245 <= p && p < 499 - x);
        const gm = ms.filter((p) => 694 - x <= p && p <= 948 - miss);
        const bp = Math.min(bm.length ? bm[bm.length - 1] : 499 - x, 499 - x);
        const badd = seg.slice(245, bp) + sp(x) + seg.slice(bp, 499 - x);
        const gp = Math.min((gm.length ? gm[gm.length - 1] : 948 - miss) - (694 - x), 948 - miss - (694 - x));
        const gseg = seg.slice(694 - x, 948 - miss);
        const gadd = gseg.slice(0, gp) + sp(y) + gseg.slice(gp);
        r = seg.slice(0, 245) + badd + seg.slice(499 - x, 694 - x) + gadd + seg.slice(948 - miss);
        q.bytes_restored_in = { BADD: x, GADD: y };
        if (ms.some((p) => p < 245 || 948 - miss <= p)) q.split_outside_address = true;
      }
    }
    if (r !== null) {
      if (r.length !== R) throw new ImportError(`Account record ${k + 1} could not be rebuilt.`);
      for (const [n, o, l] of FIELDS) q[n] = r.slice(o, o + l);
    }
    out.push(q);
  }
  return out;
}

// ---------------------------------------------------------------- installments (extract_installments.py)
const AMT = `(?:[ ${D}-]{9}\\.${D}${D}| {12})`;
const MID = new RegExp(
  `(${D}{8}| {8})([^\\x01]{5})([^\\x01]{12})(${AMT})([\\s\\S]{0,4}?)(${D}{8}| {8})(${AMT})([ ${D}-]{5})(${D}{8}| {8})([^\\x01]{6})([^\\x01]{6})(${D}{8}| {8})([^\\x01]{14})`,
  "gu",
);
const PREFIX = new RegExp(`^([ *])([ ${D}]{7})([^\\n])([ ${D}]{7})([\\s\\S]{0,4})([ ${D}]{4}${D})(${AMT})$`, "u");
const MID_NAMES = ["DDATE", "BCODE", "CHNO", "PAMT", "IM_raw", "PDATE", "BAMT", "DDAYS", "RCPT_DATE", "MODE", "CK_DD_NO", "DATED", "AGAINST"];
const PRE_NAMES = ["DEL", "SNO", "FCODE", "FNO", "RNO_raw", "INO", "IAMT"];

export function extractInstallments(file: Uint8Array): Rec[] {
  const s = readDumpCells(file).join("\x01");
  noAstral(s);
  const i = s.indexOf("AGAINSTC");
  if (i < 0) throw new ImportError("This does not look like an installment file (P_INSMENT / F_INSMENT).");
  const data = s.slice(i + 9).replace(/^\x01+/, "");
  const ms = [...data.matchAll(MID)];
  let prev = 0;
  const out: Rec[] = [];
  let bad = 0;
  ms.forEach((m, k) => {
    let p = data.slice(prev, m.index);
    prev = m.index! + m[0].length;
    if (k > 0) {
      const agTail = p.slice(0, 6);
      p = p.slice(6);
      if (out.length) out[out.length - 1].AGAINST += agTail;
    }
    const q: Rec = { src_index: k + 1 };
    const mm = PREFIX.exec(p);
    if (!mm) bad++;
    else PRE_NAMES.forEach((n, j) => (q[n] = mm[j + 1]));
    MID_NAMES.forEach((n, j) => (q[n] = m[j + 1]));
    out.push(q);
  });
  if (bad) throw new ImportError(`${bad} receipt rows could not be read. Nothing was imported.`);
  if (out.length) out[out.length - 1].AGAINST += data.slice(prev).slice(0, 6);
  return out;
}

// ---------------------------------------------------------------- row builders (import_legacy.py)
const clean = (v: unknown) => (typeof v === "string" ? pyStrip(v.replaceAll("\x7f", " ")) : v);
const text = (v: unknown) => (clean(v) as string) || null;

/** Decimal(...) as an exact string (Python would raise on anything that is not a number) */
function money(v: unknown): string | null {
  const s = clean(v) as string;
  if (!s) return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) throw new ImportError(`"${s}" is not an amount.`);
  return s;
}
/** exact decimal string -> scaled BigInt (paise and below) for comparisons */
function scaled(s: string): bigint {
  const neg = s.startsWith("-");
  const [w, f = ""] = s.replace(/^[+-]/, "").split(".");
  const v = BigInt((w || "0") + f.padEnd(6, "0").slice(0, 6));
  return neg ? -v : v;
}
function integer(v: unknown): number | null {
  const s = clean(v) as string;
  if (!s || !/^-?\d+$/.test(s)) {
    if (s && new RegExp(`^-?${D}+$`, "u").test(s)) throw new ImportError(`Unusual digits in "${s}".`);
    return null;
  }
  return Number.parseInt(s, 10);
}
/** Python int() on a slice: surrounding whitespace, sign and underscores allowed */
function pyInt(s: string): number | null {
  const t = pyStrip(s);
  if (!/^[+-]?\d+(?:_\d+)*$/.test(t)) return null;
  return Number.parseInt(t.replaceAll("_", ""), 10);
}
function ymd(v: unknown): string | null {
  const s = clean(v) as string;
  if (!s) return null;
  const y = pyInt(s.slice(0, 4));
  const m = pyInt(s.slice(4, 6));
  const d = pyInt(s.slice(6, 8));
  if (y === null || m === null || d === null) return null;
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > dim) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function receiptNo(raw: unknown): number | null {
  const s = raw as string | undefined;
  if (s && s.length === 2 && !s.includes("\x01")) return s.charCodeAt(0) + s.charCodeAt(1) * 256;
  return null;
}
function rawJson(rec: Rec): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === "RNO_raw" || k === "IM_raw") {
      out[k + "_hex"] = [...(v as string)].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join(" ");
    } else out[k] = typeof v === "string" ? clean(v) : v;
  }
  return out;
}
const MOBILE = new RegExp(`^[6-9]${D}{9}$`, "u");
const SUSPECT_BEFORE = "2015-01-01";

export type Ledger = "pending" | "closed";
export type FileKey = "F_ACC" | "P_ACCOUNT" | "F_INSMENT" | "P_INSMENT";
export type Files = Record<FileKey, { name: string; bytes: Uint8Array }>;
export const LEDGER: Record<FileKey, Ledger> = { F_ACC: "closed", P_ACCOUNT: "pending", F_INSMENT: "closed", P_INSMENT: "pending" };

export type Parsed = {
  accounts: (Rec & { _file: FileKey })[];
  payments: (Rec & { _file: FileKey })[];
  batches: Record<FileKey, { source_file: string; total: number; imported: number; skipped: number; flagged: number; notes: Rec }>;
  checks: Record<FileKey, { rows: number; total: string }>;
};

function sumMoney(vals: (string | null)[]): string {
  // exact sum of decimal strings, printed with the largest scale used (like Decimal addition)
  let scale = 0;
  for (const v of vals) if (v && v.includes(".")) scale = Math.max(scale, v.split(".")[1].length);
  let t = 0n;
  for (const v of vals) {
    if (v === null) throw new ImportError("An amount is blank.");
    t += scaled(v);
  }
  const neg = t < 0n;
  let digits = (neg ? -t : t).toString().padStart(7, "0");
  digits = digits.slice(0, -6) + "." + digits.slice(-6);
  const [w, f] = digits.split(".");
  return (neg ? "-" : "") + w.replace(/^0+(?=\d)/, "") + (scale ? "." + f.slice(0, scale) : "");
}

function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a, Object.keys(a as object).sort()) === JSON.stringify(b, Object.keys(b as object).sort());
}

export function parseAll(files: Files): Parsed {
  // ---- accounts
  const accRecs: { key: FileKey; ledger: Ledger; r: Rec }[] = [];
  const skipped: { key: FileKey; src_index: unknown; sno: number | null; reason: string }[] = [];
  for (const key of ["F_ACC", "P_ACCOUNT"] as const) {
    const seen = new Map<number | null, Rec>();
    for (const r of extractAccounts(files[key].bytes)) {
      const sno = integer(r.SNO);
      if (seen.has(sno)) {
        if (stableEqual({ ...rawJson(r), src_index: 0 }, { ...rawJson(seen.get(sno)!), src_index: 0 })) {
          skipped.push({ key, src_index: r.src_index, sno, reason: "exact duplicate of an earlier record" });
          continue;
        }
        throw new ImportError(`${files[key].name}: SNO ${sno} appears twice with different details. Nothing was imported.`);
      }
      seen.set(sno, r);
      accRecs.push({ key, ledger: LEDGER[key], r });
    }
  }
  const fnoCounts = new Map<number | null, number>();
  for (const { r } of accRecs) fnoCounts.set(integer(r.FNO), (fnoCounts.get(integer(r.FNO)) ?? 0) + 1);

  const accounts = accRecs.map(({ key, ledger, r }) => {
    const flags: string[] = [];
    const [famt, iamt, aamt, hpamt, tamt] = (["FAMT", "IAMT", "AAMT", "HPAMT", "TAMT"] as const).map((k) => money(r[k]));
    if (famt !== null && scaled(famt) <= scaled("1")) flags.push("test_or_zero_amount");
    if (famt === null || iamt === null || aamt === null || hpamt === null || tamt === null)
      throw new ImportError(`Account SNO ${integer(r.SNO)} has a blank amount. Nothing was imported.`);
    if (scaled(tamt) !== scaled(famt) + scaled(iamt) + scaled(aamt) + scaled(hpamt)) flags.push("total_not_equal_parts");
    if (r.recovery === "AMBIGUOUS" || r.recovery === "PARTIAL") flags.push("address_or_contact_uncertain");
    const mob = text(r.BMNO1);
    if (mob && !MOBILE.test(mob)) flags.push("mobile_invalid");
    if (!mob) flags.push("mobile_missing");
    const fno = integer(r.FNO);
    if ((fnoCounts.get(fno) ?? 0) > 1) flags.push("fno_shared");
    const adate = ymd(r.ADATE);
    if (adate === null) flags.push("agreement_date_invalid");
    const sez = clean(r.SEZIED);
    return {
      _file: key,
      ledger, sno: integer(r.SNO), fno, fcode: text(r.FCODE),
      borrower_name: text(r.BNAME) || "(blank)", borrower_father: text(r.BFNAME),
      borrower_address: text(r.BADD), borrower_mobile: mob, borrower_mobile2: text(r.BMNO2),
      guarantor_name: text(r.GNAME), guarantor_father: text(r.GFNAME), guarantor_address: text(r.GADD),
      guarantor_mobile: text(r.GMNO1), guarantor_mobile2: text(r.GMNO2),
      finance_mode: text(r.BCODE), zone: text(r.ZONE),
      vehicle_condition: text(r.NU), vehicle_model: text(r.MODEL), vehicle_variant: text(r.COLOR),
      chassis_no: text(r.CNO), engine_no: text(r.ENO), model_year: integer(r.MAKE) || null,
      registration_no: text(r.VNO), agreement_date: adate,
      tenure_months: integer(r.TMONTHS), interval_months: integer(r.PIVAL),
      finance_amount: famt, interest_amount: iamt, agreement_amount: aamt, hp_amount: hpamt,
      total_amount: tamt, emi_amount: money(r.IRATE),
      seized: sez === "T" ? true : sez === "F" ? false : null,
      data_flags: flags, recovery: r.recovery, raw: { ...rawJson(r), source_file: files[key].name },
    };
  });
  const snoLedger = new Map<number | null, Ledger>();
  for (const a of accounts) snoLedger.set(a.sno, a.ledger);

  // ---- receipts
  const payments: (Rec & { _file: FileKey })[] = [];
  const insRecs: Record<string, Rec[]> = {};
  for (const key of ["F_INSMENT", "P_INSMENT"] as const) {
    insRecs[key] = extractInstallments(files[key].bytes);
    for (const r of insRecs[key]) {
      const ledger = LEDGER[key];
      const flags: string[] = [];
      const sno = integer(r.SNO);
      const acctLedger = snoLedger.get(sno);
      const due = ymd(r.DDATE);
      const paid = ymd(r.PDATE);
      if (acctLedger === undefined) flags.push("no_matching_account");
      else if (acctLedger !== ledger) flags.push("account_in_other_ledger");
      if ((due && due < SUSPECT_BEFORE) || (paid && paid < SUSPECT_BEFORE)) flags.push("date_suspect");
      const rno = receiptNo(r.RNO_raw);
      if (rno === null) flags.push("receipt_no_unrecoverable");
      const bal = money(r.BAMT);
      if (bal === null) flags.push("balance_blank");
      else if (scaled(bal) < 0n) flags.push("negative_balance");
      payments.push({
        _file: key,
        ledger, sno,
        installment_no: integer(r.INO), due_amount: money(r.IAMT), due_date: due,
        paid_amount: money(r.PAMT), paid_date: paid, balance_after: bal,
        delay_days: integer(r.DDAYS), payment_mode: text(r.BCODE), cheque_no: text(r.CHNO),
        receipt_no: rno, data_flags: flags, raw: { ...rawJson(r), source_file: files[key].name },
      });
    }
  }

  // ---- batch notes + the totals the database must match after importing
  const count = <T,>(xs: T[]) => xs.reduce<Record<string, number>>((m, x) => ((m[String(x)] = (m[String(x)] ?? 0) + 1), m), {});
  const batches = {} as Parsed["batches"];
  const checks = {} as Parsed["checks"];
  for (const key of ["F_ACC", "P_ACCOUNT"] as const) {
    const rows = accounts.filter((a) => a._file === key);
    const sk = skipped.filter((s) => s.key === key);
    batches[key] = {
      source_file: files[key].name, total: rows.length + sk.length, imported: rows.length, skipped: sk.length,
      flagged: rows.filter((r) => r.data_flags.length).length,
      notes: { skipped: sk.map((s) => ({ src_index: s.src_index, sno: s.sno, reason: s.reason })), recovery: count(rows.map((r) => r.recovery)) },
    };
    checks[key] = { rows: rows.length, total: sumMoney(rows.map((r) => r.total_amount)) };
  }
  for (const key of ["F_INSMENT", "P_INSMENT"] as const) {
    const rows = payments.filter((p) => p._file === key);
    batches[key] = {
      source_file: files[key].name, total: rows.length, imported: rows.length, skipped: 0,
      flagged: rows.filter((r) => (r.data_flags as string[]).length).length,
      notes: { flags: count(rows.flatMap((r) => r.data_flags as string[])) },
    };
    checks[key] = { rows: rows.length, total: sumMoney(rows.map((r) => r.paid_amount as string | null)) };
  }
  return { accounts, payments, batches, checks };
}
