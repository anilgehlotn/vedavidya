// All file storage goes through this module. Today files live on the server's disk (DATA_DIR/uploads);
// a Cloudflare R2 / S3 implementation of the same interface can replace LocalDiskStorage without
// changing any other code. Keys are relative paths like "docs/doc_1/p-0001.jpg".
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Response } from "express";
import { UPLOAD_DIR } from "../db.js";

export interface Storage {
  /** Store a file under `key`, from a local path (moved) or a buffer. */
  put(key: string, from: string | Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Size in bytes, or null if missing. */
  size(key: string): Promise<number | null>;
  /** Delete files (missing ones are ignored). */
  remove(keys: string[]): Promise<void>;
  /** Run `fn` with a local file path for tools that need one (pdftoppm, sharp). */
  withLocalFile<T>(key: string, fn: (localPath: string) => Promise<T>): Promise<T>;
  /** Stream a file to an HTTP response. */
  send(res: Response, key: string, opts?: { contentType?: string; maxAge?: number }): void;
}

const KEY = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]{0,250}$/;
export function assertKey(key: string) {
  if (!KEY.test(key) || key.includes("//")) throw new Error(`Bad storage key: ${key}`);
}

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf", ".zip": "application/zip" };

export class LocalDiskStorage implements Storage {
  constructor(private root: string) { fs.mkdirSync(root, { recursive: true }); }
  private full(key: string) { assertKey(key); return path.join(this.root, key); }
  async put(key: string, from: string | Buffer) {
    const dest = this.full(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (typeof from !== "string") return fsp.writeFile(dest, from);
    try { await fsp.rename(from, dest); }
    catch { await fsp.copyFile(from, dest); await fsp.rm(from, { force: true }); } // across disks
  }
  read(key: string) { return fsp.readFile(this.full(key)); }
  async exists(key: string) { try { await fsp.access(this.full(key)); return true; } catch { return false; } }
  async size(key: string) { try { return (await fsp.stat(this.full(key))).size; } catch { return null; } }
  async remove(keys: string[]) {
    for (const k of keys) { try { await fsp.rm(this.full(k), { force: true }); } catch { /* bad key: nothing to delete */ } }
  }
  async withLocalFile<T>(key: string, fn: (p: string) => Promise<T>) { return fn(this.full(key)); }
  send(res: Response, key: string, opts: { contentType?: string; maxAge?: number } = {}) {
    let full: string;
    try { full = this.full(key); } catch { res.status(404).end(); return; }
    res.setHeader("Cache-Control", `private, max-age=${opts.maxAge ?? 3600}`);
    res.type(opts.contentType ?? TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream");
    res.sendFile(full, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  }
}

export const storage: Storage = new LocalDiskStorage(UPLOAD_DIR);

/** A fresh private temp directory for processing (deleted by the caller with `cleanTemp`). */
export const makeTemp = () => fsp.mkdtemp(path.join(os.tmpdir(), "vv-"));
export const cleanTemp = (dir: string) => fsp.rm(dir, { recursive: true, force: true });
