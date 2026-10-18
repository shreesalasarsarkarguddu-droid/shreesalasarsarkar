// Reads the old software's own table files (FoxPro .DBF, named .DAT on the shop computer) byte by byte.
// Unlike the xlsx dumps nothing has to be recovered: every record sits at a fixed place given by the header.

export type DbfField = { name: string; type: string; len: number; off: number };
export type DbfRecord = Record<string, string | number> & { _deleted: boolean; _index: number };

/** true when the bytes look like a dBase/FoxPro table (header sizes agree with the file length) */
export function isDbf(b: Uint8Array): boolean {
  if (b.length < 66 || ![0x03, 0x30, 0x31, 0x32, 0x83, 0x8b, 0xf5].includes(b[0])) return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint32(4, true);
  const hlen = v.getUint16(8, true);
  const rlen = v.getUint16(10, true);
  return hlen >= 65 && rlen > 1 && hlen + n * rlen <= b.length && b.length <= hlen + n * rlen + 1;
}

export function readDbf(b: Uint8Array): { fields: DbfField[]; records: DbfRecord[] } {
  if (!isDbf(b)) throw new Error("not a table file");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint32(4, true);
  const hlen = v.getUint16(8, true);
  const rlen = v.getUint16(10, true);
  const latin1 = new TextDecoder("latin1");
  const fields: DbfField[] = [];
  let off = 1;
  for (let p = 32; p + 32 <= hlen && b[p] !== 0x0d; p += 32) {
    const name = latin1.decode(b.subarray(p, p + 11)).replace(/\0[\s\S]*$/, "");
    const type = String.fromCharCode(b[p + 11]);
    const len = b[p + 16];
    fields.push({ name, type, len, off });
    off += len;
  }
  if (off !== rlen) throw new Error("table header does not match the record size");
  const records: DbfRecord[] = [];
  for (let i = 0; i < n; i++) {
    const s = hlen + i * rlen;
    const r = { _deleted: b[s] === 0x2a, _index: i + 1 } as DbfRecord;
    for (const f of fields) {
      const at = s + f.off;
      // I = 4-byte integer (receipt numbers); everything else is stored as text
      (r as Record<string, unknown>)[f.name] = f.type === "I" ? v.getInt32(at, true) : latin1.decode(b.subarray(at, at + f.len));
    }
    records.push(r);
  }
  return { fields, records };
}
