import "./env.js";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { ZodError } from "zod";
import { requireAuth } from "./auth.js";
import { publicRoutes } from "./routes/public.js";
import { orgRoutes, ClientError } from "./routes/org.js";
import { paperRoutes, recoverPaperJobs } from "./routes/papers.js";
import { testRoutes, recoverEvaluations } from "./routes/tests.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { settingsRoutes } from "./routes/settings.js";

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
  next();
});
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", publicRoutes);
app.use("/api", requireAuth, orgRoutes, paperRoutes, testRoutes, analyticsRoutes, settingsRoutes);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") });
  if (err instanceof ClientError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "A file is larger than 25 MB. Use a smaller photo or split the PDF."
      : err.code === "LIMIT_FILE_COUNT" ? "Too many files in one upload." : `Upload problem: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request is too large" });
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

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Veda Vidya API on http://localhost:${port}`));
