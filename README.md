# Markwise

AI evaluation, question-paper generation and student analytics for schools and coaching institutes.

Markwise is an independent rebuild of the kind of product offered by acadine.ai (see
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
cp server/.env.example server/.env   # then put your ANTHROPIC_API_KEY in it
```

```bash
npm run seed    # demo institute: admin@demo.school / teacher1@demo.school / student, all with password demo1234
```

```bash
npm run dev     # web on http://localhost:5173, API on http://localhost:4000
```

Production: run `npm run build`, then `JWT_SECRET=... npm start`. That serves the built site and the API together on port 4000.

Everything works without an API key except paper generation and answer-sheet evaluation, which show a clear error until
the key is set. The demo data's scores are synthetic. They were not produced by the AI.

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
| `ANTHROPIC_API_KEY` | none | Required for AI features |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for generation and evaluation |
| `JWT_SECRET` | dev value | **Required in production** |
| `EVAL_CONCURRENCY` | `3` | Answer sheets evaluated in parallel |
| `PORT` | `4000` | API port |
| `DATA_DIR` | `server/data` | Database and uploaded sheets |
