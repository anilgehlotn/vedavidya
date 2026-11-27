import "./env.js";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { ZodError } from "zod";
import { requireAuth, demoReadOnly } from "./auth.js";
import { publicRoutes } from "./routes/public.js";
import { orgRoutes, ClientError } from "./routes/org.js";
import { paperRoutes, recoverPaperJobs } from "./routes/papers.js";
import { testRoutes, recoverEvaluations } from "./routes/tests.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { settingsRoutes } from "./routes/settings.js";
import { practiceRoutes, recoverPractice } from "./routes/practice.js";
import { reportRoutes } from "./routes/reports.js";
import { uploadRoutes, cleanStaleUploads } from "./routes/uploads.js";
import { adminRoutes } from "./routes/admin.js";
import { startJobs } from "./lib/jobs.js";
import { scheduleBackups } from "./lib/backup.js";
import { FileProblem } from "./lib/files.js";
import { CreditError } from "./lib/credits.js";

const PROD = process.env.NODE_ENV === "production";
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // behind Render's proxy: use the real client IP for rate limits

// The site and API share one origin in production, so cross-origin access is only needed in development.
if (!PROD) app.use(cors());
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Content-Security-Policy: only this site's own scripts can run; fonts from Google Fonts; files shown via blob: URLs.
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'",
    "frame-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; "));
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", publicRoutes);
app.use("/api", requireAuth, demoReadOnly, orgRoutes, paperRoutes, testRoutes, practiceRoutes, reportRoutes, analyticsRoutes, settingsRoutes, uploadRoutes, adminRoutes);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") });
  if (err instanceof ClientError) return res.status(err.status).json({ error: err.message });
  if (err instanceof FileProblem) return res.status(400).json({ error: err.message });
  if (err instanceof CreditError) return res.status(402).json({ error: err.message, code: "no_credits" });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "This piece of the upload is too large. Refresh the page and try again." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
  if (err?.code === "ERR_SQLITE_ERROR" && /UNIQUE/.test(String(err.message))) return res.status(409).json({ error: "That already exists" });
  console.error(err);
  res.status(500).json({ error: PROD ? "Something went wrong on our side. Please try again." : String(err?.message ?? err) });
};
app.use(onError);

// In production the API also serves the built frontend.
const webDist = path.resolve("../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { maxAge: "1h", setHeaders: (res, p) => { if (p.includes("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); } }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

recoverPaperJobs();
recoverEvaluations();
recoverPractice();
startJobs();
scheduleBackups();
cleanStaleUploads();
setInterval(cleanStaleUploads, 3600_000).unref();

// Last-resort safety net: an unexpected async error is logged instead of taking the whole server down.
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Veda Vidya API on http://localhost:${port}`));
