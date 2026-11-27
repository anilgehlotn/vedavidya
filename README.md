# Veda Vidya

AI evaluation, question-paper generation and student analytics for schools and coaching institutes.

Veda Vidya is an independent rebuild of the kind of product offered by acadine.ai (see
[docs/REVERSE_ENGINEERING.md](docs/REVERSE_ENGINEERING.md) for what was learned and how it maps here).

## What it does

- **Marketing site:** home, about, contact (lead capture), login and signup.
- **AI question papers:** pick the board, class, topics, language, difficulty and sections. Claude writes original
  questions with answer keys, worked solutions and step-wise marking rubrics. Everything can be edited, cloned and printed.
- **AI answer-sheet evaluation:** upload phone photos or PDFs of each student's handwritten sheet. Claude reads the
  handwriting (English, Hindi and other scripts), marks every question against the rubric with partial credit, and writes
  feedback. Teachers review, override marks and re-evaluate.
- **Online (CBT) tests:** timed, with a question palette, mark-for-review, autosave, auto-submit, and +/− marking.
- **Results:** publish to students, export CSV, and share a parent report link that needs no login.
- **Analytics:** batch score trends, topic mastery, score distribution, leaderboard, and student report cards.
- **Mistake analysis:** every lost mark is tagged as a concept gap, careless slip, incomplete steps, presentation, or not
  attempted, with a one-line note. Students see "where the marks went" per test and across their report card. Teachers
  see the class breakdown, the weakest questions, and an AI **re-teach brief** (top misconceptions, an anonymised real wrong
  answer, a 10-minute re-teach plan, and a check question).
- **Fix-it practice:** when results are published, each student who lost marks gets 5–8 auto-marked questions aimed at
  exactly their mistakes, with instant explanations, plus a check-up after `PRACTICE_RETEST_DAYS` (default 7) on the same
  skills. Teachers see completion and the "test → check-up" improvement on those weak spots. This costs one extra AI call
  per student per published test.
- **Institute management:** centres, batches, students (bulk add with generated logins), staff, a notice board, and
  roles for admins, teachers and students.

## Stack

| Part | Tech |
|---|---|
| Frontend | React 18, Vite, React Router, plain CSS design tokens, hand-rolled SVG charts |
| API | Node 22, Express, Zod validation, JWT auth, bcrypt |
| Database | SQLite via Node's built-in `node:sqlite` (file in `server/data/`) |
| AI | Anthropic Claude (`@anthropic-ai/sdk`), structured outputs, vision and PDF input |

## Run it

Requires Node 22.5 or newer.

```bash
npm install
```

```bash
cp server/.env.example server/.env   # then set JWT_SECRET
```

```bash
npm run seed    # demo institute: admin@demo.school / teacher1@demo.school / student, all with password demo1234
```

```bash
npm run dev     # web on http://localhost:5173, API on http://localhost:4000
```

Production: run `npm run build`, then `JWT_SECRET=... npm start`. That serves the built site and the API together on port 4000.

Each institute adds its own Claude API key in **Settings → AI engine**. The key is checked against the API, stored
encrypted (AES-256-GCM, derived from `JWT_SECRET`), and never sent back to the browser. Everything except paper generation
and answer-sheet evaluation works without a key. The public demo institute can never use a key, and its scores are
synthetic, not produced by the AI.

### Uploads and background processing

- **Resumable uploads.** Files go to the server in 5 MB pieces (`/api/uploads`): each piece is retried with backoff,
  an interrupted upload resumes from the last piece received, and uploads can be cancelled. The browser checks
  type, size and page count first; the server checks again, including the real file type, page count,
  password protection and damage (poppler's `pdfinfo`).
- **Limits** (`server/src/lib/limits.ts`, shared with the browser via `/api/config`): question paper and answer key
  50 MB / 50 pages; one student's sheet 50 MB / 40 pages; a class scan (PDF or ZIP) 250 MB / 600 pages; photos 25 MB.
- **Documents and pages.** Every upload becomes a document; a background job turns PDFs, photos and ZIPs into page
  images (`pdftoppm`, sharp) and stores each page with its number, width and height.
- **Jobs.** Reading papers, generating papers, rendering pages, marking sheets and tagging sub-topics run as jobs in
  the SQLite `jobs` table: queued → processing → completed / failed, 3 tries with exponential backoff
  (10 s, 40 s…), errors stored and shown in the app. Jobs interrupted by a restart are picked up again.
  PDF parsing and AI calls never run inside a web request.
- **Storage.** All file access goes through `server/src/lib/storage.ts` (local disk today); a Cloudflare R2 / S3
  implementation of the same interface can be dropped in without other changes.

On a test, **Upload class answer sheets** takes one scanned PDF (or a ZIP) in roll-number order; once its pages are
ready, the teacher sets pages per student, unticks absentees and assigns them. **Upload by file name** accepts files
named by roll number (`7.jpg`, `7-1.jpg`, `Roll 12.pdf`), and each student's row has its own upload.

### Backups

A copy of the SQLite database is made daily with SQLite's online backup API into `BACKUP_DIR`
(default `DATA_DIR/backups`); the newest 14 are kept. Super-admins (`SUPER_ADMIN_EMAILS`) can run
`POST /api/admin/backup` and list copies with `GET /api/admin/backups`.

### Testing without an API key

`scripts/mock-claude.mjs` imitates the Claude API, including streaming, its size limits and random 429/529 errors.
`scripts/e2e-api.mjs` runs about 470 checks over every endpoint, including a 50-student upload and marking run, role and
institute isolation, and cleanup. `scripts/e2e-institute.mjs` simulates a full institute: classes 8–12 with 20–30 students, 4 subject
teachers and 21 tests, after which all 125 students sign in and must see only their own results. `scripts/e2e-restart.mjs` checks that marking resumes after a restart. `scripts/e2e-ui-shell.mjs` checks the app shell in Chromium (menu, flyouts, breadcrumbs, search, toasts, skeletons, empty/error states, phone drawer, every page on a phone). `scripts/e2e-ui-phase2.mjs` drives the real pages in Chromium (credits panel, Platform page, Courses card, teacher note on mark changes); run it on a fresh server started with `SUPER_ADMIN_EMAILS=root-admin@example.com` and a `PLATFORM_CLAUDE_KEY` starting `sk-ant-test-valid` (the mock only accepts those).

```bash
MOCK_FAIL_RATE=0.3 node scripts/mock-claude.mjs
```

```bash
cd server && NODE_ENV=production JWT_SECRET=x DATA_DIR=/tmp/vv PORT=4300 ANTHROPIC_BASE_URL=http://localhost:4999 npx tsx src/index.ts
```

```bash
DATA_DIR=/tmp/vv node scripts/e2e-api.mjs
```

## Layout

```
server/src/
  ai/claude.ts       paper generation + answer-sheet evaluation (Claude)
  ai/schemas.ts      Zod schemas for papers, rubrics and evaluations
  routes/            public (auth, contact, parent report), org, papers, tests (incl. CBT), analytics
  db.ts              schema + helpers
  seed.ts            demo institute
web/src/
  pages/site/        marketing site, login, public report
  pages/app/         AppLayout (sidebar shell), dashboard, institute, papers, tests, practice, analytics, student + CBT
  components/ui.tsx  page header + breadcrumbs, skeletons, empty/error states, charts, hooks
  components/toast.tsx  toast notifications (useToast, useRun)
  components/icons.tsx  line icons
```

## Roles and security

| | Admin | Teacher | Student |
|---|---|---|---|
| Classes (batches), centres, staff, institute settings, Claude key | ✅ | view only | - |
| Add / edit students, reset one student's password | ✅ | ✅ | - |
| Remove students, reset a whole class's passwords | ✅ | - | - |
| Upload or generate papers, create tests, upload sheets, evaluate, review, publish | ✅ | ✅ | - |
| Delete a test after results are published | ✅ | - | - |
| See own published results, report card, notices; take online tests | - | - | ✅ |

Teachers see every class in their institute. Institutes never see each other's data.

- **Passwords and sessions:** bcrypt hashes; 7-day sessions sent only in the `Authorization` header, never in URLs. Changing or resetting a password signs out every other device.
- **Brute force:** per account (any network), per account and network, and a per-network cap high enough for a whole class on one Wi-Fi. Login time is the same whether or not an account exists.
- **Students** see their scores only after results are published, and only their own. Parent report links reveal only that student's marks and feedback, never the answer key.
- **Uploads:** type and content checked, photos re-encoded or size-checked, stored under random names, served only to staff of the same institute.
- **Headers:** a strict Content-Security-Policy (own scripts only), HSTS, frame blocking and nosniff. CORS is off in production.
- **Claude key:** checked before saving, AES-256-GCM encrypted, never returned to the browser. AI paper requests are capped at 30 an hour per institute.
- **The public demo institute** is read-only and can never use an API key.
- **Data safety:** a paper used by tests can't be deleted; deleting tests or students removes their files.
- **Spreadsheets:** CSV exports neutralise spreadsheet formulas.

Run `npm audit --omit=dev` before each release.

## Configuration (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_MODEL_STRONG` / `_MID` / `_FAST` | `claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5` | Models behind each tier. Each institute picks Mixed (Opus writes papers and answer keys, Haiku marks, Sonnet re-checks doubtful answers), Sonnet-only or Opus-only in Settings → AI engine |
| `JWT_SECRET` | dev value | **Required in production**. Also encrypts stored API keys, so if you change it, re-enter the key |
| `ALLOW_SIGNUP` | `true` | Set `false` to stop strangers creating institutes from the login page |
| `SEED_DEMO` | `true` (Docker) | Creates the public demo institute on first start |
| `EVAL_CONCURRENCY` | `3` | Answer sheets evaluated in parallel |
| `PRACTICE_CONCURRENCY` | `2` | Fix-it plans prepared in parallel |
| `PRACTICE_RETEST_DAYS` | `7` | Days before a student's Fix-it check-up unlocks |
| `PORT` | `4000` | API port |
| `DATA_DIR` | `server/data` | Database and uploaded sheets |
| `SUPER_ADMIN_EMAILS` | empty | Comma-separated emails of platform owners (backups, job status) |
| `BACKUP_DIR` / `BACKUP_KEEP` | `DATA_DIR/backups` / `14` | Where daily database backups go, and how many are kept |
| `RENDER_CONCURRENCY` | `1` | Uploads turned into page images in parallel (CPU and memory heavy) |
| `JOB_BACKOFF_SCALE` | `1` | Multiplies retry waits (tests use a small value) |

## Deploy (app.vedavidya.co)

The app is one Docker container that serves the website, the app and the API. It needs a **persistent disk**
mounted at `/data` (database and uploaded answer sheets), so use Render, Railway or Fly.io rather than Vercel.

On Render, choose **New → Blueprint** and pick this repo, then add the Claude key in the app under Settings → AI engine. `render.yaml` sets up the service,
a 5 GB disk, a generated `JWT_SECRET` and the demo institute. Then go to **Settings → Custom Domains**, add `app.vedavidya.co`,
and create the CNAME record Render shows you at your DNS provider (GoDaddy).

Set `SEED_DEMO=false` once you onboard real institutes if you don't want the demo accounts.
