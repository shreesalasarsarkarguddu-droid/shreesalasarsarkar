// Reads a CSV file (RFC 4180: quoted fields, "" inside quotes, CR/LF inside quoted fields) into objects keyed
// by the header row. Used for restoring backups; both the website zip and the database dump use this format.

export function parseCsv(text: string): Record<string, string>[] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Excel byte-order mark
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("The CSV ends inside a quoted value (file is cut off).");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) return [];
  const [head, ...body] = nonEmpty;
  return body.map((r, n) => {
    if (r.length !== head.length) throw new Error(`Row ${n + 2} has ${r.length} values but the header has ${head.length}.`);
    return Object.fromEntries(head.map((h, i) => [h, r[i]]));
  });
}
