import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { one } from "./db.js";

const SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production");
}

export type Role = "admin" | "teacher" | "student";
export interface AuthUser { id: string; org_id: string; role: Role; name: string; email: string | null }

declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

export const signToken = (u: AuthUser) => jwt.sign({ sub: u.id }, SECRET, { expiresIn: "7d" });

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    const { sub } = jwt.verify(token, SECRET) as { sub: string };
    const user = one<AuthUser>("SELECT id, org_id, role, name, email FROM users WHERE id = ?", sub);
    if (!user) return res.status(401).json({ error: "Account not found" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Session expired - sign in again" });
  }
}

export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) =>
  req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: "You don't have access to this" });

export const staff = requireRole("admin", "teacher");
export const adminOnly = requireRole("admin");
