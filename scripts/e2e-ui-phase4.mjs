// Browser checks for the Phase 4 screens. Grows screen by screen.
// Needs: built web app served by a FRESH server with the demo seed (SEED_DEMO=true), mock Claude running.
// Usage: node scripts/e2e-ui-phase4.mjs     (SHOTS=dir to save screenshots)
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
export async function call(method, p, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const s = Date.now().toString(36);

log("▸ Set-up");
const demo = (await call("POST", "/auth/login", { body: { identifier: "admin@demo.school", password: "demo1234" } })).data.token;
const reg = await call("POST", "/auth/register", { body: { institute: `Phase4 Academy ${s}`, city: "Nagpur", name: "Kiran Rao", email: `p4-${s}@example.com`, password: "Phase4-admin#2026" } });
ok(reg.status === 200, `register ${reg.status}`);
const admin = reg.data.token;
ok(Boolean(demo), "demo admin signs in");

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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const visible = (loc, timeout = 8000) => loc.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

try {
  // ------------------------------------------------------------------ Home
  log("▸ Home dashboard");
  const p = await pageAs(demo);
  await p.goto(BASE + "/app");
  ok(await visible(p.locator(".page-title p", { hasText: new Date().getFullYear().toString() })), "greeting shows today's date");
  const stat = (label) => p.locator(".stat-link", { hasText: label });
  ok(await visible(stat("Students")), "Students card");
  for (const l of ["Teachers", "Batches", "Tests"]) ok(await stat(l).count() === 1, `${l} card`);
  ok(/\+\d+ new/.test(await stat("Students").innerText()), "cards show new in the last 30 days");
  const before = Number((await stat("Batches").locator(".value").innerText()).trim());
  const courses = (await call("GET", "/courses", { token: demo })).data;
  const jee = courses.find((c) => c.name === "JEE Main");
  await p.getByLabel("Course").selectOption(jee.id);
  await p.waitForURL(/course=/);
  await sleep(600);
  const after = Number((await stat("Batches").locator(".value").innerText()).trim());
  ok(after === jee.batches && after < before, `course filter narrows the cards (${before} → ${after})`);
  ok((await p.locator(".cchart-label").allInnerTexts()).join("|") === "JEE Main", "chart shows only that course");
  await p.reload();
  await visible(p.getByLabel("Course").locator(`option[value="${jee.id}"]`).locator(".."), 5000);
  await sleep(500);
  ok((await p.getByLabel("Course").inputValue()) === jee.id, "filter stays after a reload (it's in the address)");
  await p.getByRole("button", { name: "Clear filters" }).click();
  await sleep(600);
  ok(Number((await stat("Batches").locator(".value").innerText()).trim()) === before, "Clear filters shows everything again");
  await p.locator(".cchart-bar").first().hover();
  ok(await visible(p.locator(".cchart-tip")), "hovering a bar shows a tooltip");
  ok(/students?/.test(await p.locator(".cchart-tip").innerText()), "tooltip has the batch's student count");
  ok(await p.locator(".people-list li").count() > 0, "recent students are listed");
  await shot(p, "p4-home");
  await p.locator(".people-list a").first().click();
  await p.waitForURL(/\/app\/students\//);
  ok(true, "a recent student opens their report");
  await p.goto(BASE + "/app");
  await stat("Tests").click();
  await p.waitForURL("**/app/tests");
  ok(true, "stat cards link to their pages");
  const f = await pageAs(admin);
  await f.goto(BASE + "/app");
  ok(await visible(f.locator(".state", { hasText: "No batches yet" })), "new institute: chart empty state");
  ok(await visible(f.locator(".state", { hasText: "No students yet" })), "new institute: students empty state");

  // ------------------------------------------------------------------ Batches
  log("▸ Batches");
  await p.goto(BASE + "/app/batches");
  const cards = p.locator(".batch-card");
  ok(await visible(cards), "batches show as cards");
  const total = await cards.count();
  ok(total === 3, `all demo batches (${total})`);
  ok(/Students/.test(await cards.first().innerText()) && /Average/.test(await cards.first().innerText()), "cards show students, tests and average");
  await p.getByLabel("Search batches").fill("alpha");
  ok(await cards.count() === 1, "search narrows the cards");
  await p.getByLabel("Search batches").fill("zzz");
  ok(await visible(p.locator(".state", { hasText: "No batches match" })), "no-match state");
  await p.getByRole("button", { name: "Clear search and filters" }).click();
  ok(await cards.count() === total, "clearing shows all");
  await p.getByLabel("Course").selectOption({ label: "JEE Main" });
  await sleep(200);
  ok(await cards.count() === 2, "course filter");
  await p.getByLabel("Course").selectOption("");
  await p.getByRole("button", { name: "List" }).click();
  ok(await visible(p.locator("table.t th", { hasText: "Lead teacher" })), "list view");
  await p.reload();
  ok(await visible(p.locator("table.t th", { hasText: "Lead teacher" })), "list view is remembered");
  await p.getByRole("button", { name: "Cards" }).click();
  await p.getByRole("tab", { name: /Centres/ }).click();
  ok(await visible(p.locator("table.t", { hasText: "City" })), "Centres tab");
  await p.getByRole("tab", { name: /Courses/ }).click();
  ok(await visible(p.locator(".card", { hasText: "Courses & subjects" })), "Courses tab");
  await shot(p, "p4-batches");

  // Moving students (new institute, so the demo data stays untouched)
  const fb = await pageAs(admin);
  await fb.goto(BASE + "/app/batches");
  ok(await visible(fb.locator(".state", { hasText: "No batches yet" })), "new institute: empty state");
  for (const name of ["Morning", "Evening"]) {
    await fb.getByRole("button", { name: "+ Batch" }).first().click();
    await fb.getByPlaceholder("e.g. NEET 2027 - Morning").fill(name);
    await fb.getByPlaceholder("e.g. 10th CBSE").fill("10th CBSE");
    await fb.getByLabel("Start date").fill("2026-06-01");
    await fb.getByRole("button", { name: "Create batch" }).click();
    ok(await visible(fb.locator(".toast", { hasText: `Batch "${name}" created.` })), `batch ${name} created`);
  }
  const fbatches = (await call("GET", "/batches", { token: admin })).data;
  const morning = fbatches.find((b) => b.name === "Morning"), evening = fbatches.find((b) => b.name === "Evening");
  ok(morning.start_date === "2026-06-01" && morning.course_name === "10th CBSE", "start date and course saved");
  await call("POST", "/students/bulk", { token: admin, body: { batch_id: morning.id, csv: "Ravi Kumar,1\nSita Devi,2\nAmit Shah,3" } });
  await call("POST", "/students/bulk", { token: admin, body: { batch_id: evening.id, csv: "Neha Joshi,2" } });
  await fb.reload();
  const mcard = fb.locator(".batch-card", { hasText: "Morning" });
  ok(/Started/.test(await mcard.innerText()), "card shows the start date");
  await mcard.getByRole("button", { name: "Move students" }).click();
  const dlg = fb.getByRole("dialog");
  ok(await visible(dlg.getByText("3 of 3 selected")), "everyone selected at first");
  await dlg.getByLabel("Ravi Kumar").uncheck();
  ok(await visible(dlg.getByText("2 of 3 selected")), "untick one");
  await dlg.getByRole("button", { name: "Move 2 students" }).click();
  ok(await visible(fb.locator(".toast", { hasText: "Moved 2 students to Evening." })), "move confirmed");
  ok(await visible(fb.locator(".toast", { hasText: /Roll numbers already used in Evening/ })), "roll number clash explained");
  await sleep(500);
  ok((await fb.locator(".batch-card", { hasText: "Evening" }).locator(".batch-stats").innerText()).startsWith("3"), "Evening now has 3 students");
  fb.once("dialog", (d) => d.accept());
  await fb.locator(".batch-card", { hasText: "Morning" }).getByRole("button", { name: "Delete Morning" }).click();
  ok(await visible(fb.locator(".toast", { hasText: 'Batch "Morning" deleted.' })), "delete batch");

  // ------------------------------------------------------------------ Onboard students
  log("▸ Onboard students");
  const evId = (await call("POST", "/batches", { token: admin, body: { name: "Imports" } })).data.id;
  await fb.goto(BASE + `/app/students?batch=${evId}`);
  await fb.getByRole("button", { name: "+ Onboard students" }).click();
  const ob = fb.getByRole("dialog", { name: "Onboard students" });
  ok(await visible(ob.getByRole("tab", { name: "Upload a file" })), "window opens on Upload a file");
  ok((await ob.getByLabel("Batch").inputValue()) === evId, "the batch being viewed is chosen");
  const fileInput = ob.locator("input[type=file]");
  await fileInput.setInputFiles({ name: "old.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("x") });
  ok(await visible(ob.getByText(/Old Excel files \(\.xls\) can't be read/)), "old .xls files get a clear message");
  const dl = fb.waitForEvent("download");
  await ob.getByRole("button", { name: /Download a sample file/ }).click();
  ok((await dl).suggestedFilename() === "students-sample.csv", "sample CSV downloads");
  await fileInput.setInputFiles(new URL("./fixtures/students.xlsx", import.meta.url).pathname);
  ok(await visible(ob.locator(".file-card", { hasText: "students.xlsx" })), "Excel file read");
  ok(/5 rows/.test(await ob.locator(".file-card").innerText()), "5 rows found (second sheet ignored)");
  ok(await visible(ob.locator(".badge", { hasText: "2 ready to add" })), "2 rows ready");
  ok(await visible(ob.locator(".badge", { hasText: "3 with problems" })), "3 rows with problems");
  ok(await visible(ob.locator("tr.row-bad", { hasText: "Name is missing" })), "missing name shown on its row");
  ok(await visible(ob.locator("tr.row-bad", { hasText: "Same roll number as row 2" })), "repeated roll number shown");
  ok(await visible(ob.locator("tr", { hasText: "Kavya Nair" }).getByText("✓ OK")), "good rows are ticked");
  await shot(fb, "p4-onboard-preview");
  await ob.getByRole("button", { name: "Add 2 students and create logins" }).click();
  ok(await visible(fb.locator(".toast", { hasText: "2 students added." })), "added");
  ok(await visible(fb.getByText(/Login details/)), "logins are shown to hand out");
  ok(await visible(fb.locator(".error-box", { hasText: "Line 3" })), "skipped rows are listed on the page");
  ok(await visible(fb.locator("table.t td", { hasText: "Kavya Nair" })), "students appear in the list");

  await fb.getByRole("button", { name: "+ Onboard students" }).click();
  await ob.getByRole("tab", { name: "Invite link" }).click();
  await fb.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await ob.getByRole("button", { name: "Create link" }).click();
  ok(await visible(fb.locator(".toast", { hasText: "Invite link for Imports created." })), "invite link created");
  const url = (await ob.locator(".invite-url").first().innerText()).trim();
  ok(/\/join\/[\w-]{20,}$/.test(url), `link shown (${url})`);
  ok(await visible(ob.getByRole("link", { name: "WhatsApp" })), "WhatsApp share");
  await ob.getByRole("tab", { name: "Add one student" }).click();
  await ob.getByLabel("Full name *").fill("Single Student");
  await ob.getByLabel("Roll no").fill("40");
  await ob.getByRole("button", { name: "Add & create login" }).click();
  ok(await visible(fb.locator(".toast", { hasText: "Single Student added." })), "one student added");

  log("▸ Joining from an invite link");
  const jctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const jp = await jctx.newPage();
  jp.on("pageerror", (e) => errors.push(`join: ${e.message}`));
  await jp.goto(url);
  ok(await visible(jp.getByRole("heading", { name: "Join Imports" })), "join page names the batch");
  ok(await visible(jp.getByText(`at Phase4 Academy ${s}`)), "and the institute");
  await jp.getByLabel("Your full name *").fill("Link Joiner");
  await jp.getByLabel("Roll no").fill("41");
  await jp.getByLabel("Choose a password (8+ characters) *").fill("joiner-pass-9");
  await shot(jp, "p4-join");
  await jp.getByRole("button", { name: "Join and sign in" }).click();
  await jp.waitForURL("**/app/my");
  ok(await visible(jp.locator(".toast", { hasText: /Your username is/ })), "joined, signed in, told their username");
  await jp.goto(BASE + "/join/not-a-real-link");
  ok(await visible(jp.getByRole("heading", { name: "Link not working" })), "bad links explain themselves");
  await jctx.close();
  ok((await call("GET", `/students?batch_id=${evId}`, { token: admin })).data.some((x) => x.name === "Link Joiner" && x.roll_no === "41"), "the joiner is in the batch");

  // ------------------------------------------------------------------ Question papers list
  log("▸ Question Papers list");
  await p.goto(BASE + "/app/papers");
  const pcards = p.locator(".paper-card");
  ok(await visible(pcards), "papers show as cards");
  const demoPapers = (await call("GET", "/papers", { token: demo })).data;
  ok(await pcards.count() === demoPapers.length, `every paper has a card (${demoPapers.length})`);
  const approved = demoPapers.find((x) => x.status === "approved");
  if (approved) ok(await visible(p.locator(".paper-card", { hasText: approved.title }).locator(".approved-tick")), "approved papers have a tick");
  ok(/marks/.test(await pcards.first().innerText()) && /questions/.test(await pcards.first().innerText()), "cards show marks and questions");
  await p.getByLabel("Search papers").fill(demoPapers[0].title.slice(0, 8));
  ok(await pcards.count() >= 1 && await pcards.count() <= demoPapers.length, "search");
  await p.getByLabel("Search papers").fill("");
  await shot(p, "p4-papers");

  const fp = await pageAs(admin);
  for (const t of ["Algebra basics", "Light and optics"]) await call("POST", "/papers", { token: admin, body: { title: t, subject: "Science", duration_min: 30, sections: [{ name: "A", instructions: "", questions: [] }] } });
  await fp.goto(BASE + "/app/papers");
  ok(await visible(fp.locator(".paper-card", { hasText: "Algebra basics" })), "composed paper listed");
  ok(await visible(fp.locator(".paper-card", { hasText: "Algebra basics" }).locator(".badge", { hasText: "Written here" })), "source badge");
  ok(/2/.test(await fp.getByRole("button", { name: /Written here/ }).innerText()), "chip shows a count");
  fp.once("dialog", (d) => d.accept("Term 1"));
  await fp.getByRole("button", { name: "+ New" }).click();
  ok(await visible(fp.locator(".toast", { hasText: 'Folder "Term 1" created.' })), "folder created");
  ok(await visible(fp.locator(".state", { hasText: "This folder is empty" })), "new folder opens, empty");
  await fp.locator(".folder-nav").getByRole("button", { name: /All papers/ }).click();
  const alg = fp.locator(".paper-card", { hasText: "Algebra basics" });
  await alg.getByRole("button", { name: /More actions/ }).click();
  await fp.getByRole("menuitem", { name: /Folder, course/ }).click();
  await fp.getByRole("dialog").getByLabel("Folder").selectOption({ label: "Term 1" });
  await fp.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  ok(await visible(fp.locator(".toast", { hasText: "Paper updated." })), "moved to a folder");
  ok(await visible(alg.locator(".tag", { hasText: "Term 1" })), "card shows its folder");
  await fp.locator(".folder-nav").getByRole("button", { name: /Term 1/ }).click();
  await sleep(300);
  ok(await fp.locator(".paper-card").count() === 1, `folder filter (${await fp.locator(".paper-card").count()} cards, url ${fp.url()})`);
  await fp.locator(".folder-nav").getByRole("button", { name: /Not in a folder/ }).click();
  ok(await fp.locator(".paper-card").count() === 1 && await visible(fp.locator(".paper-card", { hasText: "Light and optics" })), "'Not in a folder' filter");
  await fp.locator(".folder-nav").getByRole("button", { name: /All papers/ }).click();
  await fp.locator(".paper-card", { hasText: "Light and optics" }).getByRole("button", { name: /More actions/ }).click();
  await fp.getByRole("menuitem", { name: "Duplicate" }).click();
  ok(await visible(fp.locator(".toast", { hasText: 'Copy of "Light and optics" made.' })), "duplicate");
  await sleep(500);
  ok(await fp.locator(".paper-card").count() === 3, "copy listed");
  fp.once("dialog", (d) => d.accept());
  await fp.locator(".folder-nav li", { hasText: "Term 1" }).hover();
  await fp.getByRole("button", { name: "Delete Term 1" }).click();
  ok(await visible(fp.locator(".toast", { hasText: 'Folder "Term 1" deleted.' })), "folder deleted");
  await sleep(400);
  ok(await fp.locator(".paper-card").count() === 3, "its papers stay");
  await fp.getByRole("button", { name: "✎ Compose" }).click();
  await fp.waitForURL(/\/app\/papers\/[^/]+\?edit=1/);
  ok(true, "Compose opens a blank paper in the editor");

  // ------------------------------------------------------------------ Import paper
  log("▸ Import paper window");
  await fp.goto(BASE + "/app/papers");
  await fp.getByRole("button", { name: "⇪ Import paper" }).click();
  const im = fp.getByRole("dialog", { name: "Import a question paper" });
  for (const st of ["Question paper", "Answer key", "Evaluation criteria", "Details"]) ok(await visible(im.locator(".step-label", { hasText: st })), `step: ${st}`);
  ok(await visible(im.getByText(/Credits: /)), "credit balance shown");
  const pdfLib = require("pdf-lib");
  const doc = await pdfLib.PDFDocument.create(); doc.addPage([595, 842]); doc.addPage([595, 842]);
  await im.locator("input[type=file]").first().setInputFiles({ name: "unit-test.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  ok(await visible(im.getByText("unit-test.pdf")), "file card shows the file");
  ok(await visible(im.getByText(/2 pages/)), "and its page count");
  await im.getByText("My own rules").click();
  const upload = im.getByRole("button", { name: "Upload & process" });
  await sleep(1500);
  ok(await upload.isDisabled(), "with 'My own rules' chosen, rules are needed before starting");
  await im.getByRole("button", { name: "+ Units are required for full marks" }).click();
  await im.getByRole("button", { name: "+ Accept any correct method" }).click();
  ok((await im.getByLabel("Your marking rules").inputValue()) === "Units are required for full marks\nAccept any correct method", "rule chips add lines");
  await im.getByLabel("Course").selectOption({ label: "10th CBSE" });
  await shot(fp, "p4-import");
  await upload.click();
  await fp.waitForURL(/\/app\/papers\/qp_/);
  ok(await visible(fp.locator(".toast", { hasText: "The AI is reading your paper" })), "import started");
  const newId = fp.url().split("/").pop().split("?")[0];
  const np = (await call("GET", `/papers/${newId}`, { token: admin })).data;
  ok(np.marking_notes.includes("Units are required") && np.course_id && np.source === "imported", "rules and course saved with the paper");

  // ------------------------------------------------------------------ Paper editor
  log("▸ Paper editor");
  const mk = (id, text, marks, extra = {}) => ({ id, type: "short", text, options: [], correct_option: null, numeric_answer: null, marks, negative_marks: 0, difficulty: "medium", topic: "Algebra", subtopic: "", solution: "Because $x^2 = 4$, $x = 2$.", rubric: [{ step: "Uses $x^2$", marks }], ...extra });
  const edId = (await call("POST", "/papers", { token: admin, body: { title: "Editor test", duration_min: 45, sections: [
    { name: "Section A", instructions: "Answer all", questions: [mk("q1", "Find $x$ if $x^2 = 4$", 2), mk("q2", "Expand $(a+b)^2$", 3)] },
    { name: "Section B", instructions: "", questions: [mk("q3", "Prove $\\sqrt{2}$ is irrational", 5, { difficulty: "hard" })] },
  ] } })).data.id;
  await fp.goto(BASE + `/app/papers/${edId}`);
  ok(await visible(fp.locator(".ws-summary", { hasText: "Questions" })), "summary bar");
  ok(/10/.test(await fp.locator(".ws-summary").innerText()) && /0\/3/.test(await fp.locator(".ws-summary").innerText()), "summary shows marks and checked count");
  ok(await fp.locator(".q-text .katex").count() >= 3, "maths is typeset with KaTeX");
  ok(await visible(fp.locator(".ws-switcher button", { hasText: "Section B" })), "section switcher");
  await fp.locator(".ws-q", { hasText: "Find" }).getByRole("button", { name: "Mark as checked" }).click();
  ok(await visible(fp.locator(".ws-q", { hasText: "Find" }).getByRole("button", { name: "Checked" })), "tick a question as checked");
  ok(await visible(fp.locator(".ws-switcher button", { hasText: "Section A" }).getByText("1/2")), "switcher shows checked progress");
  await fp.reload();
  ok(await visible(fp.locator(".ws-q", { hasText: "Find" }).getByRole("button", { name: "Checked" })), "tick is saved");
  await fp.getByRole("button", { name: /Section B/ }).first().click();
  await sleep(500);
  await fp.locator(".ws-section-head", { hasText: "Section A" }).click();
  ok(!(await fp.locator(".ws-q", { hasText: "Expand" }).count()), "sections collapse");
  await fp.locator(".ws-section-head", { hasText: "Section A" }).click();
  ok(await visible(fp.locator(".ws-q", { hasText: "Expand" })), "and open again");

  const q2 = fp.locator(".ws-q", { hasText: "Expand" });
  await q2.getByRole("button", { name: "Solution" }).click();
  const drawer = fp.getByRole("dialog", { name: /Question 2/ });
  ok(await visible(drawer), "solution drawer opens");
  await drawer.getByRole("button", { name: "✎ Edit" }).click();
  await drawer.getByLabel(/Worked solution/).fill("$(a+b)^2 = a^2 + 2ab + b^2$");
  ok(await visible(drawer.locator(".preview-box .katex")), "live maths preview while editing");
  await drawer.getByRole("button", { name: "Save" }).click();
  ok(await visible(fp.locator(".toast", { hasText: "Q2 saved." })), "solution saved");
  await drawer.getByRole("tab", { name: "Marking criteria" }).click();
  await drawer.getByRole("button", { name: "✎ Edit" }).click();
  await drawer.getByRole("button", { name: "+ Add step" }).click();
  await drawer.getByLabel("Step 2", { exact: true }).fill("Correct middle term");
  ok(await drawer.getByRole("button", { name: "Save" }).isDisabled(), "can't save steps that don't add up");
  await drawer.getByLabel("Marks for step 1").fill("2");
  await drawer.getByRole("button", { name: "Save" }).click();
  ok(await visible(fp.locator(".toast", { hasText: "Q2 saved." }).last()), "criteria saved");
  ok(await visible(drawer.locator(".criteria li", { hasText: "Correct middle term" })), "new step shown");
  await shot(fp, "p4-editor-drawer");
  await drawer.getByRole("tab", { name: /AI assist/ }).click();
  await drawer.getByRole("button", { name: "Add a step for units" }).click();
  await drawer.getByRole("button", { name: "✦ Refine" }).click();
  ok(await visible(fp.locator(".toast", { hasText: "The AI is working on the solution." })), "refine queued");
  ok(await visible(drawer.getByRole("button", { name: "Use this" }), 30000), "suggestion arrives");
  ok(await visible(drawer.locator(".sug-box", { hasText: "Add a step for units" })), "suggestion follows the request");
  await drawer.getByRole("button", { name: "Use this" }).click();
  ok(await visible(fp.locator(".toast", { hasText: "Q2 updated with the suggestion." })), "suggestion used");
  await drawer.getByRole("tab", { name: "Solution" }).click();
  ok(await visible(drawer.getByText(/Improved solution/)), "drawer shows the new solution");
  await fp.keyboard.press("Escape");
  ok(!(await drawer.count()), "Escape closes the drawer");
  const cr = (await call("GET", "/credits", { token: admin })).data;
  ok(cr.history.some((h) => h.action === "question_assist" && h.amount === -1), "AI help cost 1 credit");
  await fp.getByRole("button", { name: "Add rules" }).click();
  await fp.getByRole("textbox", { name: "Marking rules" }).fill("Units are required");
  await fp.getByRole("button", { name: "Save rules" }).click();
  ok(await visible(fp.locator(".ws-rules", { hasText: "Units are required" })), "marking rules can be added from the editor");

  // ------------------------------------------------------------------ Manage tests
  log("▸ Manage tests");
  await p.goto(BASE + "/app/tests");
  const tstat = (l) => p.locator(".stat", { hasText: l });
  ok(await visible(tstat("Average this month")), "stats cards");
  const dTests = (await call("GET", "/tests", { token: demo })).data;
  ok((await tstat("Tests").first().locator(".value").innerText()).trim() === String(dTests.length), "test count");
  ok(/vs last month|Last month|No results last month/.test(await tstat("Average this month").innerText()), "month-on-month change shown");
  ok(await p.locator(".test-card").count() === Math.min(6, dTests.length), "recent tests as cards");
  ok(await visible(p.locator("#all-tests table")), "full list below");
  await p.getByRole("tab", { name: "Published" }).click();
  ok(await p.locator("#all-tests tbody tr").count() === dTests.filter((t) => t.results_published).length, "Published tab");
  await p.getByRole("tab", { name: "All" }).click();
  await p.getByLabel("Search tests").fill("Maths");
  ok(await p.locator("#all-tests tbody tr").count() === dTests.filter((t) => /maths/i.test(`${t.title} ${t.subject} ${t.batch_names}`)).length, "search");
  await p.getByLabel("Course").selectOption({ label: "CBSE Class 10" });
  await sleep(600);
  const cbse = dTests.filter((t) => t.course_name === "CBSE Class 10").length;
  ok(await p.locator(".test-card").count() === Math.min(6, cbse), `course filter (${cbse})`);
  ok((await tstat("Tests").first().locator(".value").innerText()).trim() === String(cbse), "stats follow the filter");
  await p.getByLabel("Time range").selectOption("30d");
  await sleep(400);
  ok(/range=30d/.test(p.url()), "time range in the address");
  await p.getByRole("button", { name: "Clear filters" }).click();
  await shot(p, "p4-tests");
  const fdl = p.waitForEvent("download");
  await p.getByRole("button", { name: "⤓ Download results" }).click().catch(() => {});
  const dlr = await Promise.race([fdl, sleep(4000).then(() => null)]);
  ok(dlr && dlr.suggestedFilename() === "test_results_summary.csv", "results summary downloads");

  // ------------------------------------------------------------------ Test details
  log("▸ Test details");
  const pubOff = dTests.find((t) => t.mode === "offline" && t.results_published);
  await p.goto(BASE + `/app/tests/${pubOff.id}`);
  ok(await visible(p.locator(".info-strip dt", { hasText: "Paper" })), "info strip");
  ok(/Published/.test(await p.locator(".info-strip").innerText()), "status in the strip");
  ok(await visible(p.locator(".next-banner.done", { hasText: "Results are out" })), "next-step banner (done)");
  await p.getByRole("button", { name: "All steps" }).click();
  ok(await visible(p.locator(".steps")), "all steps open from the banner");
  await p.getByRole("button", { name: "Hide steps" }).click();
  ok(/present/.test(await p.locator(".card", { hasText: "Attendance" }).innerText()), "attendance card");
  ok(await visible(p.locator(".card", { hasText: "Evaluation progress" }).locator(".badge", { hasText: "marked" })), "evaluation progress");
  ok(await visible(p.locator(".medal.m1")) && await p.locator(".medal").count() === 3, "medals for the top three");
  const scores = await p.locator("tbody tr td:nth-child(5) b").allInnerTexts();
  ok(scores.map(Number).every((v, i, a) => i === 0 || a[i - 1] >= v), "rank list in rank order");
  const qrows = p.locator(".qperf-row");
  ok(await qrows.count() > 0, "question-wise performance");
  await p.getByRole("button", { name: "Weakest first" }).click();
  const pcts = (await p.locator(".qperf-pct").allInnerTexts()).map((x) => parseInt(x));
  ok(pcts.every((v, i, a) => i === 0 || a[i - 1] <= v), "weakest first sorting");
  await p.getByRole("button", { name: /Downloads/ }).click();
  ok(await visible(p.getByRole("menuitem", { name: "Results (CSV)" })) && await visible(p.getByRole("menuitem", { name: "Class report (PDF)" })), "downloads menu");
  const dl2 = p.waitForEvent("download");
  await p.getByRole("menuitem", { name: "Results (CSV)" }).click();
  ok(/_results\.csv$/.test((await dl2).suggestedFilename()), "results CSV from the menu");
  await shot(p, "p4-test-details");
  const draftT = dTests.find((t) => !t.results_published);
  await p.goto(BASE + `/app/tests/${draftT.id}`);
  ok(await visible(p.locator(".next-banner:not(.done)")), `banner for an unfinished test (${await p.locator(".next-banner").innerText().catch(() => "")})`);

  ok(!errors.length, `no browser errors (${errors.slice(0, 3).join(" | ")})`);
} finally {
  await browser.close();
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
