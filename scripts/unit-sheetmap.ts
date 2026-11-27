// Unit checks for grouping scanned pages into students. Run: npx tsx scripts/unit-sheetmap.ts
import { groupPages, type PageRead } from "../server/src/lib/sheetmap.ts";
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log("  ✗", m); } };
const p = (n: number, first: boolean, id = "", confidence: PageRead["confidence"] = "high"): PageRead => ({ n, first_page: first, student_id: id, confidence, name_written: "", roll_written: "" });
const valid = new Set(["a", "b", "c"]);
const ids = (r: ReturnType<typeof groupPages>) => r.map((x) => x.attempt_id ?? "-").join("");

ok(ids(groupPages([p(1, true, "a"), p(2, false), p(3, true, "b"), p(4, false)], valid)) === "aabb", "continuation pages follow their first page");
ok(ids(groupPages([p(2, false), p(1, true, "a")], valid)) === "aa", "pages are sorted by number first");
ok(ids(groupPages([p(1, false), p(2, true, "a")], valid)) === "-a", "pages before any first page stay unassigned");
ok(ids(groupPages([p(1, true, "a"), p(2, false, "b")], valid)) === "ab", "a page read as another student starts that student");
ok(ids(groupPages([p(1, true, "a"), p(2, true, "a")], valid)) === "a-", "the same student twice: the second group is left for the teacher");
ok(ids(groupPages([p(1, true, "zzz"), p(2, false)], valid)) === "--", "an unknown id is not trusted");
ok(groupPages([p(1, true, "zzz")], valid)[0].confidence === "low", "unmatched first pages are low confidence");
ok(ids(groupPages([p(1, true, "a"), p(2, false, "a"), p(3, false, "")], valid)) === "aaa", "matching continuation pages stay with the student");
console.log(fail ? `✗ ${fail} failed` : "✓ sheet grouping checks passed");
process.exit(fail ? 1 : 0);
