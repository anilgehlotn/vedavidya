# Reverse-engineering notes: acadine.ai

This document records what was learned by examining the public website **https://www.acadine.ai/** on 24 Nov 2026,
and how each finding maps onto the Veda Vidya rebuild in this repository.

Method: only public, unauthenticated material was examined - the rendered public pages (`/`, `/about`, `/contact`,
`/login`) and the JavaScript/CSS bundles the site serves to every visitor. No accounts were created, no login was
attempted and no API endpoints were called. No code, images, copy or branding from the original were copied into
this repository; Veda Vidya is an independent implementation of the same *kind* of product.

## 1. What the product is

An AI platform for Indian coaching institutes and schools ("Run your institute smarter"), built by Ardonik
Technologies Pvt. Ltd. Core value propositions on the homepage:

| Pillar | What it does |
|---|---|
| Evaluate answer sheets | AI grades scanned **handwritten** answer sheets with step-wise partial marking, in English, Hindi and Sanskrit, aligned to CBSE / ICSE / UPSC / state boards |
| Generate question papers | Original papers in minutes with control over difficulty, marks distribution, question types and language |
| Performance analytics | Student → batch → centre drill-down, topic/chapter mastery, trends across exam cycles |
| One dashboard (LMS) | Multi-centre, multi-course management; schedules, lectures, announcements, role-based access |
| Exam formats | Online CBT (proctored, palette, +4/−1), OMR bubble sheets, digital homework/assignments |
| Delivery | Results and scorecards to parents over WhatsApp/email; white-label iOS/Android apps |

Marketing claims seen: 200+ institutes, 80k+ sheets/month, 22 Indian languages, 98%+ accuracy, ISO 27001.

## 2. Technology stack (from the served bundles)

| Layer | Evidence | Technology |
|---|---|---|
| Hosting | `server: AmazonS3`, `via: CloudFront` headers | Static SPA on S3 + CloudFront |
| Frontend | Vite-style hashed chunks (`core-framework-*.js`, `mui-extended-*.js`, `data-viz-*.js`, `editor-*.js`) | React + Material UI (MUI X date pickers), a ProseMirror-based rich-text editor, pdf.js / pdf-lib, SheetJS |
| API | `https://api.acadine.ai/graphql` (+ `api-dev`, `api-qa`) | GraphQL with **subscriptions** for long-running AI jobs |
| Auth | SuperTokens references; OTP by email/phone plus username+password | SuperTokens session auth, OTP login |
| Push / mobile | `ExchangeSessionForFirebaseToken`, `RegisterDeviceToken`, S3 live-update manifest | Firebase messaging, Capacitor-style mobile app with live updates |
| Analytics / errors | `us.i.posthog.com`, Sentry references, Meta pixel | PostHog, Sentry, Facebook pixel |
| Misc | `api.postalpincode.in` | Indian PIN-code lookup for addresses |
| Fonts / colour | Google Fonts request; `theme-color #602AF8` | Plus Jakarta Sans, Playfair Display, Newsreader; violet accent on warm off-white |

## 3. Application surface

### Routes in the SPA (70)
Public: `/`, `/about`, `/contact`, `/login`, `/privacy-policy`, `/terms-and-conditions`, `/join/:inviteId`, `/t/:code`,
`/public-report/:token`, `/public-cbt-report/:token`, `/public-multi-report/:token`.

App: `/home`, `/overview`, `/analytics`, `/centres`, `/centres/:centre_id/batches/:batch_id`, `/batches`, `/courses`,
`/students`, `/students/:student_id`, `/teachers`, `/admins`, `/manage-people`, `/manage-organization`, `/settings`,
`/calendar`, `/lectures`, `/notice-board`, `/study-materials`, `/assignments`, `/assignments/:id`,
`/question-papers` (+ `generate-question-paper`, `:id/edit|review|view`), `/practice-papers` (+ edit/review/view),
`/tests`, `/tests/:testId`, `/tests/:testId/answer-sheets-mapping/:uploadId`, `/tests-dashboard`, `/test-series`,
`/test-series/:seriesId`, `/review`, `/review/:id/edit`, `/publish-results`, `/publish-results/:publicationId`,
`/test-attempts/:id/evaluation-report`, `/report-card/:id`, `/student-tests`, `/cbt-test/:testId`,
`/cbst-test/:testId`, `/cbt-report/:id`.

### GraphQL operations (≈ 400) grouped by domain
- **Question papers (AI):** `GenerateQuestionPaper`, `GenerateQuestionPaperWithAgent`, `ImportQuestionPaperFromPDF(WithAnswerKey)`,
  `TranslateQuestionPaper`, `RefineQuestionWithChat`, `RefineQuestionSolution`, `RefineQuestionEvaluationCriteria`,
  `ReplaceQuestion`, `GenerateImage`, `GenerateEvalCriteriaFromPDF`, `SolveQuestionPaperQuestion`, `TemplatiseQuestionPaper`,
  subscriptions `QuestionPaperUpdates`, `QuestionPaperStatusUpdates`, `ChatGenerationUpdates`.
- **Evaluation:** `InitiateBulkAnswerPDFUpload` / `ConfirmBulkAnswerPDFUpload`, `InitiateAnswerZipUpload`,
  `CreateAnswerSheetSegment` / `ApproveAnswerSheetSegment` (split a bulk PDF into per-student sheets),
  `UnmappedTestSubmission` (match sheets to students), `StartBulkEvaluation`, `TriggerTestEvaluation`,
  `RetryTestAttemptEvaluation`, `ReevaluateQuestionAcrossTest`, `UpdateCriterionEvaluation`, `AwardGraceMarks`,
  subscription `TestEvaluationUpdates`.
- **Results:** `PublishResult`, `RepublishResult`, `UnpublishResult`, `SendEvaluationReports`, `GenerateShareToken`,
  `GenerateTestResultsPDF`, `GetTestResultsExcel`, `RequestBulkReportPdf`, `RequestBatchConsolidatedReport`.
- **CBT:** `StartCbtAttempt`, `SaveCbtAnswers`, `MarkCbtQuestions`, `SubmitCbtAttempt(FromSnapshot)`, `RecordTestViolation`
  (proctoring), `PingTestAttempt`, `InitiateCbtSync`.
- **Institute:** centres, batches, org courses & subjects, students (`OnboardStudentsBulk`, credentials CSV,
  `SwitchStudentBatch`), teachers, staff, enrollments/invites, notices, calendar, lectures & lecture halls, study materials,
  assignments, test series.
- **Analytics:** `GetBatchPerformanceBreakdown`, `GetBatchScoreTrends`, `GetStudentPerformanceBreakdown`,
  `GetTestTopicPerformanceAnalytics`, `GetTeacherLeaderboard`, `GetOrgTestAnalytics…`, `GetBestPerformers`.
- **Billing:** `GetOrgCreditBalances`, `GetOrgCreditTransactions`, `CreatePaymentLink` - usage is metered in credits.

Roles referenced: `SUPER_ADMIN`, `ORG_ADMIN`, `ADMIN`, `TEACHER`, `STUDENT`, `PARENT`.

## 4. How Veda Vidya maps to it

| Original capability | Veda Vidya | Notes |
|---|---|---|
| Marketing site (hero, problem, outcomes, formats, pillars, CTA, footer) | ✅ `web/src/pages/site/*` | Same information architecture; new copy, new hand-drawn sheet visuals, own brand |
| About / Contact (lead form) / Login | ✅ | Leads stored in `leads` table |
| Self-serve institute signup | ✅ | Original is sales-led; signup added for convenience |
| Centres, batches, students, teachers, bulk onboarding with credentials | ✅ | CSV paste → generated usernames/passwords |
| Notice board (org-wide or per batch) | ✅ | |
| AI question-paper generation with sections, marks, negative marking, language, difficulty | ✅ Claude structured output | Background job + polling (original uses GraphQL subscriptions) |
| Paper editor (questions, options, answers, solutions, rubrics), clone, print | ✅ | |
| Handwritten answer-sheet evaluation with step-wise rubric marks | ✅ Claude vision (images + PDF) | Per-student upload; worker pool with concurrency limit |
| Teacher review / override, re-evaluate | ✅ | |
| Publish results, CSV export, parent share links | ✅ `/report/:token` | |
| Online CBT with palette, mark-for-review, timer, autosave, +/- scoring | ✅ `/exam/:testId` | No fullscreen proctoring yet |
| Student portal & report card | ✅ | |
| Batch analytics: trend, topic mastery, distribution, leaderboard | ✅ | |
| Bulk single-PDF upload auto-split per student | ⏳ | Next step: page segmentation + roll-number detection |
| OMR bubble-sheet scanning | ⏳ | Can reuse the vision evaluator with an objective-only key |
| WhatsApp/email delivery, push notifications, mobile apps | ⏳ | Needs a messaging provider (e.g. WhatsApp Business API) |
| Lectures, calendar, study materials, assignments, test series | ⏳ | Same patterns as tests/notices |
| Credits & payments | ⏳ | |
| OTP login | ⏳ | Needs SMS/email provider |
