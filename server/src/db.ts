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
  paper_id TEXT NOT NULL REFERENCES question_papers(id) ON DELETE CASCADE,
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
