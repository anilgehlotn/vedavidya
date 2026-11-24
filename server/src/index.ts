import "./env.js";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { ZodError } from "zod";
import { requireAuth } from "./auth.js";
import { publicRoutes } from "./routes/public.js";
import { orgRoutes } from "./routes/org.js";
import { paperRoutes } from "./routes/papers.js";
import { testRoutes } from "./routes/tests.js";
import { analyticsRoutes } from "./routes/analytics.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, ai: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) }));
app.use("/api", publicRoutes);
app.use("/api", requireAuth, orgRoutes, paperRoutes, testRoutes, analyticsRoutes);

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") });
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
};
app.use(onError);

// In production the API also serves the built frontend.
const webDist = path.resolve("../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Veda Vidya API on http://localhost:${port}`));
