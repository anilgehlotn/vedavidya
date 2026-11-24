// Encrypts secrets (Claude API keys) at rest with AES-256-GCM.
import crypto from "node:crypto";

const master = () => crypto.createHash("sha256").update(process.env.KEY_SECRET ?? process.env.JWT_SECRET ?? "dev-secret-change-me").digest();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", master(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    const [iv, tag, data] = blob.split(".").map((p) => Buffer.from(p, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", master(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  } catch {
    return null; // secret changed or data corrupted: treat as not configured
  }
}
