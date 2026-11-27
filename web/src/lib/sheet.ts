// Reads student lists from spreadsheets in the browser: CSV/TSV text and Excel .xlsx files.
// .xlsx is a ZIP of XML files; we unzip it with the browser's own DecompressionStream (no extra library).
// Old binary .xls files are not supported (people are asked to save as .xlsx or CSV).

export type Cell = string;
export type Table = Cell[][];

/** CSV/TSV/semicolon text → rows. Handles quoted cells with commas, quotes ("") and line breaks. */
export function parseCsv(text: string): Table {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", "\t", ";"].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: Table = [];
  let row: Cell[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

// ---- Minimal ZIP reader (central directory + deflate) ----
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This doesn't look like an Excel (.xlsx) file.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("The Excel file is damaged.");
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = u8.subarray(start, start + size);
    if (method === 0) out.set(name, dec.decode(data));
    else if (method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open Excel files. Save the sheet as CSV, or use a newer browser.");
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.set(name, await new Response(stream).text());
    } else throw new Error("This Excel file uses a format we can't read. Save it as CSV and try again.");
  }
  return out;
}

const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const text = (el: Element | null | undefined) => (el ? [...el.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("") : "");

/** First worksheet of an .xlsx file → rows of text. */
export async function readXlsx(file: Blob): Promise<Table> {
  const files = await unzip(await file.arrayBuffer(), (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  // Find the first sheet in workbook order.
  let sheetPath = [...files.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort()[0];
  const wb = files.get("xl/workbook.xml"), rels = files.get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName("sheet")[0];
    const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = [...xml(rels).getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid);
    const target = rel?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = sheetPath && files.get(sheetPath);
  if (!sheet) throw new Error("The Excel file has no sheets.");
  const shared = files.get("xl/sharedStrings.xml");
  const strings = shared ? [...xml(shared).getElementsByTagName("si")].map((si) => text(si)) : [];
  const rows: Table = [];
  for (const r of xml(sheet).getElementsByTagName("row")) {
    const row: Cell[] = [];
    for (const c of r.getElementsByTagName("c")) {
      const t = c.getAttribute("t"), vEl = c.getElementsByTagName("v")[0];
      const raw = vEl?.textContent ?? "";
      const val = t === "s" ? strings[Number(raw)] ?? "" : t === "inlineStr" ? text(c.getElementsByTagName("is")[0]) : t === "b" ? (raw === "1" ? "TRUE" : "FALSE") : raw;
      const ref = c.getAttribute("r");
      row[ref ? colIndex(ref) : row.length] = val.trim();
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

// ---- Turning rows into students ----
export interface StudentRow { name: string; roll_no: string; phone: string; email: string; parent_name: string; parent_phone: string; parent_email: string }
export const STUDENT_FIELDS: { key: keyof StudentRow; label: string; match: RegExp }[] = [
  { key: "name", label: "Name", match: /^(student\s*)?(full\s*)?name$|^student$/i },
  { key: "roll_no", label: "Roll no", match: /^roll|^(admission|enrol?ment|reg(istration)?)\s*(no|number|#)?$/i },
  { key: "phone", label: "Phone", match: /^(student\s*)?(phone|mobile|contact|whats\s*app)(\s*(no|number))?$/i },
  { key: "email", label: "Email", match: /^(student\s*)?e-?mail(\s*(id|address))?$/i },
  { key: "parent_name", label: "Parent name", match: /^(parent|father|mother|guardian)('?s)?\s*name$/i },
  { key: "parent_phone", label: "Parent phone", match: /^(parent|father|mother|guardian)('?s)?\s*(phone|mobile|contact|whats\s*app)(\s*(no|number))?$/i },
  { key: "parent_email", label: "Parent email", match: /^(parent|father|mother|guardian)('?s)?\s*e-?mail/i },
];
/** Order used when the file has no header row (same as the old "paste" box). */
const DEFAULT_ORDER: (keyof StudentRow)[] = ["name", "roll_no", "phone", "email", "parent_phone"];

/** Reads students from a table, using the header row when there is one. Also says which columns were understood. */
export function toStudents(table: Table): { rows: StudentRow[]; columns: string[]; headerFound: boolean } {
  if (!table.length) return { rows: [], columns: [], headerFound: false };
  const header = table[0].map((h) => h.replace(/[._*:]/g, " ").replace(/\s+/g, " ").trim());
  const map = header.map((h) => STUDENT_FIELDS.find((f) => f.match.test(h))?.key ?? null);
  const headerFound = map.includes("name");
  const order = headerFound ? map : DEFAULT_ORDER;
  const body = headerFound ? table.slice(1) : table;
  const rows = body.map((r) => {
    const s: StudentRow = { name: "", roll_no: "", phone: "", email: "", parent_name: "", parent_phone: "", parent_email: "" };
    order.forEach((k, i) => { if (k && r[i] != null && !s[k]) s[k] = String(r[i]).trim(); });
    return s;
  }).filter((s) => Object.values(s).some(Boolean));
  const columns = [...new Set(order.filter(Boolean) as (keyof StudentRow)[])].map((k) => STUDENT_FIELDS.find((f) => f.key === k)!.label);
  return { rows, columns, headerFound };
}

export const SAMPLE_CSV = "Name,Roll no,Phone,Email,Parent name,Parent phone,Parent email\n" +
  "Aarav Sharma,1,9876543210,aarav@example.com,Rakesh Sharma,9812345678,rakesh@example.com\n" +
  "Isha Patel,2,9876500000,,Meena Patel,9811122233,\n";
