// Durable background jobs, stored in SQLite: queued → processing → completed | failed.
// Each job gets up to 3 tries with exponential backoff; errors are stored. Jobs left "processing" by a
// restart go back to the queue. Work that parses files or calls the AI always runs here, never in a request.
import { all, json, one, run, uid } from "../db.js";

/** An error that retrying won't fix (bad file, missing key, no credits...). The job fails at once. */
export class PermanentError extends Error {}
/** Errors may say whether retrying could help (e.g. AiError for rate limits vs. a rejected key). */
const isRetryable = (e: unknown) => !(e instanceof PermanentError) && (e as { retryable?: boolean })?.retryable !== false;

export interface JobRow { id: string; org_id: string | null; type: string; payload: string; attempts: number; max_attempts: number; dedupe_key: string | null }
interface JobType<P> {
  run: (payload: P, job: JobRow) => Promise<unknown>;
  /** Called when the job has failed for good (after its last try or a permanent error). */
  onFail?: (payload: P, message: string, job: JobRow) => void;
  /** Called when a try failed and another one is scheduled. */
  onRetry?: (payload: P, message: string, job: JobRow, nextTryInSeconds: number) => void;
  concurrency: number;
}
const types = new Map<string, JobType<any>>();
const active = new Map<string, number>();

export function registerJob<P>(type: string, def: JobType<P>) { types.set(type, def); }

/** Delay before try n+1: 10 s, 40 s, 160 s... (base 10 s, ×4 each time, capped at 30 min). */
export const backoffSeconds = (attempt: number) => Math.min(1800, 10 * 4 ** Math.max(0, attempt - 1));
const BACKOFF_SCALE = Number(process.env.JOB_BACKOFF_SCALE ?? 1); // tests shorten the waits

/** Queues a job. With a dedupe key, an identical job that is still queued or running is reused. */
export function enqueueJob(type: string, payload: unknown, opts: { orgId?: string | null; dedupeKey?: string; maxAttempts?: number; delaySeconds?: number } = {}) {
  if (!types.has(type)) throw new Error(`Unknown job type ${type}`);
  if (opts.dedupeKey) {
    const existing = one<{ id: string }>("SELECT id FROM jobs WHERE dedupe_key = ? AND status IN ('queued','processing')", opts.dedupeKey);
    if (existing) return existing.id;
  }
  const id = uid("job");
  const runAt = new Date(Date.now() + (opts.delaySeconds ?? 0) * 1000).toISOString();
  run("INSERT INTO jobs (id, org_id, type, payload, dedupe_key, max_attempts, run_at) VALUES (?,?,?,?,?,?,?)",
    id, opts.orgId ?? null, type, JSON.stringify(payload ?? {}), opts.dedupeKey ?? null, opts.maxAttempts ?? 3, runAt);
  setImmediate(tick);
  return id;
}

export const jobStatus = (id: string) =>
  one<{ id: string; type: string; status: string; attempts: number; max_attempts: number; last_error: string | null; run_at: string }>(
    "SELECT id, type, status, attempts, max_attempts, last_error, run_at FROM jobs WHERE id = ?", id);

/** Latest job for a dedupe key (e.g. "mark:att_1"), to show its status in the UI. */
export const latestJob = (dedupeKey: string) =>
  one<{ id: string; status: string; attempts: number; max_attempts: number; last_error: string | null; run_at: string }>(
    "SELECT id, status, attempts, max_attempts, last_error, run_at FROM jobs WHERE dedupe_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", dedupeKey);

function claim(type: string): JobRow | null {
  const now = new Date().toISOString();
  const next = one<JobRow>("SELECT * FROM jobs WHERE type = ? AND status = 'queued' AND run_at <= ? ORDER BY run_at, rowid LIMIT 1", type, now);
  if (!next) return null;
  // Only one claimer wins (the status check makes the update atomic).
  const r = run("UPDATE jobs SET status = 'processing', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'", next.id);
  return r.changes ? { ...next, attempts: next.attempts + 1 } : null;
}

async function execute(def: JobType<any>, job: JobRow) {
  const payload = json<any>(job.payload, {});
  try {
    const result = await def.run(payload, job);
    run("UPDATE jobs SET status = 'completed', result = ?, last_error = NULL, finished_at = CURRENT_TIMESTAMP WHERE id = ?", JSON.stringify(result ?? null), job.id);
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
    if (isRetryable(e) && job.attempts < job.max_attempts) {
      const wait = backoffSeconds(job.attempts) * BACKOFF_SCALE;
      run("UPDATE jobs SET status = 'queued', last_error = ?, run_at = ? WHERE id = ?", message, new Date(Date.now() + wait * 1000).toISOString(), job.id);
      try { def.onRetry?.(payload, message, job, wait); } catch (err) { console.error(`${job.type} onRetry failed`, err); }
    } else {
      run("UPDATE jobs SET status = 'failed', last_error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?", message, job.id);
      try { def.onFail?.(payload, message, job); } catch (err) { console.error(`${job.type} onFail failed`, err); }
    }
  }
}

let ticking = false;
function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const [type, def] of types) {
      while ((active.get(type) ?? 0) < def.concurrency) {
        const job = claim(type);
        if (!job) break;
        active.set(type, (active.get(type) ?? 0) + 1);
        execute(def, job).finally(() => { active.set(type, (active.get(type) ?? 1) - 1); setImmediate(tick); });
      }
    }
  } finally { ticking = false; }
}

let started = false;
/** Starts the worker loop. Jobs interrupted by a restart are queued again. */
export function startJobs() {
  if (started) return;
  started = true;
  const r = run("UPDATE jobs SET status = 'queued', run_at = ? WHERE status = 'processing'", new Date().toISOString());
  if (r.changes) console.log(`Resuming ${r.changes} interrupted job(s)`);
  setInterval(tick, 500).unref();
  // Housekeeping: finished jobs are kept 30 days for troubleshooting.
  setInterval(() => run("DELETE FROM jobs WHERE status IN ('completed','failed') AND finished_at < datetime('now', '-30 days')"), 6 * 3600 * 1000).unref();
  tick();
}

/** Counts by status, for health checks and tests. */
export const jobCounts = () => all<{ type: string; status: string; n: number }>("SELECT type, status, count(*) n FROM jobs GROUP BY type, status");
