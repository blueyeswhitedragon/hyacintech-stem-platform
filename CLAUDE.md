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
npm run db:deploy  # deploy committed migrations (new server / CI / production)
npm run db:seed    # Seed demo teacher + class (tsx prisma/seed.ts)
npm run db:studio  # Open Prisma Studio (inspect dev.db)
npm run platform:doctor # Validate deploy prerequisites without showing secrets
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
npx tsx scripts/test-review-pagination.ts  # normalizePageParams/toPage + stage3 SQL 谓词等价性
npx tsx scripts/test-stage2-fallbacks.ts   # categorical-variable extraction + hypothesis sentinels
npx tsx scripts/test-advance-hint.ts       # server-derived readiness hints across all stages
npx tsx scripts/test-stage-release.ts      # audited P2–P5 release and artifact bootstrapping
npx tsx scripts/test-evaluation-artifacts.ts # evaluation artifact validation and persistence
npx tsx scripts/test-coverage-cells.ts       # Data Lab phase/trigger/focus coverage cells and system-trigger predicates
npx tsx scripts/test-stage4-evidence.ts    # P4 证据判定：比较谓词、逐格行约束、单调去重、逐轮原因
npx tsx scripts/test-source-quote.ts       # 引文定位：吞掉 Markdown 标记仍可命中，拼接/编造仍驳回
npx tsx scripts/test-llm-errors.ts         # provider error classification, including 503 model_not_found
npx tsx scripts/test-llm-config.ts         # provider/key/default-model resolution
npx tsx scripts/test-setup-readiness.ts    # teaching/Data Lab readiness semantics
npx tsx scripts/test-blind-eval-coverage.ts # 覆盖驱动 16 格 + trigger/focus 汇总过产物校验与部署门禁 + EXTERNAL 训练血缘
```

`scripts/probe-json-schema.ts` is a diagnostic (not a test): checks whether the configured LLM gateway supports `response_format: json_schema` strict mode.

> **No npm registry access in this sandbox.** New dependencies cannot be installed. This is why `app/lib/zip.ts` (hand-written ZIP via zlib), `app/lib/docxExtract.ts` (replaces mammoth), and `app/lib/llm/jsonRepair.ts` (replaces jsonrepair) exist — prefer extending these zero-dependency utilities over adding packages.

### First-time setup

```
npm ci                           # postinstall runs `prisma generate`
cp .env.example .env             # then set DATABASE_URL + a 32+ char SESSION_SECRET
npm run db:deploy                # creates/updates the configured database
npm run db:seed                  # optional demo teaching accounts
npm run data-lab:init            # optional Data Lab administrator
npm run model:bootstrap          # register the configured runtime model
```

Use `npm run db:migrate` only while authoring a new Prisma migration. Fresh servers and deployment upgrades must use `npm run db:deploy` so they apply committed migrations without development prompts.

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

There are two chat entry points. They share versioned stage semantics, but persistence, lifecycle, and trace responsibilities differ:

```
# Guest mode (/experience, in-memory, not persisted)
GuestWorkspace.tsx (client, ConversationChat injected)
  → POST /api/guest/chat (body: { message, stage, history, dataRows?, needSafetyQuiz? })
    → checkRateLimit(IP) → 429 if exceeded
    → checkBlacklistedKeywords() → 400 safety_violation if hit
    → versioned Tutor turn with server-computed visible state and roundCount
    → client keeps returned in-memory state; server validates safety and contract output

# DB-backed six-phase flow — the real student path
ConversationWorkspace.tsx (client, owns stage/stageData/status)
  ConversationChat.tsx (injected send + onResult + onPhaseConfirm callbacks)
  → POST /api/conversations/[id]/chat  (body: { message })
    → requireUser() + getConversationForUser() (ownership: conversation.userId === user.id → else 404)
    → checkBlacklistedKeywords() → 400 safety_violation if hit
    → resolve the conversation/model-pinned promptPolicyVersion
    → build server-owned visible state → callLLMWithTrace() → versioned parser/contract checks
    → extract versioned student facts and compose server artifacts
    → Stage 4: accept only distinct evidence fingerprints tied to submitted cells
    → stageData.roundCounts[stage]++ per student message (feeds pacing nudge)
    → $transaction persists messages(+stageData+currentStage); on LLM error: nothing persisted
  ← ChatResponse + { currentStage, stageData }
```

### Stage advancement rules (updated)

| Transition | Mechanism |
|---|---|
| 1 → 2 | Confirm the current canonical research question. Requires only question + explicit confirmation tied to its hash. |
| 2 → 3 | Confirm the current server-composed complete plan by `draftHash`, submit, then teacher review. Approval advances; rejection reopens P2. |
| 3 → 4 | Complete the server-verified safety quiz when required and fill every required cell in the locked schema. Teacher P3 review remains nonblocking. |
| 4 → 5 | Cite at least two distinct submitted cell values in accepted analysis rounds. Duplicate text/row indices alone do not count. |
| 5 → 6 | Teacher approval with a finite score in 0–10; score≥6 advances, otherwise reopens P5 for revision. |
| 6 → done | `/stage6-respond` → `COMPLETED`, triggers fireworks celebration |

`canAdvance` handles student-driven transitions. Teacher-reviewed transitions go through review routes. `phase_complete` is a UI hint only. Every route must re-check the server-owned assignment/conversation status; pending, submitted, and completed work is read-only. Deadlines are soft and record lateness rather than blocking writes.

Teacher release is an audited bypass transition, not an alternative regular gate. A teacher may release only the student's current P2, P3, P4, or P5 stage and must provide a reason of at least 10 characters. Each release appends `stageData.timeline.releases` and a `DataLabAuditLog` with `action='STAGE_RELEASED'` and `entityType='StudentAssignment'`; traces from the released stage are ineligible for positive training nomination. P2 release creates a provenance-marked four-column minimum data schema when no usable schema exists, and P4 release deterministically bootstraps the report frame when it is missing. P1 cannot be released because the server must not invent a student's research question.

### Confirmation button behavior

Confirmation is a server-owned checkpoint, not a generic LLM action:
- P1 confirmation is tied to a hash of the canonical question; changing the question invalidates it.
- P2 shows a server-composed preview and sends `{ draftHash }` to the dedicated plan-confirmation endpoint. Stale hashes are rejected.
- `advanceHint()` derives button readiness and blocking reasons from server stage state, so the UI does not depend only on the latest Tutor `actionType`.
- `POST /api/conversations/[id]/stage2-fields` lets the owning student directly fill missing P2 core fields; the server recomposes the same preview and draft hash, and teacher review remains required.
- `direction_confirmation` and `plan_confirmation` must return `checkpoint`; semantic contract checks reject stage-overreaching Tutor output even when its JSON is valid.
- Confirmation documents/previews are hydrated from persisted stage state, so older recoverable conversations do not depend on a particular assistant message still being visible.

### Pacing guard (anti-over-questioning)

`app/lib/pacing.ts` (pure, tested) prevents the Socratic discussion in stages 1–2 from dragging on:
- The chat route counts student messages per stage in `stageData.roundCounts` and, once `shouldNudgeConvergence(stage, roundCount)` fires (≥6 rounds, stages 1–2 only), injects `nudgeConverge: true` into `PromptContext` so the prompt tells the LLM to converge.
- Stage 1 additionally gets a client-side **escape hatch button** (`shouldShowEscapeHatch`) in `ConversationChat` — clicking sends a fixed force-converge message asking for the 确认书. It does NOT bypass `canAdvance` gating.

### Persistence & auth

- **Database** — Prisma + SQLite. Schema in `prisma/schema.prisma`; it includes teaching, Data Lab, model-governance, and audit models, so documentation must not assume a fixed model count. Access is via the singleton in `app/lib/db.ts`. `Conversation.stageData`/`messages` are JSON strings and carry versioned stage metadata without a Prisma migration.
- **Auth** — iron-session (encrypted cookie `hyacintech_session`). `app/lib/session.ts` + `app/lib/auth.ts`. `getSessionState()` is the sole source for an invalid-session reason; protected pages redirect through `loginRedirectPath(reason)`, while `requireUser()` / `requireRole(role)` return `{ ok, user } | { ok:false, error, status, reason? }`. Single-login behavior is intentional: every successful login increments `sessionVersion`, immediately invalidating sessions on older devices or tabs.
- **Classes & assignments** — Routes under `app/api/classes/*` and `app/api/{assignments,student/assignments}/*`. `DELETE /api/classes/[id]` cascades in a transaction.
- **Conversation persistence** — `app/lib/conversation.ts`: `ensureStudentConversation(assignmentId, studentId)` find-or-create with an assignment-aware welcome message; `getConversationForUser(conversationId, userId)` ownership-checked load. Visiting `/student/assignments/[id]` auto-creates/resumes.
- **Stuck-student visibility** — the teacher review page lists in-progress students whose `roundCounts[currentStage] >= 8`, with `advanceHint()` explaining the current server-side blocker.

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

The server composes the P1 confirmation document from the canonical question and confirmation metadata. `ConversationChat` may render a persisted `confirmation_doc`, but stage state is authoritative and can hydrate the document for legacy stuck sessions.

### Teacher review & scoring

`applyReview` in `app/lib/review.ts` is the pure approve/reject state machine for P2, P3, and P5:
- Stage 2 approve → stage 3; reject → stay at 2 with feedback
- Stage 5 approve + score ≥ 6 → stage 6
- Stage 5 approve + score < 6 → **treated as soft-reject**: `approved=false, submitted=false`, feedback auto-appends rewrite prompt, student stays at stage 5
- `ReviewActionForm.tsx` shows real-time score threshold hints to the teacher

`applyRelease` is the separate pure P2/P3/P4/P5 bypass state machine. It records release provenance and required downstream server artifacts. P5 release preserves the teacher's actual finite 0–10 score, including scores below 6, while setting `approved=true` so the server-owned P6 response gate can be satisfied.

### Stage 2 schema normalization

`normalizeSchema()` in `app/lib/schemaNormalize.ts` (pure, tested) cleans the LLM-produced `data_table_schema` inside `extractStageData` before it's stored: snake_case + deduped keys, empty-title columns dropped, types coerced to `text/number/image`, a `notes` text column guaranteed, `minRows ≥ 3`, `maxRows = 200`.

### Stage 5 bootstrap

Entering P5 hydrates platform-owned report sections deterministically from the confirmed P1 question, frozen P2 plan, locked P3 schema/data, and accepted P4 evidence. Asynchronous AI reference scoring may only apply if the report state revision still matches; it must not overwrite newer student or teacher writes.

### Report Viewer & Word export/import

`ReportViewer.tsx` treats platform fields as the authoritative submission and shows the embedded data table, accepted analysis evidence, teacher feedback/score, and AI reference score. P5's student reflection field is experiment limitations/discussion; learning reflection and response to feedback belong to P6.

Word round-trip (both routes require ownership via `getConversationForUser`):
- `POST /api/conversations/[id]/report/export` — builds a `.docx` from stage 5 sections + data table via `buildReportDocx()` (`app/lib/reportDocx.ts`, hand-written WordprocessingML zipped by `app/lib/zip.ts`).
- `POST /api/conversations/[id]/report/import` (student-only, stage 5 only, ≤10MB `.docx`) stores the upload as an attachment without overwriting platform sections. AI scoring evaluates only platform fields, never extracted attachment text.

### Safety system

- `checkBlacklistedKeywords()` runs before every chat call (both guest and DB-backed) and returns `400 safety_violation` on hit.
- P2 confirmation derives risks and a safety quiz server-side. `POST /api/conversations/[id]/safety-quiz` receives an answer, checks it against the server-held key, and records completion only when correct. The quiz is proactively hydrated on P3 entry. Guest follows the same answer-verification contract without DB persistence.

### AI reference scoring (stage 5)

`generateReferenceScore(sections)` in `app/lib/llm/scoring.ts` calls the LLM with `buildScoringPrompt()` / `buildReportText()` (`app/prompts/scoring.ts`) to produce a `Stage5ReferenceScore`: an `overall` 1–10, five clamped `dimensions` (completeness/logic/dataUsage/innovation/expression), `highlights`, `suggestions`, and `safetyCompliance`. **It never throws** — config/network/parse failures return `null` so report submission is never blocked. This is the *AI reference score* shown alongside the teacher's score in `ReportViewer`; the teacher score is what actually gates 5→6.

### Image uploads

`POST /api/uploads` (student-only, `requireRole('student')`) accepts a `multipart/form-data` `file` field. Validates type (PNG/JPG/WebP/GIF) and ≤5MB, writes to `public/uploads/<uuid>.<ext>`, returns `{ url }`. Used for experiment photos during execution.

### Stage 4 analysis gate

`StageData.stage4` stores accepted evidence records containing row index, column key/display name, cited value, and a deterministic fingerprint. Progress requires **at least two accepted rounds, each citing at least one submitted cell that no earlier accepted round already used**, and each expressing a comparison. Repeated messages, bare row indices, and invented values do not count.

Three parts of the judgment are server-owned and deliberately distinct:

- **Cell resolution is per value, anchored to named rows.** When the message names rows (`第N行/次/轮`, `重复N`), a cited value that occurs in one of those rows is attributed only to those rows, so citing two cells cannot credit the whole table through column-alias matching. Values absent from every named row keep the existing ambiguity guard.
- **Deduplication is monotonic, not whole-set.** Low-cardinality tables (the common junior-high case) legitimately repeat values across rounds; only "no new cell at all" is a duplicate. `evaluateStage4Readiness` still counts distinct persisted rounds — equivalent by construction, and it never retroactively demotes rounds accepted under an older rule.
- **Comparison detection is judged by the extractor, with a deterministic fallback.** `app/lib/analysisClaimExtractor.ts` asks the model which cells the student's sentence cites and whether it compares them; `expressesComparison()` in `app/lib/serverTutorState.ts` recognizes comparative constructions rather than a closed word list and remains the fallback when the extractor is unavailable. Bare `比` only counts inside a 比-comparative, so 「比较认真」/「比如」/「比方说」 do not match while 「圆形比方形高」 does.

`updateServerAnalysis(stageData, message, claim?)` stays pure. The optional third argument is the *validated* claim: citations replace the deterministic cell resolution only when at least one survived verification, and the two comparison signals are OR-ed so the model can widen recall but can never make the gate stricter than it was. The returned `signals` record which path was used and what each side judged, and they land in the GenerationTrace under `generationParams.extractor` for divergence auditing.

`updateServerAnalysis` returns and persists `stage4.lastRound` with a `rejection` of `NO_EVIDENCE | SINGLE_EVIDENCE | NO_COMPARISON | NO_NEW_EVIDENCE`, so a rejected round says which half is missing. It is surfaced in the `ChartViewer` progress card, in the Tutor's visible state as 「上一轮判定」 (both `tutorTurn.ts` and guest chat), and it makes `stage4CitationExample` round-aware so the suggested wording prefers cells not yet cited. `lastRound` is explanatory only and never affects gating.

### Completion & fireworks

When `StudentAssignment.status === 'COMPLETED'`:
- `StageProgress` receives `completed={true}` — all 6 circles turn green with checkmarks
- `Fireworks.tsx` renders a full-screen celebration overlay with emoji particles, congratulatory text, and a "点击任意位置或按任意键关闭" dismiss hint. Clicking anywhere or pressing any key dismisses it.
- `StartAssignmentButton` shows "查看" (gray button) instead of "继续" for completed assignments

### Prompt system

The production Tutor uses versioned prompt policies and a stable structured output contract. Execution dispatches by the prompt version pinned to the conversation/model, and GenerationTrace records the stage contract, Prompt/extractor versions, allowed/chosen focus, interaction type, state revision/hash, and server artifacts. The older `app/prompts/phase<N>-<name>.ts` path is compatibility-only and must not silently become the production policy.

### Extractors (two, versioned independently)

`app/lib/contractVersions.ts` carries two extractor version constants. They are parallel, not successive:

| Constant | Module | Stages | Output consumer | Training cohort |
|---|---|---|---|---|
| `STUDENT_FACT_EXTRACTOR_VERSION` | `app/lib/stateExtractor.ts` | 1, 2 | `stageData.extractedFacts` ledger | Gates `TUTOR_TRAINING_COHORT` (`app/lib/dataLab/trainingCohort.ts`) — bumping it invalidates existing traces |
| `ANALYSIS_CLAIM_EXTRACTOR_VERSION` | `app/lib/analysisClaimExtractor.ts` | 4 | `stageData.stage4` evidence rounds | **Not** in `TUTOR_TRAINING_COHORT`; bumping it changes no trace's training eligibility |

Both share one provider path (`createLLMProvider({ role: 'EVALUATOR' })`, `repairJson`, two attempts where `finishReason !== 'length'` is required for success), both write `StateExtractionTrace` (the P4 extractor at `stage=4`, so no Prisma migration was needed), and both are strictly non-blocking: on failure the turn continues on the deterministic path. In both, the model only performs language understanding — every fact it claims is verified server-side against the student's own text (`sourceQuote` must appear verbatim) and, for P4, against the submitted rows (row, column, and value must resolve to a real cell, and the value must appear inside the quote it was justified by). `validateAnalysisClaim` is pure and unit-tested.

"Verbatim" is resolved by `locateSourceQuote()` / `locateSourceQuoteIn()` in `app/lib/sourceQuote.ts` (pure, tested), shared by both extractors. A quote matches if it is verbatim **after ignoring Markdown emphasis/heading/quote markers and whitespace**, and the validator then rewrites `sourceQuote` to the corresponding span of the student's own message — so the ledger always stores the student's characters, never the model's paraphrase. This exists because a student who wrote his plan with `**bold**` headings was blocked for nine rounds: the model quoted the heading without its asterisks, the remaining 380 characters matched exactly, and the whole fact was still rejected as `SOURCE_QUOTE_NOT_FOUND_IN_STUDENT_MESSAGES`. Only layout noise is forgiven — changed digits, added words, and quotes stitched together across non-adjacent passages are still rejected.

### 模型的格式性决策面

Tutor 模型只决定 `interactionType`、`focus` 与 `hints`；`dialogue` 是教学语言正文，不是状态指令。阶段产物、确认哈希、`phase_complete`、`next_action_type`、方案、数据表、安全题、分析进度和报告框架一律由服务器合成或覆盖，模型不能通过增加字段改变业务状态。模型单方面输出 `checkpoint` 时，如果服务器没有明确声明检查点，兼容层将其映射为 `text_input`，避免产生页面不存在的确认按钮。

Data Lab 的结构覆盖由 `expectedCoverageCells()` 从案例编译器同一份 challenge、triggerType 与 allowed focus 推导，不维护第二份手写清单。独立评测产物必须按 phase、triggerType、focus 提供裁决汇总；`deployment-gate-v3-structural-coverage` 对任何缺格都阻断部署。

采集端由 `scripts/lib/coverage-driver.ts` 的 `planCoverageTurns()` 为每一格组装状态与可见事实（纯函数，不调模型），`blind-eval collect --stages coverage` 走版本化 Tutor 路径逐格采集——遗留 persona 路径产不出 `STAGE_TRANSITION`/`STAGE_ENTER`/`REPORT_BOOTSTRAP`。判定端由 `scripts/lib/structural-summary.ts` 的 `structuralSummary()` 按 `expectedCoverageCells()` 推出的键初始化零桶再填，保证桶名与门禁一致、不因无数据而消失。采集与判定两侧都会在缺格或空桶时打印中文告警，采集端另置非零退出码。

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

`/data-lab` is an isolated data-production and model handoff workspace for `annotator`, `reviewer`, and `admin` roles. Public registration still only permits `student` and `teacher`; background roles are admin-managed and every API mutation enforces its role independently of page guards.

The current production path is:

```
source material / generated drafts → TopicCard review and preview
  → Smoke 6 → Calibration 12 → Trial 36 + human sign-off
  → Full 180 / EVAL → model A/B candidates and cross-critique
  → annotator first review → reviewer final confirmation
  → immutable Release download → training on an external compute platform
  → training/evaluation results registered in Model Records → staged deployment/rollback
```

TopicCard V2 is the compiler input for inquiry scenarios. New `stage-contract-v3` cases are regenerated from approved inputs without deriving from or relabeling old release items. Compiler views strictly separate student-visible state from hidden TopicCard bridges, answer keys, rubrics, and evaluator evidence. Expansion gates and review provenance are defined in `docs/tutor-language-bootstrap-workflow.md`. Data Lab is a data export and result registry, not an in-process training console.

Data Lab 案例的 `triggerType` 统一使用生产 `StageTriggerType`：`USER_MESSAGE / STAGE_ENTER / STAGE_TRANSITION / TEACHER_APPROVAL / REPORT_BOOTSTRAP / OPTIONAL_COACHING / FINAL_SUBMISSION`。`SYSTEM_TRIGGER` 只为已发布 JSON 的历史兼容值；所有系统触发判断统一经过 `isSystemTriggeredTurn()`。`TRIAL_36` 当前配比为 P1=8、P2=8、P3=4、P4=8、P5=4、P6=4，因此解锁 Full 180 的人工逐条复盘签署必须实际看过六阶段及 `STAGE_ENTER / STAGE_TRANSITION / REPORT_BOOTSTRAP`。旧配比 Trial 及其签署会被识别为过期，必须 supersede 后重跑。

The previous `DatasetBatch` / `AnnotationCampaign` ShareGPT five-style workflow is frozen and retained read-only for history, exports, and audit lineage. Its import/create/start APIs return 410 and must not be presented as the primary workflow.

Legacy M9A style lineage remains end-to-end for historical records: assignments select one of five versioned styles or stable `auto`; conversations freeze the resolved style; revisions and release items persist it. Historical frozen releases expose canonical `clean` and model-ready `training` JSON. This does not reopen the legacy campaign workflow for new data.

M9B1 adds `ModelVersion`, `ModelDeployment`, and immutable `GenerationTrace`. `npm run model:bootstrap` (also called by the launcher) idempotently registers the configured runtime model and first production baseline without persisting secrets. Formal chat uses `callLLMWithTrace()` and `persistGenerationTurn()` so display messages, stage data/advance, and trace commit in one transaction. Trace rows always store the structured response, prompt/request fingerprints, a versioned prompt template, and non-secret generation/contract evidence. The exact rendered system prompt is captured separately only when the assignment has explicit `GRANTED` data consent; old or unconsented traces leave that field empty and cannot be nominated as positive training candidates. New formal conversations set `traceCoverage=COMPLETE`; pre-migration or otherwise unverified conversations remain `LEGACY_UNVERIFIED`. Guest chat remains outside this persistence path.

M9B2 adds opt-in production feedback. Assignments default to `dataContributionMode=DISABLED`; enabled assignments create student consent in `PENDING`, and students may grant, decline, or withdraw without affecting coursework. Teachers nominate one traced assistant message, never an untraced/guest conversation. `productionCandidates.ts` builds a two-turn snapshot, `redaction.ts` locally removes known identity fields and common PII/attachment patterns, and `datasetLeakage.ts` checks exact and near duplicates. Admins review only redacted snapshots at `/data-lab/candidates`; approved candidates convert to isolated `production_trace` batches. Withdrawn candidates are excluded both when starting campaigns and when assembling releases.

M9C adds transformation evidence and training eligibility. Revisions persist a declared transformation type plus server-computed text/structure metrics from `trainingEligibility.ts`; overclaiming a light edit as a rewrite is rejected. Production `NO_CHANGE`/`LIGHT_EDIT` remains monitoring-only, while material corrections can produce SFT and chosen/rejected preference records. Work review and arbitration reject self-authored revisions. Release manifest schema v3 records per-item eligibility and emits eligibility-filtered `training` plus `preference`. Non-draft training registration requires a parent `ModelVersion` and recomputes current authorization, leakage, and correction eligibility.

M9D completes deployment governance. Evaluation imports resolve transcript tags to `ModelVersion`; `deploymentGate.ts` requires ready training lineage, complete verified artifacts, coverage and non-regression across all six phases, no critical errors, acceptable judge consistency, and structure-parse performance no worse than baseline. Only `ELIGIBLE` models can advance 10% → 30% → 100%, with online observation gates between stages. `resolveConversationModel()` uses a stable conversation hash and persists `Conversation.deployedModelVersionId`; chat uses that registered provider/external model. Normal promotion preserves conversation stickiness. Rollback creates a 100% baseline deployment and repins conversations still using the failed candidate. Deployment APIs are admin-only and every mutation is audited.

Training lineage readiness is one shared rule, `modelTrainingReady()` in `app/lib/deployment.ts`, used by both the model-level and RuntimeBundle-level gate refresh. `BASE` and `EXTERNAL` (`IDENTITY_BACKED_ARTIFACT_KINDS`) are produced outside this platform, so the platform does not vouch for their training process and requires only `verificationStatus === 'VERIFIED_IDENTITY'` — a `checkpointId` or 64-hex `weightsSha256`. `FINE_TUNED` still requires a `SUCCEEDED` TrainingRun with an unblocked eligibility report. This is what makes "externally fine-tuned model, only a BaseURL + key" deployable at all; without it `trainingReady` was permanently false. `docs/external-model-deployment-runbook.md` is the ten-step operator path with the exact Chinese error text at each failure point.

M9E adds terminal annotation-campaign lifecycle governance. Admins may archive an `ACTIVE` campaign, atomically changing unfinished tasks to `CANCELLED`, disabling participants, and preserving assignees, drafts, submissions, work reviews, arbitration, releases, and audit history. Archived work can still be approved, invalidated, selected, merged, or rejected, but it cannot be returned to annotators or reopened. Only an empty `DRAFT` campaign can be permanently deleted. Claim, draft-save, and submit writes all re-check that the campaign is still `ACTIVE` to close archive races.

M10 introduces dataset schema v3 after the six-phase drift audit. The historical 489-record batch is `LEGACY_QUARANTINED` and may only seed scenarios, rejected preferences, or regression cases. P2 persists a complete reviewed plan including repeat count; P3 safety quiz answers are verified server-side before data entry/advance; P4 progress increments only when the current student turn cites values present in submitted rows. New distillation separates student, tutor, and evaluator views, calls the production Tutor prompt/contract path turn by turn, supports resumable runs, and exports one leading system prompt per assistant training turn. See `docs/dataset-v3-runbook.md`.

The current candidate cohort is `stage-contract-v4` with `student-fact-extractor-v3` and candidate Prompt `tutor-language-prompt-v2.3`. Stage 2 requires the student-authored scientific core (hypothesis, independent variable, at least two levels, dependent variable, measurement, controls, and repeats); materials, procedure, and the low-risk safety baseline may be server-composed with field-level provenance and student hash confirmation. Old releases remain immutable. Production Tutor Prompt stays on v1 until the exact v2.3 release cohort passes Data Lab gates; training eligibility must require that one Prompt/contract cohort rather than accepting any generally supported Prompt.

Initialization:

```bash
npm run data-lab:init   # requires ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_DISPLAY_NAME
npm run model:bootstrap # idempotently register the configured runtime model/baseline
```

Database-backed Data Lab tests must run against a dedicated disposable `DATABASE_URL`, never the teaching or production database. Initialize and test that database in this order; the fixture setup is required by the workload, account-lifecycle, and campaign-lifecycle suites:

```bash
DATABASE_URL="file:./hyacintech-verify.db" npm run db:deploy
DATABASE_URL="file:./hyacintech-verify.db" npm run db:seed
DATABASE_URL="file:./hyacintech-verify.db" npm run data-lab:init
DATABASE_URL="file:./hyacintech-verify.db" npm run model:bootstrap
DATABASE_URL="file:./hyacintech-verify.db" npm run data-lab:test:setup
DATABASE_URL="file:./hyacintech-verify.db" npm run data-lab:test
DATABASE_URL="file:./hyacintech-verify.db" npm run data-lab:test
```

Remove the disposable database after the test run.

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

`DATABASE_URL`, a 32+ character `SESSION_SECRET`, and at least one valid provider key are required. Provider keys are `OPENAI_API_KEY` (+ optional `OPENAI_API_BASE`) and `DEEPSEEK_API_KEY` (+ optional `DEEPSEEK_API_BASE`). Exactly one valid key permits provider auto-detection; if both are configured, `LLM_PROVIDER` is mandatory. `LLM_MODEL` defaults to `gpt-4o` for OpenAI or `deepseek-v4-pro` for DeepSeek. `DATA_LAB_CREDENTIAL_MASTER_KEY` is required only after an `ENCRYPTED_DB` credential is stored; ENV-referenced Data Lab connections do not need it. Optional runtime overrides include role-specific token/timeout settings, `EXTRACTOR_LLM_*`, `DATA_LAB_AI_CURATOR_*`, `DATA_LAB_MODEL_A/B*`, `ENABLE_MODEL_DEPLOYMENT`, and `PROMOTE_RUNTIME_PROMPT_BASELINE`. `.env.example` is the canonical inventory and separates production settings from script/test-only variables.

Data Lab provider connections, endpoints, and RuntimeBundles are executable configuration, not a display-only registry. Connection tests tolerate Markdown JSON fences emitted by Anthropic-style conversion gateways and, when a non-disabled Endpoint is registered for the connection, probe that Endpoint's remote model before falling back to the first model returned by the gateway. Role defaults preselect forms only. Formal Tutor traffic follows the current ACTIVE production deployment: a new conversation remains unpinned until its first LLM call, then atomically pins both model and RuntimeBundle according to the stable rollout bucket. Existing conversations never silently switch. Guest, Extractor, TopicCard curation, and other callers not explicitly passed a RuntimeBundle still use the `.env` baseline.

The Windows launcher uses `db:deploy`, backs up the actual configured SQLite file before migration, reruns `npm ci` when `package-lock.json` changes, and never auto-creates the frozen legacy Pilot. Its readiness probe verifies service identity without external traffic; the subsequent health probe must validate the selected model unless the operator explicitly supplies `-AllowDegraded`.
