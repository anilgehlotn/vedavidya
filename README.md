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

### Uploading a whole class

On a test, **Bulk upload** accepts photos or PDFs named by roll number, for example `7.jpg`, `7-1.jpg`, `7-2.jpg` or
`Roll 12.pdf`. Photos are shrunk in the browser and again on the server, so they always fit Claude's 5 MB image limit.
Sheets are marked in the background, 3 at a time by default (`EVAL_CONCURRENCY`). Busy or rate-limit errors are retried
automatically, and sheets that were being marked when the server restarted are resumed.

### Testing without an API key

`scripts/mock-claude.mjs` imitates the Claude API, including streaming, its size limits and random 429/529 errors.
`scripts/e2e-api.mjs` runs 193 checks over every endpoint, including a 50-student upload and marking run, role and
institute isolation, and cleanup. `scripts/e2e-restart.mjs` checks that marking resumes after a restart.

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
  pages/app/         dashboard, institute, papers, tests, analytics, student + CBT
  components/ui.tsx  shared UI, charts, hooks
```

## Configuration (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for generation and evaluation |
| `JWT_SECRET` | dev value | **Required in production**. Also encrypts stored API keys, so if you change it, re-enter the key |
| `ALLOW_SIGNUP` | `true` | Set `false` to stop strangers creating institutes from the login page |
| `SEED_DEMO` | `true` (Docker) | Creates the public demo institute on first start |
| `EVAL_CONCURRENCY` | `3` | Answer sheets evaluated in parallel |
| `PORT` | `4000` | API port |
| `DATA_DIR` | `server/data` | Database and uploaded sheets |

## Deploy (app.vedavidya.co)

The app is one Docker container that serves the website, the app and the API. It needs a **persistent disk**
mounted at `/data` (database and uploaded answer sheets), so use Render, Railway or Fly.io rather than Vercel.

On Render, choose **New → Blueprint** and pick this repo, then add the Claude key in the app under Settings → AI engine. `render.yaml` sets up the service,
a 5 GB disk, a generated `JWT_SECRET` and the demo institute. Then go to **Settings → Custom Domains**, add `app.vedavidya.co`,
and create the CNAME record Render shows you at your DNS provider (GoDaddy).

Set `SEED_DEMO=false` once you onboard real institutes if you don't want the demo accounts.
