# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```
npm run dev        # Start dev server (localhost:3000)
npm run build      # Production build
npm run start      # Start production server
npm run lint       # ESLint
npm run db:migrate # prisma migrate dev (apply schema changes + reseed)
npm run db:seed    # Seed demo teacher + class (tsx prisma/seed.ts)
npm run db:studio  # Open Prisma Studio (inspect dev.db)
```

Tests (no test framework configured; pure-function unit tests run via `npx tsx`):
```
npx tsx scripts/test-stage-advance.ts      # canAdvance gating
npx tsx scripts/test-stage-extraction.ts   # extractStageData + safeParseChatResponse
npx tsx scripts/test-review.ts             # applyReview (teacher review logic)
npx tsx scripts/test-guest-ratelimit.ts    # checkRateLimit sliding window (now injected)
npx tsx scripts/test-parser.ts             # safeParseChatResponse strategies + repairJson
npx tsx scripts/test-pacing.ts             # shouldNudgeConvergence / shouldShowEscapeHatch
npx tsx scripts/test-normalize-schema.ts   # normalizeSchema (stage 2 column cleanup)
npx tsx scripts/test-report-docx.ts        # buildReportDocx + zip roundtrip
npx tsx scripts/test-report-summary.ts     # buildPriorSummary
```

`scripts/probe-json-schema.ts` is a diagnostic (not a test): checks whether the configured LLM gateway supports `response_format: json_schema` strict mode.

> **No npm registry access in this sandbox.** New dependencies cannot be installed. This is why `app/lib/zip.ts` (hand-written ZIP via zlib), `app/lib/docxExtract.ts` (replaces mammoth), and `app/lib/llm/jsonRepair.ts` (replaces jsonrepair) exist — prefer extending these zero-dependency utilities over adding packages.

### First-time setup

```
npm install                      # postinstall runs `prisma generate`
cp .env.example .env             # then set DATABASE_URL + a 32+ char SESSION_SECRET
npx prisma migrate dev --name init   # creates prisma/dev.db + runs seed
```

Seed creates teacher `teacher1` / password `demo1234` and one demo class.

## Architecture

This is a Next.js 16 App Router project — a single-page STEM education platform where an AI teacher guides students through a six-phase scientific inquiry process (based on Shanghai junior high science curriculum standards).

> **Next.js 16 conventions** (see `AGENTS.md` — APIs differ from older training data): route handlers type their second arg as `RouteContext<'/api/.../[id]/...'>` and `ctx.params` is a **Promise** (`const { id } = await ctx.params`). Read `node_modules/next/dist/docs/` before writing new routes/pages.

### Six-phase pipeline

The core concept is a linear six-phase workflow defined in `app/models/types.ts` (`PhaseEnum`, 1–6):

1. **TopicSelection** (选题定向) — turn interests into researchable questions
2. **PlanDesign** (方案设计) — design experiment, identify variables
3. **Execution** (过程执行) — collect data, record observations
4. **DataAnalysis** (数据分析) — analyze data, find patterns
5. **ResultsFormation** (报告成型) — write scientific report (renamed from 成果成型)
6. **Reflection** (结果反思) — reflect and plan next steps

Phase state is managed via React state in `ConversationWorkspace.tsx` (server-authoritative `currentStage` from `StudentAssignment`) and `GuestWorkspace.tsx` (local state). The old `PhaseContext.tsx` / `PhaseProvider` have been deleted.

### Data flow

There are two chat entry points sharing the same LLM core (`callLLM` in `app/lib/llm/chat.ts`):

```
# Guest mode (/experience, in-memory, not persisted)
GuestWorkspace.tsx (client, ConversationChat injected)
  → POST /api/guest/chat (body: { message, stage, history, dataRows?, needSafetyQuiz? })
    → checkRateLimit(IP) → 429 if exceeded
    → checkBlacklistedKeywords() → 400 safety_violation if hit
    → getPromptForPhase(stage, context)  ← client-sent stage + optional dataRows/needSafetyQuiz
    → callLLM() + classifyError()
    → client-side extractStageData() merges structured output; advance via canAdvance()

# DB-backed six-phase flow — the real student path
ConversationWorkspace.tsx (client, owns stage/stageData/status)
  ConversationChat.tsx (injected send + onResult + onPhaseConfirm callbacks)
  → POST /api/conversations/[id]/chat  (body: { message })
    → requireUser() + getConversationForUser() (ownership: conversation.userId === user.id → else 404)
    → checkBlacklistedKeywords() → 400 safety_violation if hit
    → getPromptForPhase(currentStage, context)  ← stage is server-authoritative
    → callLLM() → createLLMProvider().chat() → safeParseChatResponse() (retry w/o JSON mode on fail)
    → extractStageData() merges structured output
    → Stage 4: analysisCount++ tracked in stageData.stage4
    → stageData.roundCounts[stage]++ per student message (feeds pacing nudge)
    → $transaction persists messages(+stageData+currentStage); on LLM error: nothing persisted
  ← ChatResponse + { currentStage, stageData }
```

### Stage advancement rules (updated)

| Transition | Mechanism |
|---|---|
| 1 → 2 | **Confirm button** — `canAdvance(1,2)` checks `stage1.confirmed && variables.independent && variables.dependent`. Stage 1 `extractStageData` writes data but does NOT auto-advance. |
| 2 → 3 | Teacher review (approve → stage 3; reject → stay at 2) |
| 3 → 4 | Button via `/advance` — `canAdvance(3,4)` checks all required columns filled |
| 4 → 5 | Button via `/advance` — `canAdvance(4,5)` requires `stage4.analysisCount >= 2` (at least 2 rounds of analysis discussion) |
| 5 → 6 | Teacher review (approve + score≥6 → stage 6; score<6 or reject → stay at 5 with rewrite prompt) |
| 6 → done | `/stage6-respond` → `COMPLETED`, triggers fireworks celebration |

`canAdvance` in `app/lib/stageAdvance.ts` handles **1→2, 3→4, 4→5**. 2→3 and 5→6 go through teacher review. `phase_complete` is a UI hint only, not an auto-advance trigger.

### Confirmation button behavior

The confirm button (rendered when `lastActionType === 'confirmation'`):
- **Always** calls `onPhaseConfirm()` → `advanceTo(stage + 1)` — never sends a chat message
- No cancel button exists
- `lastActionType` finds the most recent assistant message WITH an `actionType` (skipping `confirmation_doc` cards)
- Confirm only appears at genuine phase completion (enforced by prompt rules: LLM must not emit `"confirmation"` mid-discussion)

### Pacing guard (anti-over-questioning)

`app/lib/pacing.ts` (pure, tested) prevents the Socratic discussion in stages 1–2 from dragging on:
- The chat route counts student messages per stage in `stageData.roundCounts` and, once `shouldNudgeConvergence(stage, roundCount)` fires (≥6 rounds, stages 1–2 only), injects `nudgeConverge: true` into `PromptContext` so the prompt tells the LLM to converge.
- Stage 1 additionally gets a client-side **escape hatch button** (`shouldShowEscapeHatch`) in `ConversationChat` — clicking sends a fixed force-converge message asking for the 确认书. It does NOT bypass `canAdvance` gating.

### Persistence & auth

- **Database** — Prisma + SQLite. Schema in `prisma/schema.prisma` (6 models: `User / Class / ClassMember / Assignment / StudentAssignment / Conversation`). Access via the singleton in `app/lib/db.ts`. `StudentAssignment ↔ Conversation` 1:1 holds its FK on `StudentAssignment.conversationId` only. `StudentAssignment` has `@@unique([assignmentId, studentId])`. `Conversation.stageData`/`messages` are JSON strings.
- **Auth** — iron-session (encrypted cookie `hyacintech_session`). `app/lib/session.ts` + `app/lib/auth.ts`. `requireUser()` / `requireRole(role)` return `{ ok, user } | { ok:false, error, status }`.
- **Classes & assignments** — Routes under `app/api/classes/*` and `app/api/{assignments,student/assignments}/*`. `DELETE /api/classes/[id]` cascades in a transaction.
- **Conversation persistence** — `app/lib/conversation.ts`: `ensureStudentConversation(assignmentId, studentId)` find-or-create with an assignment-aware welcome message; `getConversationForUser(conversationId, userId)` ownership-checked load. Visiting `/student/assignments/[id]` auto-creates/resumes.

### Welcome message (assignment-aware)

`initialWelcomeMessage(opts?)` in `app/lib/welcome.ts` accepts optional `{ assignmentTitle, topicDirection }`. When an assignment has a title, the welcome message explicitly mentions it and guides the student to think about that topic specifically. Guest mode uses the generic welcome.

### Hints system (toggleable, display-only)

- `ChatResponse` and `Message` have an optional `hints?: string[]` field — thinking guides distinct from `options`
- Hints are rendered as yellow pill-shaped **non-interactive `<span>` elements** above the chat input
- The hint toggle (labeled "提示") in the input area **controls both hints AND options visibility**
- When toggle is OFF: neither hints nor options render
- Hints MUST provide thinking paths, not restate questions (prompts enforce this: good="试着想一想…" bad="你的自变量是什么？")
- `options` (blue choice buttons from `ask_choice`) are also **display-only spans** — they do NOT send on click. Students type their own answers.

### Confirmation document (探究问题确认书)

When the LLM emits `stage1_confirmed: true` + `snapshot`, `ConversationChat` inserts a special message with `messageType: 'confirmation_doc'`. `MessageItem` renders these as **green-bordered cards** with a "📋 探究问题确认书" header, visually distinct from regular chat bubbles. The confirmation button appears immediately after.

### Teacher review & scoring

`applyReview` in `app/lib/review.ts` (pure function, tested):
- Stage 2 approve → stage 3; reject → stay at 2 with feedback
- Stage 5 approve + score ≥ 6 → stage 6
- Stage 5 approve + score < 6 → **treated as soft-reject**: `approved=false, submitted=false`, feedback auto-appends rewrite prompt, student stays at stage 5
- `ReviewActionForm.tsx` shows real-time score threshold hints to the teacher

### Stage 2 schema normalization

`normalizeSchema()` in `app/lib/schemaNormalize.ts` (pure, tested) cleans the LLM-produced `data_table_schema` inside `extractStageData` before it's stored: snake_case + deduped keys, empty-title columns dropped, types coerced to `text/number/image`, a `notes` text column guaranteed, `minRows ≥ 3`, `maxRows = 200`.

### Stage 5 auto-generation

When entering stage 5 (via confirm button or `/advance`), `ConversationWorkspace.onPhaseConfirm` automatically sends a "开始报告成型" trigger message. The chat route builds `priorSummary` with `buildPriorSummary(stageData)` (`app/lib/reportSummary.ts` — condenses stage 1 确认书/variables, stage 2 schema, stage 3 data rows into text); the phase 5 prompt instructs the LLM to **always** include `report_sections` when `priorSummary` is injected — no student input required. Guest mode builds the same summary client-side.

### Report Viewer & Word export/import

`ReportViewer.tsx` (stage 5 panel) wraps the shared `ReportDocument.tsx` renderer (also used read-only in stage 6) showing AI-prefilled sections (purpose/hypothesis/materials/procedure/dataSummary/analysis) + the embedded stage-3 data table, plus student-editable conclusion/reflection fields, teacher score (green ≥6 / red <6 with rewrite notice), and AI reference score.

Word round-trip (both routes require ownership via `getConversationForUser`):
- `POST /api/conversations/[id]/report/export` — builds a `.docx` from stage 5 sections + data table via `buildReportDocx()` (`app/lib/reportDocx.ts`, hand-written WordprocessingML zipped by `app/lib/zip.ts`).
- `POST /api/conversations/[id]/report/import` (student-only, stage 5 only, ≤10MB `.docx`) — saves the file to `public/uploads/`, extracts text via `extractDocxText()` (`app/lib/docxExtract.ts`), and stores `uploadedDocUrl`/`uploadedText` on `stage5` **without overwriting the AI sections**.

### Safety system

- `checkBlacklistedKeywords()` runs before every chat call (both guest and DB-backed) and returns `400 safety_violation` on hit.
- The LLM may emit a `safety_quiz` object in stage 2/3 (risks identification). In the DB-backed flow, `POST /api/conversations/[id]/safety-quiz` with `{ passed: true }` sets `Conversation.safetyQuizCompleted = true` (correctness is judged client-side against `safety_quiz.correct` — education MVP). Guest mode passes `needSafetyQuiz` to the prompt builder instead (no persistence).

### AI reference scoring (stage 5)

`generateReferenceScore(sections)` in `app/lib/llm/scoring.ts` calls the LLM with `buildScoringPrompt()` / `buildReportText()` (`app/prompts/scoring.ts`) to produce a `Stage5ReferenceScore`: an `overall` 1–10, five clamped `dimensions` (completeness/logic/dataUsage/innovation/expression), `highlights`, `suggestions`, and `safetyCompliance`. **It never throws** — config/network/parse failures return `null` so report submission is never blocked. This is the *AI reference score* shown alongside the teacher's score in `ReportViewer`; the teacher score is what actually gates 5→6.

### Image uploads

`POST /api/uploads` (student-only, `requireRole('student')`) accepts a `multipart/form-data` `file` field. Validates type (PNG/JPG/WebP/GIF) and ≤5MB, writes to `public/uploads/<uuid>.<ext>`, returns `{ url }`. Used for experiment photos during execution.

### Stage 4 analysis gate

`StageData.stage4.analysisCount` is incremented in the chat route for every student message during phase 4. `canAdvance(4,5)` requires `analysisCount >= 2`. Insufficient analysis shows "请先与AI导师进行至少两轮数据分析讨论".

### Completion & fireworks

When `StudentAssignment.status === 'COMPLETED'`:
- `StageProgress` receives `completed={true}` — all 6 circles turn green with checkmarks
- `Fireworks.tsx` renders a full-screen celebration overlay with emoji particles, congratulatory text, and a "点击任意位置或按任意键关闭" dismiss hint. Clicking anywhere or pressing any key dismisses it.
- `StartAssignmentButton` shows "查看" (gray button) instead of "继续" for completed assignments

### Prompt system

All six phase prompts in `app/prompts/phase<N>-<name>.ts` follow a **unified format**:
- `=== JSON 输出格式（必须严格遵守）===` section with consistent field documentation
- Clear `next_action_type` rules: `"confirmation"` ONLY at genuine phase completion
- `hints` guidance: provide thinking paths, not question restatements
- `options` as supplementary guidance (display-only in UI)
- Explicit JSON escaping rules (`\\n` for newlines, `\\"` for quotes)
- `getPromptForPhase(phase, context?)` in `app/prompts/index.ts` injects dynamic context

### Response types

`ChatResponse.next_action_type` drives the UI:
- `ask_choice` — options rendered as **display-only** blue spans (not clickable)
- `text_input` — free-text input
- `confirmation` — green "确认，进入下一阶段" button → calls `onPhaseConfirm` directly
- `info` — informational display only

### Key components

```
ConversationWorkspace (client, owns stage/stageData/status)
  ├─ ConversationChat (chat UI, messages, input, hints/options/confirm)
  │   ├─ StageProgress (1–6 dot bar, supports completed prop)
  │   └─ MessageItem (renders messages; confirmation_doc → green card style)
  └─ Stage panels (right side):
      Stage 2: SchemaEditor (editable column table)
      Stage 3: DataTableEditor (spreadsheet-like data entry)
      Stage 4: ChartViewer (line/bar charts via Recharts)
      Stage 5: ReportViewer (AI report + data table + teacher score)
      Stage 6: Stage6Panel (reflection + submission)
  └─ Fireworks (on COMPLETED, dismissible)

GuestWorkspace — same components, no DB, local state, no teacher review
```

### Data Lab

`/data-lab` is an isolated data-production workspace for `annotator`, `reviewer`, and `admin` roles. It supports immutable dataset imports, structured assistant-only annotation, anonymous arbitration, frozen ShareGPT releases, external training-run registration, and blind-eval artifact import. Public registration still only permits `student` and `teacher`; background roles are admin-managed.

M9A style lineage is end-to-end: assignments select one of five versioned styles or stable `auto`; conversations freeze the resolved style; online prompts consume it; all slots of a double-annotation sample share it; revisions and release items persist it. New frozen releases expose both canonical `clean` and model-ready `training` JSON. `training` prepends the versioned style instruction as a system message, while manifest schema v2 records per-style counts and hashes. Blind-eval collection uses `--style`, rejects cross-style comparisons, and the admin page aggregates results per style. Pre-M9A2 releases intentionally have no `training` export.

M9B1 adds `ModelVersion`, `ModelDeployment`, and immutable `GenerationTrace`. `npm run model:bootstrap` (also called by the launcher) idempotently registers the configured runtime model and first production baseline without persisting secrets. Formal chat uses `callLLMWithTrace()` and `persistGenerationTurn()` so display messages, stage data/advance, and trace commit in one transaction. Trace rows store the structured response and non-secret generation/contract evidence, but only SHA-256 fingerprints of the system prompt and student request. New formal conversations set `traceCoverage=COMPLETE`; pre-migration or otherwise unverified conversations remain `LEGACY_UNVERIFIED`. Guest chat remains outside this persistence path.

M9B2 adds opt-in production feedback. Assignments default to `dataContributionMode=DISABLED`; enabled assignments create student consent in `PENDING`, and students may grant, decline, or withdraw without affecting coursework. Teachers nominate one traced assistant message, never an untraced/guest conversation. `productionCandidates.ts` builds a two-turn snapshot, `redaction.ts` locally removes known identity fields and common PII/attachment patterns, and `datasetLeakage.ts` checks exact and near duplicates. Admins review only redacted snapshots at `/data-lab/candidates`; approved candidates convert to isolated `production_trace` batches. Withdrawn candidates are excluded both when starting campaigns and when assembling releases.

M9C adds transformation evidence and training eligibility. Revisions persist a declared transformation type plus server-computed text/structure metrics from `trainingEligibility.ts`; overclaiming a light edit as a rewrite is rejected. Production `NO_CHANGE`/`LIGHT_EDIT` remains monitoring-only, while material corrections can produce SFT and chosen/rejected preference records. Work review and arbitration reject self-authored revisions. Release manifest schema v3 records per-item eligibility and emits eligibility-filtered `training` plus `preference`. Non-draft training registration requires a parent `ModelVersion` and recomputes current authorization, leakage, and correction eligibility.

M9D completes deployment governance. Evaluation imports resolve transcript tags to `ModelVersion`; `deploymentGate.ts` requires ready training lineage, non-regressing aggregate results, and independent coverage/non-regression for all five styles. Only `ELIGIBLE` models can advance 10% → 30% → 100%. `resolveConversationModel()` uses a stable conversation hash and persists `Conversation.deployedModelVersionId`; chat uses that registered provider/external model. Normal promotion preserves conversation stickiness. Rollback creates a 100% baseline deployment and repins conversations still using the failed candidate. Deployment APIs are admin-only and every mutation is audited.

Initialization:

```bash
npm run data-lab:init   # requires ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_DISPLAY_NAME
npm run data-lab:pilot  # optional 12-sample pilot and demo annotation accounts
npm run data-lab:test
```

### Type system

- `Message` in `app/models/types.ts` — includes `hints`, `messageType` (for confirmation_doc), `actionType`, `phaseComplete`
- `ChatResponse` in `app/models/types.ts` — includes `hints`, `stage1_confirmed`, `snapshot`, `variables` (with `controlled?: string[]`), `data_table_schema`, `risks`, `safety_quiz`, `report_sections`
- `StageData` in `app/models/stageData.ts` — stage1–6 data shapes; stage4 has `analysisCount`; stage5 has optional `uploadedDocUrl`/`uploadedText`; top-level `roundCounts` tracks per-stage message rounds
- `PhaseEnum` in `app/models/types.ts` — 1–6 enum with Chinese comments

### LLM integration (`app/lib/llm/`)

- **`provider.ts`** — `OpenAICompatibleProvider` hits `${baseURL}/chat/completions`. 30s timeout.
- **`parser.ts`** — `safeParseChatResponse()` never throws. Multi-strategy parse: strict JSON → markdown fence → brace matching → heuristic natural-language extraction; the fence and brace strategies each retry through `repairJson()` before giving up. Extracts `hints`, `controlled` variables, and all M4 structured fields.
- **`jsonRepair.ts`** — `repairJson()`: deterministic, zero-dependency fixer for common LLM JSON slips (unescaped newlines/inner quotes in strings, trailing commas, Chinese smart quotes). Deliberately does NOT handle single-quoted strings or unquoted keys.
- **`errors.ts`** — `classifyError()` maps errors to typed `ErrorCode` + Chinese user message + HTTP status.
- **Two-attempt JSON strategy**: attempt 1 with `response_format: json_object`; if parse falls back to apology, attempt 2 without JSON mode + hard instruction for raw JSON. `APOLOGY_DIALOGUES` in `chat.ts` must stay in sync with `parser.ts`.

### Env vars

`OPENAI_API_KEY` (+ optional `OPENAI_API_BASE`) or `DEEPSEEK_API_KEY` (+ optional `DEEPSEEK_API_BASE`). Optional overrides: `LLM_PROVIDER`, `LLM_MODEL` (defaults `gpt-4o` / `deepseek-v4-pro`).
