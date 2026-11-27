# Veda Vidya: Redesign Plan (Phase 0 audit)

Status: Phase 0 and 1 done (on `main`). Phase 2 (data model, credits) and Phase 3 (app shell) done on branch `phase-2`, awaiting approval to merge. Phase 4 next.
Questions marked **🟡 DECISION** need your answer before the phase that depends on them.

---

## 1. What exists today

### 1.1 Stack (kept as is unless you approve a change)

| Layer | Today |
|---|---|
| Monorepo | npm workspaces: `server/` (API) and `web/` (frontend) |
| Backend | Node 22, Express 4, TypeScript run with `tsx`, Zod 4 validation |
| Database | SQLite through Node's built-in `node:sqlite`, one file at `$DATA_DIR/vedavidya.db`, with idempotent migrations in `server/src/db.ts` |
| Auth | Email or username plus password (bcrypt), JWT (HS256) in the `Authorization` header, `token_version` to revoke sessions; roles admin / teacher / student |
| File storage | Local disk (`$DATA_DIR/uploads`), on a 5 GB persistent disk on Render |
| Background jobs | In-process queues (marking, Fix-it practice, paper reading); state kept in SQLite, so interrupted marking resumes on restart |
| AI | Anthropic Claude via `@anthropic-ai/sdk`. Each institute stores its own API key (encrypted). Mixed mode: Opus for papers, Haiku for marking, Sonnet for second checks |
| PDF tools | `pdftoppm` (poppler) turns PDF pages into images on the server; `pdf-lib` splits and draws PDFs in the browser; `pdfkit` makes the report PDFs; `sharp` handles images |
| Frontend | React 18 + Vite 6 + react-router 7, plain CSS (no Tailwind), KaTeX for maths |
| Hosting | One Docker container on Render, auto-deployed from `main`; `app.vedavidya.co` |
| Tests | `scripts/e2e-api.mjs` (364 checks), `scripts/e2e-institute.mjs` (115), `scripts/e2e-restart.mjs`, plus Playwright walkthroughs; `scripts/mock-claude.mjs` stands in for the Claude API |

### 1.2 Colour tokens (kept everywhere, per rule 1)
Defined once in `web/src/styles.css` under `:root`:
- Brand: `--accent #e4522f`, `--accent-2 / --coral #ff6a4c`, `--accent-soft #ffece6`, `--ink #17171c`.
- Surfaces: `--bg #f1f1f4`, `--bg-2 #f4f4f7`, `--surface #fff`.
- Lines and text: `--line #ececf0`, `--line-2 #dcdce3`, `--ink-2 #55555f`, `--muted #8b8b96`.
- Accents: `--pink #f4a8dc`, `--sun #ffd60a`, `--sky`, `--lilac`.
- Status (already present): `--green/--green-soft`, `--amber/--amber-soft`, `--red/--red-soft`, `--blue/--blue-soft`.
- Fonts: Outfit (UI), Kalam (handwriting marks).

The redesign uses only these. The 12 px card radius in the brief is a layout value; today's cards use 24 px (`--radius`). I'll add a `--radius-card: 12px` token rather than changing colours.

### 1.3 Folder structure
```
server/src/
  index.ts            app, security headers (CSP/HSTS), error handler, static web
  db.ts               schema + migrations      auth.ts  JWT, roles, demo read-only
  ai/claude.ts        all Claude calls, model routing, usage log
  ai/schemas.ts       Zod schemas for structured AI output
  images.ts           upload checks, PDF→page images (pdftoppm)
  reports.ts          student + class PDF reports (pdfkit)
  routes/             public, org (people, batches), papers, tests, practice,
                      analytics, settings, reports
  seed.ts             demo institute
web/src/
  pages/site/         landing, about, contact, login, public report link
  pages/app/          AppLayout (top pill nav), Overview, Tests, TestFlow,
                      SheetView, Papers, Institute (batches/students/staff/
                      notices/settings), Analytics, Insights, Student
  lib/                api, auth, upload, split (browser PDF splitter), marks,
                      markedCopy, types
  components/         ui (Modal, useApi, badges, charts), MathText
scripts/              e2e suites, mock Claude
```

### 1.4 Database (SQLite)
`orgs` (institute; `ai_mode`, encrypted key) · `users` (admin/teacher/student) · `centres` · `batches` (`course` is **free text**) · `enrollments` (student↔batch, roll, parent contact) · `question_papers` (sections + questions stored as **JSON**; status generating/draft/approved/failed) · `tests` (paper optional, mode offline/cbt, subject, brief) · `test_batches` · `attempts` (one per student per test: `files` JSON list of page images, `evaluation` JSON with per-question marks, steps, mistakes, positions) · `share_tokens` (parent links) · `practice_sets` (Fix-it) · `notices` · `leads` · `ai_usage` (tokens per AI request).
Every table either has `org_id` or is reached through one, and every route checks the institute in its SQL.

### 1.5 Screens and API
- **Screens:** Overview, Tests list and Test page (4-step guide), Answer review with the corrected sheet (Smart Report), Papers list / generator / editor, Batches, Students, Staff, Notices, Settings (AI key, mode, cost meter), Analytics, student My tests / Report card / Fix-it / online exam, and the public parent report.
- **API:** 75 routes, plus `/api/health`. Highlights: `/papers/import|generate|approve|clone`, `/tests/:id/{paper,bulk-files,evaluate,publish,insights,brief,practice,results.csv,class-report.pdf,reports.pdf}`, `/attempts/:id/{files,evaluation,report.pdf}`, `/students/bulk`, `/settings/ai/{mode,usage}`, `/public/report/:token/{,files/:n,pdf}`.

---

## 2. Upload flows traced end to end, with bugs and risks

### Flow A: question paper import
Browser `ImportPaperModal` → shrinks photos → one `fetch` POST `multipart /papers/import` → multer writes to disk (25 MB per file, 40 files) → `normalisePage` (PDF: header check + 20 MB; images resized) → creates the paper row as `generating` → **reads it with Claude inside the web process** (a promise, not a job) → the paper becomes `draft` or `failed`.

### Flow B: answer sheets
- **Class wizard:** the browser loads the whole class PDF with pdf-lib, splits it by roll order, and uploads each student's part to `POST /attempts/:id/files`.
- **Other routes:** "Upload by file name" uses `POST /tests/:id/bulk-files` (40 MB chunks); each student's row has its own upload.
- **On the server:** PDFs → page images (`pdftoppm`, first 30 pages, 90 s limit) → stored on disk → "Mark" puts them in the marking queue.

### Bugs and risks (most serious first)

| # | Severity | Problem | Where |
|---|---|---|---|
| U1 | **High** | Uploads go through the API server in one request with no progress or cancel. Node's default 300 s request timeout cuts off slow uploads: a 40 MB bulk chunk on a 1 Mbps mobile upload takes about 5.5 min and fails. | `fetch` in `lib/api.ts`; Node `requestTimeout` = 300000 |
| U2 | **High** | The class splitter re-reads the **whole** class PDF for **every** student (`sources` is created inside `filesFor`). A 100-page, 80 MB scan read 40 times freezes or crashes phones and low-end laptops. | `web/src/lib/split.ts:54` |
| U3 | **High** | The question paper limit is 20 MB (the brief wants 50 MB / 50 pages). Paper + answer key are sent to Claude as base64 PDFs, so about 22 MB of PDFs passes upload but fails **minutes later** with "too large" after a paper record already exists. | `images.ts` `MAX_PDF_BYTES`, `claude.ts` `MAX_REQUEST_BYTES` |
| U4 | **High** | Password-protected or corrupt PDFs are accepted (only the `%PDF-` header is checked). They fail later inside the AI job (papers) or quietly stay as an unreadable PDF (answer sheets). | `normalisePage`, `normaliseSheet` |
| U5 | Medium | Answer-sheet PDFs longer than 30 pages are **silently cut** to 30 pages. | `images.ts` `MAX_SHEET_PAGES` |
| U6 | Medium | Paper reading is not a real job: no retries or backoff, and a restart turns it into "failed". Marking retries transient API errors (SDK), but a failed sheet needs a manual click; there's no attempt count or backoff. | `papers.ts`, `tests.ts` queue |
| U7 | Medium | Inconsistent limits and messages: multer allows 25 MB, `normalisePage` rejects PDFs over 20 MB, and the error says 25 MB. There's no page-count check anywhere on the server. | `index.ts` error handler, `images.ts` |
| U8 | Medium | Files live on one server's disk (5 GB). This can't scale to multiple servers, and the disk fills in about a term at 125 students (estimate). Signed browser-to-storage uploads aren't possible without object storage. | `UPLOAD_DIR` |
| U9 | Medium | Validation is only on the server; the browser checks file extensions only (no size or page count) before uploading. | `upload.ts isAllowedFile` |
| U10 | Low | Page width and height aren't stored. Annotation positions are page fractions, so this works, but cropping per question would need them. | `attempts.files` |
| U11 | Low | ZIP files are not supported at all. | n/a |
| U12 | Low | `@anthropic-ai/sdk` is pinned to `"latest"` in `server/package.json` (the lockfile protects builds today, but regenerating it could pull a breaking release). | `server/package.json` |
| U13 | Low | The paper import modal shows "Uploading…" with no percentage; when the paper fails to be read, the error only appears on the paper page later. | `Papers.tsx`, `TestFlow.tsx` |

---

## 3. Decisions needed before building

**🟡 D1: Storage for big uploads (Phase 1).** The brief asks for browser-to-storage signed URLs (S3/R2/Supabase). We don't have object storage, so that's a new service and a stack addition.
- **Option A (recommended now):** resumable **chunked** uploads to our own server, in 5 MB pieces with retry. That gives a progress bar, cancel and resume, avoids the 300 s timeout, and needs no new account. Files stay on the Render disk.
- **Option B:** add **Cloudflare R2** (S3-compatible, free egress; about $0.015/GB-month) with presigned PUT URLs straight from the browser. That needs an R2 account and keys, and it is the right move before many schools join.
- I'd do A now, with the code arranged so moving to B later is a swap of one storage module. Which do you want?

**🟡 D2: Job queue (Phase 1).** The brief suggests Redis + BullMQ/Celery. That's new infrastructure: a Redis service on Render, about $10/month.
- **Recommended:** a durable **jobs table in SQLite**. It gives queued → processing → completed/failed, 3 retries with exponential backoff, stored errors, resume after restart, and a worker loop in the same process. That meets every requirement in the brief without new infrastructure.
- Moving to BullMQ later is contained. OK?

**🟡 D3: Credits wallet (Phase 2).** Today each institute uses **its own Claude key** and pays Anthropic directly; Settings shows estimated cost.
- A credits wallet usually means **you** hold one platform key and sell credits. That's a business-model change: billing, top-ups, refunds.
- **Options:**
  - **(a)** A wallet as an internal ledger on top of the institute's own key. Every AI action logs and deducts credits, and admins see a balance and history. No real payments.
  - **(b)** A platform key plus paid credits. That needs a payment gateway such as Razorpay; a larger project.
  - **(c)** Skip the wallet; keep the cost meter.
- I recommend **(a)** now, built so (b) can be added later. Which one?

**🟡 D4: Data model depth (Phase 2).** The brief lists separate tables for Sections, Questions, Pages and QuestionResponses. Today, questions live as JSON inside the paper, and per-question results as JSON inside the attempt. Both are validated by Zod, and that works well.
- **Recommended, non-destructive:**
  - New tables: `courses`, `subjects`, `paper_folders`, `sheet_uploads` (one per uploaded class file), `sheet_pages` (page images with number, width, height, the student each page is mapped to, and approval), `jobs`, and `credit_ledger`.
  - Add `course_id` / `subject_id` to batches, papers and tests. Courses are back-filled from the existing free-text `batches.course` values; nothing is dropped.
  - Questions and per-question results **stay as JSON** with the new fields added: cognitive level, named evaluation criteria with reasons, annotation boxes and notes. Moving them into separate tables is a large migration with real risk and little benefit at this size.
- OK to keep JSON for questions and results?

**🟡 D5: Navigation change.** You earlier chose the current design (top pill nav, rounded frame). The brief replaces it with a left icon sidebar and a flyout. I'll do that with the **same colours and fonts**. Confirming that's intended.

**🟡 D6: Grading granularity.** The brief describes cropping each answer and grading **each question separately**. Today, one AI request reads the student's whole sheet and grades every question, returning positions too.
- One request per sheet is cheaper, by my rough estimate 3–5× fewer input tokens. It also handles answers that run across pages and needs no separate page-mapping step.
- **Recommended:** keep one request per sheet, but return exactly the strict JSON in the brief: criteria `{name, awarded, max, reason}`, `total`, `feedback`, `confidence`, and `annotations [{page, bbox, text, mark}]`, including short correction notes. Low-confidence answers are flagged as they are today.
- One note: the brief says temperature 0, but the current Claude models (Opus 5.5, Sonnet 5.5, Haiku 5.5) reject a temperature setting. Consistency comes from the strict output schema instead.
- OK?

**🟡 D7: Email for "Send Reports" (Phase 4).** Email needs a sending service, a new account (Resend, Amazon SES or SMTP). Which do you prefer? WhatsApp click-to-send links already exist and will stay.

**🟡 D8: Menu items with no feature yet.** "Assignments" and "Test Series" don't exist today. "Practice Questions" can show the per-student Fix-it practice and a question bank built from existing papers. Should I add Assignments and Test Series as "Coming soon" screens with good empty states, or leave them out of the menu?

---

## 4. Target screens: what exists, what's missing, what changes

| Target | Exists today | Missing | Change |
|---|---|---|---|
| **App shell** (icon sidebar, Assessments flyout, breadcrumbs, page header actions) | Top pill nav, page titles with actions | Sidebar, flyout, breadcrumbs, collapse, search icon, avatar with plan badge | New `AppShell`; every page gets `PageHeader {breadcrumbs, title, actions}` |
| **Toasts / skeletons / empty / error states** | Inline ok/error boxes, spinner `Loading`, `Empty` | Toast system, skeleton loaders | Add `ToastProvider` and `Skeleton*`; replace spinners |
| **Home dashboard** | Overview (stats + charts) | Greeting and date, Centre/Course filters, 4 stat cards with "+N new (last 1m)" trends, Course & Batch bar chart, recent students list | Rebuild Overview; `/overview` gets filters and trend counts |
| **Batches** | Batches page (create, edit, delete, logins) | Search, filters, grid/list toggle, transfer action, start date | New cards; add `start_date`; "transfer students" endpoint |
| **Onboard Students modal** | CSV paste bulk import, single add | Tabs, drag-and-drop .csv/.xlsx/.xls, sample CSV, row preview with errors, invite link | Parse xlsx in the browser (needs **SheetJS**, a new library, used only in the browser); invite-link signup with a token |
| **Question Papers list** | List, generate, blank, import | Folders, Compose, filter chips, course/subject filters, rich cards (badge, approved check, actions, creator avatar) | `paper_folders`, `source` column, `course_id/subject_id`, `created_by` shown |
| **Import Paper modal** | Upload modal (paper + key) | 50 MB / 50 pages, file card with pages and re-upload, 3 answer-key options, Evaluation Criteria (auto/custom), credit balance, progress | Chunked upload (D1), job (D2), PDF → page images, then AI reads images (fixes U3) |
| **Paper editor** | View/edit questions, approve | Summary bar, sticky section switcher with "solved" progress, collapsible sections, card toolbar (solution, AI assist, mark correct), solution drawer with Solution/Criteria tabs and Edit/Refine/Regenerate | New editor; AI "refine/regenerate question" endpoint; criteria = today's rubric steps, renamed |
| **Manage Tests** | Tests list with next-step badges | Download Results, filters (course, subject, time range), 4 stat cards with monthly average and % change, Recent Tests cards, Explore all | New stats endpoint; time-range filter |
| **Test Details** | 4-step guide page, roster table, insights | Info strip, Attendance card, Evaluation Progress per uploaded file, Rank List with status tabs and medals, Question-wise performance, Send Reports | Re-layout; keep the step guide as a compact "next step" banner |
| **Upload Answersheets** | Browser splitter (roll order), by-file-name, per-row | Server pipeline: one class PDF or a ZIP → split → **AI reads name/roll on first pages** → map pages to students → grade | `sheet_uploads` + `sheet_pages` + jobs; Haiku identifies students (cheap); the browser splitter retires (fixes U2) |
| **Review Mapping** | n/a | Thumbnail strip grouped by student, big viewer, assign/reassign student, drag pages, approve, "Skip approved" | New screen + endpoints |
| **AI grading** | Whole-sheet grading, strict schema, second check, flags, cost log | Named criteria with reasons, annotation text notes and boxes, credit deduction | Schema extension (D6); ledger (D3) |
| **Report Card** | Student review page, Smart Report split view, report PDF, parent link | Breadcrumbs, info grid, Class Rank with top %, Badges placeholder, Objective/Subjective tabs, **Topic-wise bar chart with tooltip**, correction notes on the sheet | New page combining today's pieces |
| **Send Reports** | WhatsApp links, report-links CSV, report PDFs | Email sending, per-student send status | Email provider (D7); `report_sends` log |
| **Data model** | See §1.4 | Courses, Subjects, folders, uploads/pages, jobs, credits | Additive migrations only (D4) |

**Kept (no features deleted):** the online CBT exam, Fix-it practice and check-ups, the re-teach brief, mistake analysis, sub-topics, student and class PDF reports, marked-copy PDFs, WhatsApp result links, the parent report link, mixed models with second checks and the cost meter, notices, analytics, the student app, the demo institute, the public landing site, and all security rules.

---

## 5. Phase plan

| Phase | Contents | Risky bits |
|---|---|---|
| **1. Upload and processing** | Chunked/resumable upload (or R2, D1) with progress, cancel and re-upload; one shared validator for browser and server (type, size, pages, corrupt, password); question paper 50 MB / 50 pages; `jobs` table with 3 retries, backoff and stored errors (D2); every PDF → page images with stored number, width and height; papers read from images; live job status in the UI; fixes U1–U13; tests for validation and the job pipeline | Raising limits needs the Render disk watched; old in-flight jobs migrate to the jobs table |
| **2. Data model** | Courses, subjects, folders, sheet uploads/pages, credit ledger (D3), new fields on papers/questions/results; back-fill from existing data; institute checks plus tests that prove isolation | Back-fill on live data. **I'll ask before running anything destructive; none is planned.** |
| **3. App shell** | Sidebar, flyout, breadcrumbs, page header, toasts, skeletons, the empty/error pattern | Every page touched; e2e scripts updated |
| **4. Screens** | In the order of the brief; each screen gets loading, empty and error states and toasts | Review Mapping and the upload pipeline are the largest pieces |
| **5. Polish** | Tablet layouts, keyboard and focus, seed (2 centres, 4 batches, 20 students, 3 papers, 1 fully graded test **with real-looking sheet images**), the full end-to-end run, final summary | The seed needs synthetic handwriting-style page images for the demo sheet |

After each phase: typecheck, build, run all suites and browser walkthroughs, summarise, commit, push. Render deploys automatically from `main`.
