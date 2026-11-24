import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { one } from "./db.js";

const SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)) {
  throw new Error("JWT_SECRET must be set to a long random value in production");
}

export type Role = "admin" | "teacher" | "student";
export interface AuthUser { id: string; org_id: string; role: Role; name: string; email: string | null }

declare global {
  namespace Express { interface Request { user?: AuthUser & { is_demo: number } } }
}

/** Sessions carry the user's token version; changing a password bumps it and signs out every other device. */
export const signToken = (u: { id: string }) => {
  const v = one<{ token_version: number }>("SELECT token_version FROM users WHERE id = ?", u.id)?.token_version ?? 0;
  return jwt.sign({ sub: u.id, v }, SECRET, { expiresIn: "7d", algorithm: "HS256" });
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  // Only the Authorization header is accepted: tokens never appear in URLs, logs or browser history.
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    const { sub, v } = jwt.verify(token, SECRET, { algorithms: ["HS256"] }) as { sub: string; v?: number };
    const user = one<AuthUser & { token_version: number; is_demo: number }>(
      "SELECT u.id, u.org_id, u.role, u.name, u.email, u.token_version, o.is_demo FROM users u JOIN orgs o ON o.id = u.org_id WHERE u.id = ?", sub);
    if (!user || (v ?? 0) !== user.token_version) return res.status(401).json({ error: "Session expired - sign in again" });
    const { token_version: _, ...safe } = user;
    req.user = safe;
    next();
  } catch {
    res.status(401).json({ error: "Session expired - sign in again" });
  }
}

export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) =>
  req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: "You don't have access to this" });

export const staff = requireRole("admin", "teacher");
export const adminOnly = requireRole("admin");

// The public demo institute is read-only (its logins are printed on the login page). Students may still take the demo online test.
const DEMO_WRITES_ALLOWED = /^\/cbt\//;
export function demoReadOnly(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.is_demo || req.method === "GET") return next();
  if (DEMO_WRITES_ALLOWED.test(req.path)) return next();
  res.status(403).json({ error: "The demo institute is read-only. Create your own institute to try this." });
}
