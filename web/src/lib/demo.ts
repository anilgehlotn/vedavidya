// Preview mode: serves a recorded snapshot of the demo institute's API responses so the
// interface can run with no server. Reads come from the snapshot; changes are not saved.
type Role = "admin" | "teacher" | "student";
type Snapshot = Record<Role, Record<string, unknown>>;

let snapshot: Promise<Snapshot> | null = null;
const load = () => (snapshot ??= fetch("snapshot.json").then((r) => r.json()));

const DEMO_LOGINS: Record<string, Role> = { "admin@demo.school": "admin", "teacher1@demo.school": "teacher", student: "student" };
export const READ_ONLY = "This is a preview with sample data, so changes aren't saved. Run the full app to make changes.";

const submitted = new Set<string>();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export async function demoApi(path: string, method: string, body: any, token: string | null, fail: (msg: string, status: number) => never) {
  const snap = await load();
  const role = (token && token in snap ? token : null) as Role | null;

  if (path === "/auth/login") {
    const r = DEMO_LOGINS[String(body?.identifier ?? "").trim().toLowerCase()];
    if (!r || body?.password !== "demo1234") fail("In this preview, use one of the demo accounts below (password demo1234).", 401);
    return { token: r, user: (snap[r!]["/me"] as any).user };
  }
  if (path === "/health") return { ok: true, ai: false };
  if (path === "/auth/register") fail("Creating an institute needs the full app. In this preview, explore the demo institute instead.", 400);
  if (path === "/contact") fail("The contact form isn't connected in this preview.", 400);
  if (!role) fail("Not signed in", 401);

  const data = snap[role!];
  if (method === "GET") {
    if (path === "/my/tests") {
      return clone(data[path] as any[]).map((t) => (submitted.has(t.id) ? { ...t, status: "evaluated" } : t));
    }
    if (path in data) return clone(data[path]);
    fail("This page isn't included in the preview data.", 404);
  }

  // Online test: allow taking it in the browser; the answers stay in this tab.
  const cbt = path.match(/^\/cbt\/([^/]+)\/(start|responses|submit)$/);
  if (cbt) {
    const [, testId, action] = cbt;
    if (submitted.has(testId)) fail("You've already submitted this test.", 400);
    if (action === "start") return clone(data[`/cbt/${testId}/start`] ?? fail("This test isn't available in the preview.", 404));
    if (action === "submit") submitted.add(testId);
    return { ok: true };
  }
  if (path.startsWith("/papers/generate")) fail("AI paper generation needs the full app with an Anthropic API key.", 400);
  if (path.endsWith("/evaluate")) fail("AI evaluation needs the full app with an Anthropic API key.", 400);
  fail(READ_ONLY, 400);
}
