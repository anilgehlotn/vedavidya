// Tiny in-memory rate limiter (single server). Limits brute-force logins and form spam.
import type { Request, Response, NextFunction } from "express";

export function rateLimit(name: string, max: number, windowMs: number, keyOf: (req: Request) => string = (r) => r.ip ?? "?") {
  const hits = new Map<string, number[]>();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); }, windowMs).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${keyOf(req)}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
