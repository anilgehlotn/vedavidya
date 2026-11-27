// Browser checks for the app shell (Phase 3): sidebar, flyouts, breadcrumbs, collapse, search, account,
// toasts, skeletons, empty and error states, phone drawer, and every page loading cleanly.
// Needs: built web app served by a FRESH server (signups are limited), with the demo seed (SEED_DEMO=true).
// Usage: node scripts/e2e-ui-shell.mjs     (SHOTS=dir to save screenshots)
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
const s = Date.now().toString(36);

log("▸ Set-up");
const reg = await call("POST", "/auth/register", { body: { institute: `Shell School ${s}`, city: "Indore", name: "Meera Iyer", email: `shell-${s}@example.com`, password: "Shell-admin#2026" } });
ok(reg.status === 200, `register ${reg.status}`);
const fresh = reg.data.token; // a new, empty institute
const demo = (await call("POST", "/auth/login", { body: { identifier: "admin@demo.school", password: "demo1234" } })).data.token;
const student = (await call("POST", "/auth/login", { body: { identifier: "student", password: "demo1234" } })).data.token;
ok(demo && student, "demo admin and student can sign in");
const demoTests = (await call("GET", "/tests", { token: demo })).data;
const demoStudents = (await call("GET", "/students", { token: demo })).data;

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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const visible = (loc, timeout = 8000) => loc.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
const side = (p) => p.locator("aside.side");

try {
  log("▸ Sidebar: staff menu, flyouts, active state");
  const p = await pageAs(demo);
  await p.goto(BASE + "/app");
  for (const name of ["Home", "Assessments", "People", "Institute", "Settings", "Logout"])
    ok(await visible(side(p).getByText(name, { exact: true })), `menu shows ${name}`);
  ok(!(await side(p).getByText("Assignments").count()) && !(await side(p).getByText("Test Series").count()), "no Assignments / Test Series (D8)");
  ok((await side(p).getByRole("link", { name: "Home", exact: true }).getAttribute("class")).includes("active"), "Home is active on the dashboard");
  const logoutColor = await side(p).getByRole("button", { name: "Logout" }).evaluate((e) => getComputedStyle(e).color);
  ok(logoutColor === "rgb(224, 69, 43)", `Logout uses the danger colour (${logoutColor})`);
  ok(await visible(p.locator(".plan-badge", { hasText: /demo/i })), "avatar shows the plan badge (Demo)");
  await side(p).getByRole("button", { name: "Assessments" }).click();
  const fly = p.locator(".flyout");
  ok(await visible(fly), "Assessments opens a flyout");
  ok((await fly.getByRole("menuitem").allInnerTexts()).map((t) => t.trim()).join("|") === "Tests|Question Papers|Practice Questions", "flyout lists Tests, Question Papers, Practice Questions");
  ok(await p.evaluate(() => document.activeElement?.textContent?.trim() === "Tests"), "focus moves into the flyout");
  await p.keyboard.press("ArrowDown");
  ok(await p.evaluate(() => document.activeElement?.textContent?.trim() === "Question Papers"), "arrow keys move between flyout items");
  await p.keyboard.press("Escape");
  ok(!(await fly.count()), "Escape closes the flyout");
  await side(p).getByRole("button", { name: "Assessments" }).click();
  await p.mouse.click(900, 700);
  ok(!(await fly.count()), "clicking elsewhere closes the flyout");
  await side(p).getByRole("button", { name: "Assessments" }).click();
  await fly.getByRole("menuitem", { name: "Tests" }).click();
  await p.waitForURL("**/app/tests");
  await sleep(300);
  ok(!(await fly.count()), "choosing a page closes the flyout");
  ok((await side(p).getByRole("button", { name: "Assessments" }).getAttribute("class")).includes("active"), "Assessments is active on Tests");
  await shot(p, "shell-tests");

  log("▸ Breadcrumbs and page header");
  ok((await p.locator(".crumbs").innerText()).replace(/\s+/g, " ").trim() === "Assessments Tests", `tests list crumbs (${await p.locator(".crumbs").innerText()})`);
  const t0 = demoTests[0];
  await p.goto(BASE + `/app/tests/${t0.id}`);
  ok(await visible(p.locator(".crumbs a", { hasText: "Tests" })), "test page links back to Tests");
  ok((await p.locator(".crumbs li").last().innerText()).trim() === t0.title, "last crumb is the test's name");
  ok(await visible(p.locator(".page-title h1", { hasText: t0.title })), "large title");
  await p.locator(".crumbs a", { hasText: "Tests" }).click();
  await p.waitForURL("**/app/tests");
  ok(true, "breadcrumb link works");
  await p.goto(BASE + "/app");
  ok(!(await p.locator(".crumbs").count()), "Home has no breadcrumbs");
  await visible(p.locator(".card.stat"));
  const card = await p.locator(".card.stat").first().evaluate((e) => { const c = getComputedStyle(e); return { r: c.borderTopLeftRadius, b: c.borderTopWidth, bg: c.backgroundColor }; });
  ok(card.r === "12px" && card.b === "1px" && card.bg === "rgb(255, 255, 255)", `cards: white, 12px radius, border (${JSON.stringify(card)})`);

  log("▸ Collapse toggle");
  await side(p).getByRole("button", { name: "Collapse menu" }).click();
  await sleep(400); // width animates
  ok(!(await side(p).getByText("Assessments", { exact: true }).isVisible()), "collapsed: labels hidden");
  const w = await side(p).evaluate((e) => e.getBoundingClientRect().width);
  ok(w < 80, `collapsed sidebar is narrow (${w}px)`);
  ok((await side(p).getByRole("button", { name: "Assessments" }).getAttribute("title")) === "Assessments", "collapsed items keep a tooltip");
  await p.reload();
  ok(await visible(side(p).getByRole("button", { name: "Expand menu" })), "collapsed state is remembered");
  await side(p).getByRole("button", { name: "Expand menu" }).click();
  ok(await visible(side(p).getByText("Assessments", { exact: true })), "expanded again");

  log("▸ Search");
  await p.keyboard.press("Control+k");
  const box = p.getByRole("dialog", { name: "Search" });
  ok(await visible(box), "Ctrl+K opens search");
  const st = demoStudents[3];
  await box.getByRole("textbox").fill(st.name.slice(0, 6));
  ok(await visible(box.getByRole("option", { name: new RegExp(st.name) })), "finds a student by name");
  await box.getByRole("textbox").fill(st.name);
  await p.keyboard.press("Enter");
  await p.waitForURL(`**/app/students/${st.id}`);
  ok(true, "Enter opens the student's report");
  ok((await p.locator(".crumbs").innerText()).includes("Students"), "student page crumbs: People › Students");
  await side(p).getByRole("button", { name: /^Search/ }).click();
  await box.getByRole("textbox").fill("question pap");
  ok(await visible(box.getByRole("option", { name: /Question Papers/ })), "finds pages too");
  await box.getByRole("textbox").fill("zzzz-nothing");
  ok(await visible(box.getByText(/Nothing matches/)), "says when nothing matches");
  await p.keyboard.press("Escape");
  ok(!(await box.count()), "Escape closes search");

  log("▸ Account menu and logout");
  await side(p).locator(".acct-btn").click();
  ok(await visible(p.locator(".acct-pop", { hasText: "Sunrise Academy" })), "account menu shows name and institute");
  await p.keyboard.press("Escape");

  log("▸ Empty states, toasts and the Practice page (new institute)");
  const f = await pageAs(fresh);
  await f.goto(BASE + "/app/tests");
  ok(await visible(f.locator(".state", { hasText: "No tests yet" }).getByRole("button", { name: /Create your first test/ })), "Tests: empty state with an action");
  await f.goto(BASE + "/app/papers");
  ok(await visible(f.locator(".state", { hasText: "No question papers yet" })), "Papers: empty state");
  await f.goto(BASE + "/app/practice");
  ok(await visible(f.locator(".state", { hasText: "No practice yet" }).getByRole("link", { name: "Go to tests" })), "Practice: empty state");
  await f.goto(BASE + "/app/students");
  ok(await visible(f.locator(".state", { hasText: "No students yet" })), "Students: empty state");
  await f.goto(BASE + "/app/notices");
  ok(await visible(f.locator(".state", { hasText: "No notices yet" })), "Notices: empty state");
  ok(await visible(f.locator(".plan-badge", { hasText: /credits/i })), "new institute's plan badge says Credits");
  await f.goto(BASE + "/app/batches");
  await f.getByRole("button", { name: "+ Batch" }).click();
  await f.getByPlaceholder("e.g. NEET 2027 - Morning").fill("Morning A");
  await f.getByRole("button", { name: "Create batch" }).click();
  const toast = f.locator(".toast", { hasText: 'Batch "Morning A" created.' });
  ok(await visible(toast), "saving shows a success toast");
  ok((await toast.getAttribute("role")) === "status", "success toasts are announced politely");
  await toast.getByRole("button", { name: "Close notification" }).click();
  ok(!(await toast.count()), "a toast can be closed");
  await f.goto(BASE + "/app/notices");
  await f.getByRole("button", { name: "+ Post notice" }).first().click();
  await f.locator(".modal input").first().fill("Holiday");
  await f.locator(".modal textarea").fill("School closed on Monday.");
  await f.getByRole("button", { name: "Post", exact: true }).click();
  ok(await visible(f.locator(".toast", { hasText: "Notice posted." })), "posting a notice shows a toast");
  f.once("dialog", (d) => d.accept());
  await f.getByRole("button", { name: "Delete" }).click();
  ok(await visible(f.locator(".toast", { hasText: "Notice deleted." })), "deleting shows a toast");
  await shot(f, "shell-toast");

  log("▸ Loading skeletons and error states");
  await f.route("**/api/tests", async (route) => { await sleep(1500); await route.continue().catch(() => {}); });
  await f.goto(BASE + "/app/tests");
  ok(await visible(f.locator(".sk").first(), 1200), "a skeleton shows while the list loads");
  await f.unroute("**/api/tests");
  await sleep(1600);
  let failNext = true;
  await f.route("**/api/tests", (route) => failNext ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong on our side. Please try again." }) }) : route.continue());
  await f.goto(BASE + "/app/tests");
  const errState = f.locator(".state", { hasText: "This couldn't be loaded" });
  ok(await visible(errState), "a failed load shows an error state");
  ok(await visible(errState.getByText("Something went wrong on our side")), "with the reason");
  failNext = false;
  await errState.getByRole("button", { name: "Try again" }).click();
  ok(await visible(f.locator(".state", { hasText: "No tests yet" })), "Try again loads the page");
  await f.unroute("**/api/tests");
  await f.route("**/api/overview", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server is busy" }) }));
  await f.goto(BASE + "/app");
  ok(await visible(f.locator(".state", { hasText: "Server is busy" })), "Home shows an error state too");
  await f.unroute("**/api/overview");
  await shot(f, "shell-error");

  log("▸ Student menu");
  const sp = await pageAs(student);
  await sp.goto(BASE + "/app");
  await sp.waitForURL("**/app/my");
  for (const name of ["My tests", "Report card", "Notices", "Settings", "Logout"]) ok(await visible(side(sp).getByText(name, { exact: true })), `student menu shows ${name}`);
  ok(!(await side(sp).getByText("Assessments").count()), "students don't see staff menus");
  ok(await visible(sp.locator(".plan-badge", { hasText: /student/i })), "student badge");
  await sp.goto(BASE + "/app/my/report");
  ok(!(await sp.locator(".crumbs").count()), "report card has no staff breadcrumbs");

  log("▸ Every page loads with a title and no errors");
  const pages = ["/app", "/app/tests", `/app/tests/${t0.id}`, "/app/papers", "/app/papers/new", "/app/practice", "/app/students", `/app/students/${st.id}`,
    "/app/teachers", "/app/batches", "/app/notices", "/app/analytics", "/app/settings"];
  const ph = await pageAs(demo, { width: 390, height: 844 });
  for (const path of pages) {
    await p.goto(BASE + path);
    ok(await visible(p.locator(".page-title h1")), `${path}: title`);
    await ph.goto(BASE + path);
    await visible(ph.locator(".page-title h1"));
    await sleep(200);
    const over = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, `${path}: no sideways scrolling on a phone (${over}px too wide)`);
  }
  for (const path of ["/app/my", "/app/my/report", "/app/notices", "/app/settings"]) {
    await sp.goto(BASE + path);
    ok(await visible(sp.locator(".page-title h1")), `student ${path}: title`);
  }

  log("▸ Phone: drawer menu");
  await ph.goto(BASE + "/app");
  ok(!(await side(ph).isVisible()) || (await side(ph).evaluate((e) => e.getBoundingClientRect().right <= 0)), "sidebar is hidden on a phone");
  await ph.getByRole("button", { name: "Open menu" }).click();
  await sleep(300);
  ok(await side(ph).evaluate((e) => e.getBoundingClientRect().left >= 0), "menu button opens the drawer");
  await side(ph).getByRole("button", { name: "People" }).click();
  ok(await visible(side(ph).getByRole("menuitem", { name: "Students" })), "groups open inside the drawer");
  await shot(ph, "shell-phone");
  await side(ph).getByRole("menuitem", { name: "Students" }).click();
  await ph.waitForURL("**/app/students");
  await sleep(300);
  ok(await side(ph).evaluate((e) => e.getBoundingClientRect().right <= 0), "choosing a page closes the drawer");

  log("▸ Logout");
  await side(p).getByRole("button", { name: "Logout" }).click();
  await p.waitForURL("**/login");
  ok(await p.evaluate(() => !localStorage.getItem("vedavidya_token")), "logout signs out");

  ok(!errors.length, `no browser errors (${errors.slice(0, 3).join(" | ")})`);
} finally {
  await browser.close();
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
