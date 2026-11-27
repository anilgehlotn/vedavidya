// SQLite persistence using Node's built-in driver (no native build step).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "vedavidya.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher','student')),
  name TEXT NOT NULL, email TEXT UNIQUE, phone TEXT, username TEXT UNIQUE,
  password_hash TEXT NOT NULL, subject TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS centres (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, city TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  centre_id TEXT REFERENCES centres(id) ON DELETE SET NULL,
  name TEXT NOT NULL, course TEXT, teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS enrollments (
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  roll_no TEXT, parent_name TEXT, parent_phone TEXT, parent_email TEXT,
  PRIMARY KEY (student_id, batch_id)
);
CREATE TABLE IF NOT EXISTS question_papers (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title TEXT NOT NULL, subject TEXT, board TEXT, class_level TEXT, language TEXT DEFAULT 'English',
  duration_min INTEGER DEFAULT 60, total_marks REAL DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('generating','draft','approved','failed')),
  sections TEXT NOT NULL DEFAULT '[]', instructions TEXT, error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  paper_id TEXT REFERENCES question_papers(id) ON DELETE CASCADE,
  title TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('offline','cbt')),
  scheduled_at TEXT, duration_min INTEGER DEFAULT 60,
  results_published INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS test_batches (
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  PRIMARY KEY (test_id, batch_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','uploaded','evaluating','evaluated','failed')),
  files TEXT DEFAULT '[]', responses TEXT DEFAULT '{}', evaluation TEXT,
  score REAL, max_score REAL, error TEXT, reviewed INTEGER DEFAULT 0,
  started_at TEXT, submitted_at TEXT, evaluated_at TEXT,
  UNIQUE (test_id, student_id)
);
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL, batch_id TEXT REFERENCES batches(id) ON DELETE CASCADE,
  created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS share_tokens (
  token TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, phone TEXT, institute TEXT,
  students TEXT, email TEXT, message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

export const uid = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;

type Row = Record<string, any>;
export const one = <T = Row>(sql: string, ...p: any[]) => db.prepare(sql).get(...p) as T | undefined;
export const all = <T = Row>(sql: string, ...p: any[]) => db.prepare(sql).all(...p) as T[];
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);

export const json = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

// ---- Migrations for databases created by earlier versions (safe to run every start) ----
const addColumn = (table: string, col: string, def: string) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addColumn("orgs", "is_demo", "INTEGER DEFAULT 0");
addColumn("orgs", "claude_key_enc", "TEXT");
addColumn("orgs", "claude_key_hint", "TEXT");
addColumn("users", "token_version", "INTEGER DEFAULT 0");
// The public demo institute must never use a real API key (its logins are published on the login page).
db.exec(`UPDATE orgs SET is_demo = 1 WHERE id IN (SELECT org_id FROM users WHERE email = 'admin@demo.school')`);
db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_test ON attempts(test_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id, role)");
db.exec("CREATE INDEX IF NOT EXISTS idx_enroll_batch ON enrollments(batch_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)");
db.exec("CREATE INDEX IF NOT EXISTS idx_tests_org ON tests(org_id)");

/** Signs the user out everywhere (after a password change or reset). */
export const bumpTokenVersion = (userId: string) => run("UPDATE users SET token_version = coalesce(token_version, 0) + 1 WHERE id = ?", userId);

// ---- Fix-it practice and re-teach briefs ----
db.exec(`
CREATE TABLE IF NOT EXISTS practice_sets (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('practice','checkup')),
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating','ready','done','failed')),
  focus TEXT, questions TEXT DEFAULT '[]', answers TEXT DEFAULT '{}',
  score REAL, max_score REAL, baseline_pct REAL, available_at TEXT, error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
  UNIQUE (attempt_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_practice_student ON practice_sets(student_id);
CREATE INDEX IF NOT EXISTS idx_practice_test ON practice_sets(test_id);
`);
addColumn("tests", "brief", "TEXT");
addColumn("tests", "brief_status", "TEXT");
addColumn("tests", "brief_error", "TEXT");

// ---- Tests can be created before their question paper is added (older databases had paper_id NOT NULL) ----
{
  const col = (db.prepare("PRAGMA table_info(tests)").all() as { name: string; notnull: number }[]).find((c) => c.name === "paper_id");
  if (col?.notnull) {
    const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tests'").get() as { sql: string };
    const newSql = sql.replace(/CREATE TABLE "?tests"?/, "CREATE TABLE tests__new").replace(/paper_id TEXT NOT NULL REFERENCES/, "paper_id TEXT REFERENCES");
    if (newSql === sql || !newSql.includes("tests__new")) throw new Error("tests migration: unexpected schema");
    const before = (db.prepare("SELECT count(*) n FROM tests").get() as { n: number }).n;
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN");
      db.exec(newSql);
      db.exec("INSERT INTO tests__new SELECT * FROM tests");
      db.exec("DROP TABLE tests");
      db.exec("ALTER TABLE tests__new RENAME TO tests");
      const after = (db.prepare("SELECT count(*) n FROM tests").get() as { n: number }).n;
      if (after !== before) throw new Error(`tests migration copied ${after}/${before} rows`);
      const bad = db.prepare("PRAGMA foreign_key_check").all();
      if (bad.length) throw new Error(`tests migration broke ${bad.length} references`);
      db.exec("COMMIT");
      console.log(`Migrated tests table (${after} tests): question paper can now be added later`);
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    finally { db.exec("PRAGMA foreign_keys = ON"); }
  }
}
addColumn("tests", "subject", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_tests_org ON tests(org_id)");

// ---- Which Claude models an institute uses, and what each AI request cost (for the monthly bill) ----
addColumn("orgs", "ai_mode", "TEXT DEFAULT 'mixed'");
db.exec(`CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  task TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_ai_usage_org ON ai_usage(org_id, created_at)");

// ---- Phase 1: resumable uploads, documents (uploaded files and their page images) and background jobs ----
db.exec(`
CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, filename TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
  received INTEGER NOT NULL DEFAULT 0, pages INTEGER,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','complete','used','failed','aborted')),
  error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status, updated_at);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, title TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]', size INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  error TEXT, pages INTEGER DEFAULT 0,
  test_id TEXT REFERENCES tests(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE CASCADE,
  paper_id TEXT REFERENCES question_papers(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_test ON documents(test_id);
CREATE INDEX IF NOT EXISTS idx_documents_attempt ON documents(attempt_id);
CREATE TABLE IF NOT EXISTS document_pages (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL, storage_key TEXT NOT NULL, width INTEGER, height INTEGER, source_name TEXT,
  PRIMARY KEY (document_id, page_no)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, org_id TEXT REFERENCES orgs(id) ON DELETE CASCADE,
  type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  run_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_error TEXT, result TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, started_at TEXT, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status, type, run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key, status);
`);

// ---- Phase 2: courses & subjects, paper folders, credits, teacher corrections (all additive) ----
db.exec(`
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, board TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (org_id, name)
);
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (course_id, name)
);
CREATE TABLE IF NOT EXISTS paper_folders (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (org_id, name)
);
-- Credits: every movement is a row; the balance is the sum. Two buckets: monthly free credits (expire at month end)
-- and granted credits (added by the platform owner, never expire). Charges use free credits first.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('monthly_free','grant','charge','refund','expire','adjust')),
  bucket TEXT NOT NULL CHECK (bucket IN ('free','paid')),
  amount REAL NOT NULL, action TEXT, ref TEXT, month TEXT, note TEXT,
  created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_credit_org ON credit_ledger(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_ref ON credit_ledger(ref);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_month ON credit_ledger(org_id, month) WHERE kind = 'monthly_free';
CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Every teacher change to AI marks, kept for improving the marking later. Deliberately no foreign keys:
-- rows survive when the test, student or institute is deleted. Never delete from this table.
CREATE TABLE IF NOT EXISTS grade_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL, test_id TEXT, attempt_id TEXT NOT NULL, paper_id TEXT, question_id TEXT NOT NULL,
  question_text TEXT, question_type TEXT, max_marks REAL,
  ai_marks REAL, ai_criteria TEXT, ai_reason TEXT, ai_confidence TEXT,
  teacher_marks REAL NOT NULL, teacher_note TEXT,
  model TEXT, page_refs TEXT, teacher_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_corrections_org ON grade_corrections(org_id, created_at);
CREATE TRIGGER IF NOT EXISTS grade_corrections_keep BEFORE DELETE ON grade_corrections
  BEGIN SELECT RAISE(ABORT, 'grade_corrections rows are never deleted'); END;
`);
addColumn("batches", "course_id", "TEXT REFERENCES courses(id) ON DELETE SET NULL");
addColumn("batches", "start_date", "TEXT");
addColumn("question_papers", "course_id", "TEXT REFERENCES courses(id) ON DELETE SET NULL");
addColumn("question_papers", "subject_id", "TEXT REFERENCES subjects(id) ON DELETE SET NULL");
addColumn("question_papers", "folder_id", "TEXT REFERENCES paper_folders(id) ON DELETE SET NULL");
addColumn("question_papers", "source", "TEXT"); // generated | imported | composed (unknown for older papers)
addColumn("question_papers", "approved_at", "TEXT");
addColumn("tests", "course_id", "TEXT REFERENCES courses(id) ON DELETE SET NULL");
addColumn("tests", "subject_id", "TEXT REFERENCES subjects(id) ON DELETE SET NULL");
addColumn("tests", "window_end", "TEXT");
addColumn("orgs", "monthly_free_credits", "REAL"); // null = platform default

// Back-fill: courses from the free-text course names on batches; subjects from tests (course of their batch + subject).
{
  const pending = db.prepare("SELECT id, org_id, trim(course) AS course FROM batches WHERE course_id IS NULL AND course IS NOT NULL AND trim(course) != ''").all() as { id: string; org_id: string; course: string }[];
  for (const b of pending) {
    let c = db.prepare("SELECT id FROM courses WHERE org_id = ? AND name = ? COLLATE NOCASE").get(b.org_id, b.course) as { id: string } | undefined;
    if (!c) { c = { id: uid("crs") }; db.prepare("INSERT INTO courses (id, org_id, name) VALUES (?,?,?)").run(c.id, b.org_id, b.course); }
    db.prepare("UPDATE batches SET course_id = ? WHERE id = ?").run(c.id, b.id);
  }
  const tests = db.prepare(`SELECT t.id, t.org_id, coalesce(nullif(trim(t.subject),''), trim(p.subject)) AS subject,
      (SELECT b.course_id FROM test_batches tb JOIN batches b ON b.id = tb.batch_id WHERE tb.test_id = t.id AND b.course_id IS NOT NULL LIMIT 1) AS course_id
    FROM tests t LEFT JOIN question_papers p ON p.id = t.paper_id WHERE t.course_id IS NULL`).all() as { id: string; org_id: string; subject: string | null; course_id: string | null }[];
  for (const t of tests) {
    if (!t.course_id) continue;
    let subjectId: string | null = null;
    if (t.subject) {
      let s = db.prepare("SELECT id FROM subjects WHERE course_id = ? AND name = ? COLLATE NOCASE").get(t.course_id, t.subject) as { id: string } | undefined;
      if (!s) { s = { id: uid("sub") }; db.prepare("INSERT INTO subjects (id, org_id, course_id, name) VALUES (?,?,?,?)").run(s.id, t.org_id, t.course_id, t.subject); }
      subjectId = s.id;
    }
    db.prepare("UPDATE tests SET course_id = ?, subject_id = ? WHERE id = ?").run(t.course_id, subjectId, t.id);
  }
  // Papers take the course/subject of the first test that uses them; papers with an uploaded original are "imported".
  db.exec(`UPDATE question_papers SET course_id = (SELECT t.course_id FROM tests t WHERE t.paper_id = question_papers.id AND t.course_id IS NOT NULL LIMIT 1),
      subject_id = (SELECT t.subject_id FROM tests t WHERE t.paper_id = question_papers.id AND t.subject_id IS NOT NULL LIMIT 1)
    WHERE course_id IS NULL`);
  db.exec(`UPDATE question_papers SET source = 'imported' WHERE source IS NULL AND EXISTS (SELECT 1 FROM documents d WHERE d.paper_id = question_papers.id AND d.purpose = 'paper')`);
  db.exec(`UPDATE question_papers SET approved_at = created_at WHERE status = 'approved' AND approved_at IS NULL`);
}
addColumn("question_papers", "updated_at", "TEXT");
db.exec("UPDATE question_papers SET updated_at = created_at WHERE updated_at IS NULL");

// ---- Phase 4: invite links (a student joins a batch from a shared link) ----
db.exec(`
CREATE TABLE IF NOT EXISTS invite_links (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE, created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_invites_org ON invite_links(org_id, created_at);
`);
addColumn("question_papers", "marking_notes", "TEXT"); // the teacher's own marking rules, used when writing rubrics and when marking
