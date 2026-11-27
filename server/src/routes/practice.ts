// Fix-it practice (personal practice + later check-up for each student) and mistake insights for teachers.
import { Router } from "express";
import { z } from "zod";
import { all, json, one, run, uid } from "../db.js";
import { staff, requireRole } from "../auth.js";
import { AiError, aiProblem, generateBrief, generatePractice, type LostQuestion } from "../ai/claude.js";
import { rateLimit } from "../ratelimit.js";
import { enqueueJob, registerJob } from "../lib/jobs.js";
import { charge, CreditError, refund } from "../lib/credits.js";
import { MISTAKE_TYPES, type PracticePlan, type PracticeQuestion, type Question, type Section, type SheetEvaluation } from "../ai/schemas.js";

export const practiceRoutes = Router();
const student = requireRole("student");
const RETEST_DAYS = Number(process.env.PRACTICE_RETEST_DAYS ?? 7);
const briefLimit = rateLimit("ai-brief", 30, 60 * 60 * 1000, (r) => r.user?.org_id ?? r.ip ?? "?");

const sqlTime = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
const parseSql = (t: string | null) => (t ? Date.parse(t.replace(" ", "T") + "Z") : 0);

/** Mistake type of one evaluated question (older evaluations have no type: infer what we can). */
export const mistakeOf = (qe: SheetEvaluation["questions"][number]): string =>
  !qe.attempted ? "not_attempted" : qe.marks_awarded >= qe.max_marks ? "none" : (qe as any).mistake_type && (qe as any).mistake_type !== "none" ? (qe as any).mistake_type : "unclassified";

/** Marks lost per mistake type for one evaluation. */
export function lostByType(ev: SheetEvaluation | null) {
  const out: Record<string, number> = {};
  for (const qe of ev?.questions ?? []) {
    const lost = Math.max(0, qe.max_marks - Math.max(0, qe.marks_awarded));
    if (lost <= 0) continue;
    const t = mistakeOf(qe);
    out[t] = (out[t] ?? 0) + lost;
  }
  return out;
}

// ---------------- Generation (background jobs) ----------------
const failPractice = (attemptId: string, msg: string) => run("UPDATE practice_sets SET status = 'failed', error = ? WHERE attempt_id = ? AND status = 'generating'", msg, attemptId);
registerJob<{ attempt_id: string; org_id?: string; charge_ref?: string | null }>("build_practice", {
  concurrency: Number(process.env.PRACTICE_CONCURRENCY ?? 2),
  run: ({ attempt_id }) => buildPractice(attempt_id),
  onFail: ({ attempt_id, org_id, charge_ref }, msg) => { failPractice(attempt_id, msg); refund(org_id, charge_ref, "Refund: Fix-it practice couldn't be prepared"); },
});
/** Queues Fix-it plans; with `org`, each is paid with credits (students the institute can't pay for get a clear "no credits" status). */
function enqueue(attemptIds: string[], org?: string) {
  for (const id of attemptIds) {
    if (one("SELECT 1 FROM jobs WHERE dedupe_key = ? AND status IN ('queued','processing')", `practice:${id}`)) continue;
    let chargeRef: string | null = null;
    if (org) {
      try { chargeRef = charge(org, "practice_set", `practice:${id}:${uid("c")}`); }
      catch (e) { if (e instanceof CreditError) { failPractice(id, e.message); continue; } throw e; }
    }
    enqueueJob("build_practice", { attempt_id: id, org_id: org, charge_ref: chargeRef }, { orgId: org, dedupeKey: `practice:${id}` });
  }
}

async function buildPractice(attemptId: string) {
  const a = one<any>(`SELECT a.*, t.org_id, t.title, p.subject, p.class_level, p.language, p.sections, u.name AS student_name
    FROM attempts a JOIN tests t ON t.id = a.test_id JOIN question_papers p ON p.id = t.paper_id JOIN users u ON u.id = a.student_id WHERE a.id = ?`, attemptId);
  if (!a) return;
  {
    const ev = json<SheetEvaluation | null>(a.evaluation, null);
    const qs = new Map(json<Section[]>(a.sections, []).flatMap((s) => s.questions).map((q) => [q.id, q]));
    const lostQs = (ev?.questions ?? []).filter((qe) => qe.max_marks - qe.marks_awarded > 0 && qs.has(qe.question_id));
    if (!lostQs.length) { run("DELETE FROM practice_sets WHERE attempt_id = ?", attemptId); return; }
    const lost: LostQuestion[] = lostQs.map((qe) => {
      const q = qs.get(qe.question_id)!;
      return {
        question: q.text.slice(0, 600), topic: q.topic, marks: qe.max_marks, awarded: qe.marks_awarded,
        mistake_type: mistakeOf(qe), mistake_note: ((qe as any).mistake_note ?? "").slice(0, 200),
        missed_steps: qe.steps.filter((s) => s.awarded < s.max_marks).map((s) => s.step.slice(0, 160)),
        student_wrote: (qe.transcription ?? "").slice(0, 300), feedback: (qe.feedback ?? "").slice(0, 300),
      };
    });
    const lostMarks = lost.reduce((t, l) => t + (l.marks - Math.max(0, l.awarded)), 0);
    const practiceCount = Math.min(8, Math.max(5, lost.length + 2));
    const checkupCount = Math.min(5, Math.max(3, Math.ceil(lost.length / 2) + 1));
    const plan = await generatePractice(a.org_id, {
      studentFirstName: String(a.student_name).split(" ")[0], subject: a.subject, classLevel: a.class_level, language: a.language ?? "English",
      lost, practiceCount, checkupCount,
    });
    const clean = (list: PracticeQuestion[]) => list.filter((q) => q.type === "numeric" ? q.numeric_answer !== null : q.options.length >= 2 && q.correct_option !== null && q.correct_option >= 0 && q.correct_option < q.options.length);
    const practice = clean(plan.practice), checkup = clean(plan.checkup);
    if (!practice.length) throw new AiError("The practice questions couldn't be prepared. Try again.");
    const baseline = Math.round((lost.reduce((t, l) => t + Math.max(0, l.awarded), 0) / lost.reduce((t, l) => t + l.marks, 0)) * 100);
    run("UPDATE practice_sets SET status = 'ready', focus = ?, questions = ?, max_score = ?, baseline_pct = ?, error = NULL WHERE attempt_id = ? AND kind = 'practice'",
      plan.focus, JSON.stringify(practice), practice.length, baseline, attemptId);
    if (checkup.length)
      run("UPDATE practice_sets SET status = 'ready', focus = ?, questions = ?, max_score = ?, baseline_pct = ?, error = NULL WHERE attempt_id = ? AND kind = 'checkup'",
        `A quick check-up on what you practised from "${a.title}". It shows how much you've improved.`, JSON.stringify(checkup), checkup.length, baseline, attemptId);
    else run("DELETE FROM practice_sets WHERE attempt_id = ? AND kind = 'checkup'", attemptId);
    void lostMarks;
  }
}

/** Called when results are published: one Fix-it plan per student who lost marks. Returns how many were queued. */
export function queuePracticeForTest(testId: string, onlyAttempts?: string[]): number {
  const t = one<{ org_id: string }>("SELECT org_id FROM tests WHERE id = ?", testId);
  if (!t || aiProblem(t.org_id)) return 0;
  const rows = all<{ id: string; student_id: string; score: number; max_score: number; p: string | null }>(`SELECT a.id, a.student_id, a.score, a.max_score,
      (SELECT status FROM practice_sets ps WHERE ps.attempt_id = a.id AND ps.kind = 'practice') AS p
    FROM attempts a WHERE a.test_id = ? AND a.status = 'evaluated' AND a.score IS NOT NULL AND a.score < a.max_score`, testId)
    .filter((r) => (!r.p || r.p === "failed") && (!onlyAttempts || onlyAttempts.includes(r.id)));
  const available = sqlTime(new Date(Date.now() + RETEST_DAYS * 86400000));
  for (const r of rows) {
    run("DELETE FROM practice_sets WHERE attempt_id = ?", r.id);
    run("INSERT INTO practice_sets (id, org_id, test_id, attempt_id, student_id, kind, available_at) VALUES (?,?,?,?,?, 'practice', CURRENT_TIMESTAMP)", uid("prc"), t.org_id, testId, r.id, r.student_id);
    run("INSERT INTO practice_sets (id, org_id, test_id, attempt_id, student_id, kind, available_at) VALUES (?,?,?,?,?, 'checkup', ?)", uid("prc"), t.org_id, testId, r.id, r.student_id, available);
  }
  enqueue(rows.map((r) => r.id), t.org_id);
  return rows.length;
}

/** After a restart, resume plans that were being prepared; re-teach briefs that were interrupted are marked failed. */
export function recoverPractice() {
  // Plans queued by an older version (before jobs) are queued again; jobs resume by themselves.
  const ids = all<{ attempt_id: string }>(`SELECT DISTINCT attempt_id FROM practice_sets ps WHERE status = 'generating'
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'practice:' || ps.attempt_id AND j.status IN ('queued','processing'))`).map((r) => r.attempt_id);
  if (ids.length) { console.log(`Queuing ${ids.length} Fix-it plan(s)`); enqueue(ids); }
  run(`UPDATE tests SET brief_status = 'failed', brief_error = 'Interrupted by a server restart. Please create it again.'
    WHERE brief_status = 'generating' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'brief:' || tests.id AND j.status IN ('queued','processing'))`);
}

// ---------------- Student side ----------------
/** Practice Questions page: Fix-it practice for every test, newest first (counts and average improvement). */
practiceRoutes.get("/practice/overview", staff, (req, res) => {
  const rows = all<any>(`SELECT t.id, t.title, t.created_at, t.subject,
      sum(ps.kind = 'practice') AS students,
      sum(ps.kind = 'practice' AND ps.status = 'generating') AS preparing,
      sum(ps.kind = 'practice' AND ps.status = 'failed') AS failed,
      sum(ps.kind = 'practice' AND ps.status = 'done') AS completed,
      sum(ps.kind = 'checkup' AND ps.status = 'done') AS checkup_done,
      round(avg(CASE WHEN ps.kind = 'checkup' AND ps.status = 'done' THEN ps.baseline_pct END)) AS baseline_avg,
      round(avg(CASE WHEN ps.kind = 'checkup' AND ps.status = 'done' AND ps.max_score > 0 THEN ps.score * 100.0 / ps.max_score END)) AS checkup_avg
    FROM practice_sets ps JOIN tests t ON t.id = ps.test_id
    WHERE ps.org_id = ? GROUP BY t.id ORDER BY t.created_at DESC LIMIT 200`, req.user!.org_id);
  res.json(rows);
});

practiceRoutes.get("/my/practice", student, (req, res) => {
  const rows = all<any>(`SELECT ps.id, ps.kind, ps.status, ps.score, ps.max_score, ps.available_at, ps.completed_at, ps.focus, ps.test_id,
      t.title AS test_title, p.subject, json_array_length(ps.questions) AS count, ps.answers
    FROM practice_sets ps JOIN tests t ON t.id = ps.test_id JOIN question_papers p ON p.id = t.paper_id
    WHERE ps.student_id = ? AND t.results_published = 1 AND ps.status IN ('ready','done') ORDER BY ps.created_at DESC`, req.user!.id);
  const now = Date.now();
  res.json(rows.map(({ answers, ...r }) => ({ ...r, answered: Object.keys(json(answers, {})).length, locked: r.kind === "checkup" && parseSql(r.available_at) > now })));
});

function mySet(id: string, studentId: string) {
  const s = one<any>(`SELECT ps.*, t.title AS test_title, p.subject, t.results_published FROM practice_sets ps JOIN tests t ON t.id = ps.test_id
    JOIN question_papers p ON p.id = t.paper_id WHERE ps.id = ? AND ps.student_id = ?`, id, studentId);
  return s && s.results_published && (s.status === "ready" || s.status === "done") ? s : null;
}
const isLocked = (s: any) => s.kind === "checkup" && parseSql(s.available_at) > Date.now();
const answerOf = (q: PracticeQuestion) => (q.type === "mcq" ? q.correct_option : q.numeric_answer);
const isCorrect = (q: PracticeQuestion, given: number) =>
  q.type === "mcq" ? given === q.correct_option : Math.abs(given - (q.numeric_answer ?? NaN)) <= Math.max(1e-6, Math.abs(q.numeric_answer ?? 0) * 0.01);

practiceRoutes.get("/practice/:id", student, (req, res) => {
  const s = mySet(req.params.id, req.user!.id);
  if (!s) return res.status(404).json({ error: "Practice not found" });
  if (isLocked(s)) return res.status(403).json({ error: "This check-up unlocks later", available_at: s.available_at });
  const answers = json<Record<string, { given: number; correct: boolean }>>(s.answers, {});
  // Correct answers and explanations are only sent for questions the student has already answered.
  const questions = json<PracticeQuestion[]>(s.questions, []).map((q) => {
    const a = answers[q.id];
    const base = { id: q.id, type: q.type, text: q.text, options: q.options, topic: q.topic, targets: q.targets };
    return a ? { ...base, given: a.given, correct: a.correct, answer: answerOf(q), explanation: q.explanation } : base;
  });
  res.json({ id: s.id, kind: s.kind, status: s.status, focus: s.focus, test_title: s.test_title, subject: s.subject, score: s.score, max_score: s.max_score, baseline_pct: s.baseline_pct, questions });
});

practiceRoutes.post("/practice/:id/answer", student, (req, res) => {
  const { question_id, answer } = z.object({ question_id: z.string().max(10), answer: z.number().finite() }).parse(req.body);
  const s = mySet(req.params.id, req.user!.id);
  if (!s) return res.status(404).json({ error: "Practice not found" });
  if (isLocked(s)) return res.status(403).json({ error: "This check-up unlocks later" });
  const qs = json<PracticeQuestion[]>(s.questions, []);
  const q = qs.find((x) => x.id === question_id);
  if (!q) return res.status(400).json({ error: "Unknown question" });
  if (q.type === "mcq" && !(Number.isInteger(answer) && answer >= 0 && answer < q.options.length)) return res.status(400).json({ error: "Pick one of the options" });
  const answers = json<Record<string, { given: number; correct: boolean }>>(s.answers, {});
  if (answers[q.id]) return res.status(409).json({ error: "Already answered" });
  const correct = isCorrect(q, answer);
  answers[q.id] = { given: answer, correct };
  const done = qs.every((x) => answers[x.id]);
  const score = Object.values(answers).filter((x) => x.correct).length;
  run(`UPDATE practice_sets SET answers = ?, score = ?, status = ?, completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id = ?`,
    JSON.stringify(answers), score, done ? "done" : "ready", done ? 1 : 0, s.id);
  res.json({ correct, answer: answerOf(q), explanation: q.explanation, done, score, max_score: qs.length });
});

// ---------------- Teacher side ----------------
practiceRoutes.get("/tests/:id/insights", staff, (req, res) => {
  const t = one<any>("SELECT t.*, p.sections FROM tests t LEFT JOIN question_papers p ON p.id = t.paper_id WHERE t.id = ? AND t.org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  const attempts = all<any>(`SELECT a.id, a.evaluation, a.score, a.max_score FROM attempts a WHERE a.test_id = ? AND a.status = 'evaluated'`, t.id);
  const qs = json<Section[]>(t.sections, []).flatMap((s) => s.questions);
  const mistakes: Record<string, number> = {};
  const perQ = new Map(qs.map((q) => [q.id, { got: 0, max: 0, attempted: 0, n: 0, types: {} as Record<string, number> }]));
  for (const a of attempts) {
    const ev = json<SheetEvaluation | null>(a.evaluation, null);
    for (const [k, v] of Object.entries(lostByType(ev))) mistakes[k] = (mistakes[k] ?? 0) + v;
    for (const qe of ev?.questions ?? []) {
      const s = perQ.get(qe.question_id); if (!s) continue;
      s.got += Math.max(0, qe.marks_awarded); s.max += qe.max_marks; s.n++; if (qe.attempted) s.attempted++;
      const m = mistakeOf(qe); if (m !== "none") s.types[m] = (s.types[m] ?? 0) + 1;
    }
  }
  const questions = qs.map((q, i) => {
    const s = perQ.get(q.id)!;
    const top = Object.entries(s.types).sort((x, y) => y[1] - x[1])[0];
    return { id: q.id, n: i + 1, topic: q.topic, text: q.text.slice(0, 160), marks: q.marks, avg_pct: s.max ? Math.round((s.got / s.max) * 100) : null,
      attempted_pct: s.n ? Math.round((s.attempted / s.n) * 100) : null, top_mistake: top?.[0] ?? null };
  });
  const sets = all<any>(`SELECT ps.attempt_id, ps.kind, ps.status, ps.score, ps.max_score, ps.baseline_pct, ps.error, json_array_length(ps.answers) AS x FROM practice_sets ps WHERE ps.test_id = ?`, t.id);
  const byAttempt: Record<string, any> = {};
  for (const s of sets) (byAttempt[s.attempt_id] ??= {})[s.kind] = { status: s.status, score: s.score, max_score: s.max_score, baseline_pct: s.baseline_pct, error: s.error };
  const pr = sets.filter((s) => s.kind === "practice"), ck = sets.filter((s) => s.kind === "checkup" && s.status === "done");
  const pct = (s: any) => (s.max_score ? (s.score / s.max_score) * 100 : 0);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  res.json({
    mistakes, questions,
    brief: json(t.brief, null), brief_status: t.brief_status, brief_error: t.brief_error,
    practice: {
      students: pr.length,
      preparing: pr.filter((s) => s.status === "generating").length,
      failed: pr.filter((s) => s.status === "failed").length,
      completed: pr.filter((s) => s.status === "done").length,
      practice_avg: avg(pr.filter((s) => s.status === "done").map(pct)),
      checkup_done: ck.length,
      baseline_avg: avg(ck.map((s) => s.baseline_pct ?? 0)),
      checkup_avg: avg(ck.map(pct)),
      by_attempt: byAttempt,
    },
  });
});

practiceRoutes.post("/tests/:id/practice", staff, (req, res) => {
  const t = one<any>("SELECT id, results_published FROM tests WHERE id = ? AND org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  const problem = aiProblem(req.user!.org_id);
  if (problem) return res.status(400).json({ error: problem });
  if (!t.results_published) return res.status(400).json({ error: "Publish the results first. Fix-it practice is created for published results." });
  const only = z.array(z.string()).max(1000).optional().parse(req.body?.attempt_ids);
  res.json({ queued: queuePracticeForTest(t.id, only) });
});

practiceRoutes.post("/tests/:id/brief", staff, briefLimit, (req, res) => {
  const t = one<any>("SELECT t.*, p.sections, coalesce(nullif(trim(t.subject),''), p.subject) AS subject FROM tests t JOIN question_papers p ON p.id = t.paper_id WHERE t.id = ? AND t.org_id = ?", req.params.id, req.user!.org_id);
  if (!t) return res.status(404).json({ error: "Test not found" });
  const problem = aiProblem(req.user!.org_id);
  if (problem) return res.status(400).json({ error: problem });
  if (t.brief_status === "generating") return res.status(409).json({ error: "The brief is already being written" });
  const attempts = all<any>("SELECT evaluation FROM attempts WHERE test_id = ? AND status = 'evaluated'", t.id);
  if (attempts.length < 1) return res.status(400).json({ error: "Evaluate some answer sheets first" });
  const qs = json<Section[]>(t.sections, []).flatMap((s) => s.questions);
  const qById = new Map(qs.map((q) => [q.id, q]));
  const stats = new Map<string, { got: number; max: number; types: Record<string, number> }>();
  const examples: { question: string; topic: string; student_wrote: string; mistake: string; note: string }[] = [];
  const mistakeTotals: Record<string, number> = {};
  for (const a of attempts) {
    const ev = json<SheetEvaluation | null>(a.evaluation, null);
    for (const [k, v] of Object.entries(lostByType(ev))) mistakeTotals[k] = (mistakeTotals[k] ?? 0) + v;
    for (const qe of ev?.questions ?? []) {
      const s = stats.get(qe.question_id) ?? { got: 0, max: 0, types: {} }; stats.set(qe.question_id, s);
      s.got += Math.max(0, qe.marks_awarded); s.max += qe.max_marks;
      const m = mistakeOf(qe);
      if (m !== "none") s.types[m] = (s.types[m] ?? 0) + 1;
      if (m !== "none" && m !== "not_attempted" && qe.transcription && examples.length < 40 && Math.random() < 0.5)
        examples.push({ question: qe.question_id, topic: qById.get(qe.question_id)?.topic ?? "", student_wrote: qe.transcription.slice(0, 240), mistake: m, note: ((qe as any).mistake_note ?? "").slice(0, 160) });
    }
  }
  const questions = qs.map((q) => { const s = stats.get(q.id); return { id: q.id, topic: q.topic, question: q.text.slice(0, 300), marks: q.marks, class_avg_pct: s?.max ? Math.round((s.got / s.max) * 100) : null, mistakes: s?.types ?? {} }; });
  const chargeRef = charge(req.user!.org_id, "reteach_brief", `brief:${t.id}:${uid("c")}`, { userId: req.user!.id }); // throws when out of credits
  run("UPDATE tests SET brief_status = 'generating', brief_error = NULL WHERE id = ?", t.id);
  enqueueJob("reteach_brief", { test_id: t.id, org_id: req.user!.org_id, charge_ref: chargeRef,
    input: { title: t.title, subject: t.subject, students: attempts.length, questions, examples, mistakeTotals } }, { orgId: req.user!.org_id, dedupeKey: `brief:${t.id}` });
  res.json({ ok: true });
});

registerJob<{ test_id: string; org_id: string; charge_ref: string | null; input: Parameters<typeof generateBrief>[1] }>("reteach_brief", {
  concurrency: 2,
  run: async ({ test_id, org_id, input }) => { run("UPDATE tests SET brief = ?, brief_status = 'ready' WHERE id = ?", JSON.stringify(await generateBrief(org_id, input)), test_id); },
  onFail: ({ test_id, org_id, charge_ref }, msg) => { run("UPDATE tests SET brief_status = 'failed', brief_error = ? WHERE id = ?", msg, test_id); refund(org_id, charge_ref, "Refund: the brief couldn't be written"); },
});

// Student report card: where marks go across all published tests, and Fix-it progress.
export function studentMistakeSummary(studentId: string, publishedOnly: boolean) {
  const rows = all<{ evaluation: string }>(`SELECT a.evaluation FROM attempts a JOIN tests t ON t.id = a.test_id
    WHERE a.student_id = ? AND a.status = 'evaluated' ${publishedOnly ? "AND t.results_published = 1" : ""}`, studentId);
  const totals: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(lostByType(json(r.evaluation, null)))) totals[k] = (totals[k] ?? 0) + v;
  const sets = all<any>(`SELECT ps.kind, ps.status, ps.score, ps.max_score, ps.baseline_pct FROM practice_sets ps JOIN tests t ON t.id = ps.test_id
    WHERE ps.student_id = ? ${publishedOnly ? "AND t.results_published = 1" : ""}`, studentId);
  const done = (k: string) => sets.filter((s) => s.kind === k && s.status === "done");
  const pct = (s: any) => (s.max_score ? Math.round((s.score / s.max_score) * 100) : 0);
  const ck = done("checkup");
  return {
    mistakes: totals,
    practice: { sets: sets.filter((s) => s.kind === "practice").length, completed: done("practice").length,
      checkups_done: ck.length, before_pct: ck.length ? Math.round(ck.reduce((t, s) => t + (s.baseline_pct ?? 0), 0) / ck.length) : null,
      after_pct: ck.length ? Math.round(ck.reduce((t, s) => t + pct(s), 0) / ck.length) : null },
  };
}

export { MISTAKE_TYPES };
export type { PracticePlan, Question };
