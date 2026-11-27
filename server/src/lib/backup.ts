// Daily SQLite backups using SQLite's online backup API (safe while the app is running).
// Copies go to BACKUP_DIR (default DATA_DIR/backups), separate from the main database file; the newest 14 are kept.
import fs from "node:fs";
import path from "node:path";
import { backup } from "node:sqlite";
import { db, DATA_DIR } from "../db.js";

export const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(DATA_DIR, "backups");
const KEEP = Number(process.env.BACKUP_KEEP ?? 14);
const DAY = 24 * 3600 * 1000;

export interface BackupFile { file: string; size: number; created_at: string }

export function listBackups(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => /^vedavidya-\d{8}-\d{6}(-\d{3})?(-[a-z]+)?\.db$/.test(f)).sort().reverse()
    .map((f) => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { file: f, size: st.size, created_at: st.mtime.toISOString() }; });
}

let running: Promise<BackupFile> | null = null;
/** Makes a backup now (one at a time) and deletes all but the newest copies. */
export function runBackup(reason: "daily" | "manual" = "daily"): Promise<BackupFile> {
  if (running) return running;
  running = (async () => {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const iso = new Date().toISOString(); // e.g. 2026-11-27T13:55:24.736Z → 20261127-135524-736
    const stamp = `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}-${iso.slice(20, 23)}`;
    const file = `vedavidya-${stamp}-${reason}.db`;
    const tmp = path.join(BACKUP_DIR, `.${file}.partial`);
    await backup(db, tmp);
    fs.renameSync(tmp, path.join(BACKUP_DIR, file)); // a half-written copy never looks like a real backup
    for (const old of listBackups().slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.file), { force: true });
    const st = fs.statSync(path.join(BACKUP_DIR, file));
    console.log(`Backup saved: ${file} (${Math.round(st.size / 1024)} KB)`);
    return { file, size: st.size, created_at: st.mtime.toISOString() };
  })().finally(() => { running = null; });
  return running;
}

/** Checks every hour; backs up when the newest copy is more than a day old. */
export function scheduleBackups() {
  const check = () => {
    const newest = listBackups()[0];
    if (!newest || Date.now() - Date.parse(newest.created_at) > DAY) runBackup("daily").catch((e) => console.error("Backup failed:", e));
  };
  setTimeout(check, 60_000).unref();
  setInterval(check, 3600_000).unref();
}
