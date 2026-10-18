import { unzipSync, strFromU8 } from "fflate";

// The old software's export is one worksheet of inline-string cells (a raw FoxPro .DBF dump).
// This reads every non-empty cell in sheet order, exactly like openpyxl's ws.iter_rows(values_only=True)
// in the original Python import, and joins them with \x01 (the separator the record parsers expect).

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITY[e],
  );
}

// Excel escapes control characters as _xHHHH_ (openpyxl turns them back)
function unescapeOoxml(s: string): string {
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export function readDumpCells(file: Uint8Array): string[] {
  const files = unzipSync(file, { filter: (f) => f.name === "xl/worksheets/sheet1.xml" || f.name === "xl/sharedStrings.xml" });
  const sheet = files["xl/worksheets/sheet1.xml"];
  if (!sheet) throw new Error("This is not an export from the old software (no worksheet found).");
  const xml = strFromU8(sheet);
  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    for (const m of strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  }
  const out: string[] = [];
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const body = m[2] ?? "";
    const type = /\bt="(\w+)"/.exec(attrs)?.[1];
    let v: string | null = null;
    if (type === "inlineStr") {
      if (/<is>/.test(body)) v = textOf(body);
    } else if (type === "s") {
      const i = /<v>(\d+)<\/v>/.exec(body);
      if (i) v = shared[Number(i[1])];
    } else {
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (raw) v = decodeXml(raw[1]);
    }
    if (v !== null) out.push(v);
  }
  return out;
}

function textOf(body: string): string {
  let s = "";
  for (const t of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) s += t[1] ? unescapeOoxml(decodeXml(t[1])) : "";
  return s;
}
