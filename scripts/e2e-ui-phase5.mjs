// Browser checks for Phase 5: the demo institute (with handwritten, marked sheets), keyboard use and focus,
// labels on every control, and tablet layouts.
// Needs: built web app served by a FRESH server seeded with the demo (npm run seed; SEED_DEMO=true).
// Usage: node scripts/e2e-ui-phase5.mjs     (SHOTS=dir to save screenshots)
import { createRequire } from "node:module";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:4300";
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗", m); } };
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const login = async (id) => (await call("POST", "/auth/login", { body: { identifier: id, password: "demo1234" } })).data.token;

// ------------------------------------------------------------------ Demo data
log("▸ Demo institute");
const admin = await login("admin@demo.school"), teacher = await login("teacher1@demo.school"), student = await login("student");
ok(admin && teacher && student, "demo admin, teacher and student can sign in");
const centres = (await call("GET", "/centres", { token: admin })).data;
const batches = (await call("GET", "/batches", { token: admin })).data;
const studs = (await call("GET", "/students", { token: admin })).data;
const papers = (await call("GET", "/papers", { token: admin })).data;
const tests = (await call("GET", "/tests", { token: admin })).data;
const courses = (await call("GET", "/courses", { token: admin })).data;
ok(centres.length === 2 && batches.length === 4 && studs.length === 20 && papers.length === 3, `2 centres, 4 batches, 20 students, 3 papers (${centres.length}, ${batches.length}, ${studs.length}, ${papers.length})`);
ok(batches.every((b) => b.course_id && b.start_date && b.student_count === 5), "every batch has a course, a start date and 5 students");
ok(courses.length === 2 && courses.every((c) => c.subjects.length >= 2), "courses with subjects");
ok(new Set(papers.map((p) => p.source)).size === 3 && papers.some((p) => p.status === "draft") && papers.filter((p) => p.folder_id).length === 2, "papers: AI generated, imported, written here; folders; one draft");
ok(studs.every((s) => s.parent_email && s.parent_phone), "students have parent contacts (for Send Reports)");
const maths = tests.find((t) => t.mode === "offline");
ok(maths && maths.results_published && maths.evaluated === 10 && maths.candidates === 10, "one fully marked handwritten test");
const md = (await call("GET", `/tests/${maths.id}`, { token: admin })).data;
ok(md.attempts.every((a) => a.files >= 1 && a.score != null), "every student in it has sheet pages and a score");
const top = [...md.attempts].sort((a, b) => b.score - a.score)[0];
const ad = (await call("GET", `/attempts/${top.id}`, { token: admin })).data;
ok(ad.evaluation.questions.filter((q) => q.attempted).every((q) => q.location.page >= 1 && q.location.mark_x > 0), "answers have positions on the pages");
ok(md.attempts.some((a) => a.score < a.max_score), "some students lost marks (realistic spread)");
const pageImg = await fetch(`${API}/attempts/${top.id}/files/0`, { headers: { Authorization: `Bearer ${admin}` } });
const bytes = Buffer.from(await pageImg.arrayBuffer());
ok(pageImg.status === 200 && /image\/jpeg/.test(pageImg.headers.get("content-type") ?? "") && bytes.length > 50_000, `sheet page is a real image (${bytes.length} bytes)`);
ok(tests.some((t) => t.mode === "cbt" && !t.results_published) && tests.filter((t) => t.mode === "cbt" && t.results_published).length === 3, "online tests: 3 published, 1 upcoming");
const mine = (await call("GET", "/my/tests", { token: student })).data;
ok(mine.some((t) => t.mode === "offline" && t.results_published && t.score != null), "the demo student sees their marked handwritten test");
await sleep(10);

const browser = await chromium.launch();
const errors = [];
async function pageAs(token, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${page.url()}: ${m.text()}`); });
  await page.goto(BASE + "/login");
  await page.evaluate((t) => localStorage.setItem("vedavidya_token", t), token);
  return page;
}
const visible = (loc, timeout = 8000) => loc.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
const focused = (p) => p.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute("aria-label") || a.textContent || a.getAttribute("placeholder") || a.tagName).trim().slice(0, 60) : ""; });
const inside = (p, sel) => p.evaluate((s) => Boolean(document.activeElement?.closest(s)), sel);

try {
  log("▸ Marked handwritten sheet");
  const p = await pageAs(admin);
  await p.goto(BASE + `/app/attempts/${top.id}`);
  ok(await visible(p.locator(".sheet-page img")), "sheet image shows");
  ok(await p.locator(".mk").count() >= 3 && await p.locator(".mk-circle").count() >= 3, "ticks and circled marks drawn on it");
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/p5-sheet.png` });
  const lowAttempt = [...md.attempts].sort((a, b) => a.score - b.score)[0];
  await p.goto(BASE + `/app/attempts/${lowAttempt.id}`);
  ok(await visible(p.locator(".mk-note-text")), "teacher-style correction notes on a weaker sheet");

  log("▸ Keyboard and focus");
  await p.goto(BASE + "/app");
  await visible(p.locator(".page-title h1"));
  await p.keyboard.press("Tab");
  ok((await focused(p)) === "Skip to content", "first Tab reaches 'Skip to content'");
  await p.keyboard.press("Enter");
  ok(await inside(p, "#main"), "skip link moves to the page content");
  // Windows: focus goes in, Tab stays in, Escape closes and returns focus.
  await p.goto(BASE + "/app/batches");
  const opener = p.getByRole("button", { name: "+ Batch" });
  await opener.focus();
  await p.keyboard.press("Enter");
  const dlg = p.getByRole("dialog", { name: "New batch" });
  ok(await visible(dlg), "window opens from the keyboard");
  ok(await inside(p, '[role="dialog"]') && (await focused(p)) !== "Close", "focus starts on the first field, not the close button");
  for (let i = 0; i < 15; i++) await p.keyboard.press("Tab");
  ok(await inside(p, '[role="dialog"]'), "Tab stays inside the window");
  for (let i = 0; i < 15; i++) await p.keyboard.press("Shift+Tab");
  ok(await inside(p, '[role="dialog"]'), "Shift+Tab stays inside too");
  ok(await p.evaluate(() => document.body.style.overflow === "hidden"), "the page behind doesn't scroll");
  await p.keyboard.press("Escape");
  ok(!(await dlg.count()), "Escape closes it");
  ok((await focused(p)) === "+ Batch", "focus goes back to the button that opened it");
  ok(await p.evaluate(() => document.body.style.overflow === ""), "scrolling is back");
  // Tabs with arrow keys
  const tab1 = p.getByRole("tab", { name: /Batches/ });
  await tab1.focus();
  await p.keyboard.press("ArrowRight");
  ok(/Centres/.test(await focused(p)) && await visible(p.locator("table.t", { hasText: "City" })), "arrow keys move between tabs and open them");
  await p.keyboard.press("End");
  ok(/Courses/.test(await focused(p)), "End jumps to the last tab");
  // Search
  await p.keyboard.press("Control+k");
  ok(await inside(p, '[role="dialog"][aria-label="Search"]'), "search takes focus");
  await p.keyboard.press("Escape");
  // Solution drawer
  const pp = papers.find((x) => x.source === "imported");
  await p.goto(BASE + `/app/papers/${pp.id}`);
  const solBtn = p.locator(".q-toolbar button", { hasText: "Solution" }).first();
  await solBtn.focus();
  await p.keyboard.press("Enter");
  ok(await inside(p, ".drawer"), "solution drawer takes focus");
  for (let i = 0; i < 20; i++) await p.keyboard.press("Tab");
  ok(await inside(p, ".drawer"), "Tab stays in the drawer");
  await p.keyboard.press("Escape");
  ok((await focused(p)) === "Solution", "focus returns to the Solution button");
  // Rank-list menu
  await p.goto(BASE + `/app/tests/${maths.id}`);
  await visible(p.locator(".medal"));
  const more = p.getByRole("button", { name: /^More for / }).first();
  await more.focus();
  await p.keyboard.press("Enter");
  ok(await visible(p.getByRole("menuitem", { name: "Report card PDF" })) && /Report card PDF/.test(await focused(p)), "row menu opens with focus on its first item");
  await p.keyboard.press("ArrowDown");
  ok(/WhatsApp/.test(await focused(p)), `arrow keys move in the menu (${await focused(p)})`);
  await p.keyboard.press("Escape");
  ok(/^More for/.test(await focused(p)), "Escape returns focus to the menu button");
  // Visible focus ring
  const ring = await p.evaluate(() => document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "no focus");
  ok(ring !== "none", `keyboard focus is visible (${ring})`);

  log("▸ Every control has a name");
  const fp = (await call("GET", "/papers", { token: admin })).data[0];
  const audit = () => p.evaluate(() => {
    const name = (el) => el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent) || el.getAttribute("title") ||
      (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest("label")?.textContent || (["BUTTON", "A"].includes(el.tagName) ? el.textContent : "") || el.getAttribute("placeholder");
    return [...document.querySelectorAll("input:not([type=hidden]), select, textarea, button, a[href], [role=button], [tabindex]:not([tabindex='-1'])")]
      .filter((el) => el.offsetParent !== null && !(name(el) || "").trim()).map((el) => el.outerHTML.slice(0, 100));
  });
  const pages = ["/app", "/app/tests", `/app/tests/${maths.id}`, `/app/attempts/${top.id}`, "/app/papers", `/app/papers/${fp.id}`, "/app/papers/new", "/app/practice",
    "/app/students", `/app/students/${studs[0].id}`, "/app/teachers", "/app/batches", "/app/notices", "/app/analytics", "/app/settings"];
  for (const path of pages) { await p.goto(BASE + path); await sleep(700); const bad = await audit(); ok(!bad.length, `${path}: every control has a name ${bad.join(" ")}`); }

  log("▸ Tablets");
  for (const [w, h] of [[768, 1024], [1024, 768]]) {
    const t = await pageAs(admin, { width: w, height: h });
    for (const path of pages) {
      await t.goto(BASE + path);
      await visible(t.locator(".page-title h1"));
      await sleep(300);
      const over = await t.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(over <= 0, `${w}×${h} ${path}: no sideways scrolling (${over}px)`);
    }
    if (SHOTS) { await t.goto(BASE + `/app/tests/${maths.id}`); await sleep(800); await t.screenshot({ path: `${SHOTS}/p5-tablet-${w}.png` }); }
    await t.context().close();
  }
  const t2 = await pageAs(admin, { width: 1024, height: 768 });
  await t2.goto(BASE + "/app/papers");
  await visible(t2.locator(".paper-grid"));
  const cols = await t2.evaluate(() => getComputedStyle(document.querySelector(".paper-grid")).gridTemplateColumns.split(" ").length);
  ok(cols === 2, `paper cards in 2 columns on a landscape tablet (${cols})`);
  await t2.goto(BASE + `/app/tests/${maths.id}`);
  await visible(t2.locator(".medal"));
  const row = t2.locator("tbody tr").first();
  const rowRight = await row.locator("td").last().evaluate((e) => e.getBoundingClientRect().right);
  ok(rowRight <= 1024, `rank list fits a landscape tablet (${Math.round(rowRight)}px)`);

  ok(!errors.length, `no browser errors (${errors.slice(0, 3).join(" | ")})`);
} finally {
  await browser.close();
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
