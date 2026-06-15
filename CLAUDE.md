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

There are no tests configured yet. `npm run lint` is currently clean (no errors or warnings),
and `next build` does **not** block on ESLint regardless.

### First-time setup

```
npm install                      # postinstall runs `prisma generate`
cp .env.example .env             # then set DATABASE_URL + a 32+ char SESSION_SECRET
npx prisma migrate dev --name init   # creates prisma/dev.db + runs seed
```

Seed creates teacher `teacher1` / password `demo1234` and one demo class.

## Architecture

This is a Next.js 16 App Router project — a single-page STEM education platform where an AI teacher guides students through a six-phase scientific inquiry process (based on Shanghai junior high science curriculum standards).

### Six-phase pipeline

The core concept is a linear six-phase workflow defined in `app/models/types.ts` (`PhaseEnum`, 1–6):

1. **TopicSelection** (选题定向) — turn interests into researchable questions
2. **PlanDesign** (方案设计) — design experiment, identify variables
3. **Execution** (过程执行) — collect data, record observations
4. **DataAnalysis** (数据分析) — analyze data, find patterns
5. **ResultsFormation** (成果成型) — write scientific report
6. **Reflection** (结果反思) — reflect and plan next steps

Phase state is managed via React Context in `app/lib/PhaseContext.tsx` (`PhaseProvider` / `usePhase`). Each phase has specific data requirements that must be met before `transitionToNextPhase()` succeeds (gates defined in `canTransitionToNextPhase`).

### Data flow

There are two chat entry points sharing the same LLM core (`callLLM` in `app/lib/llm/chat.ts`):

```
# Guest mode (/, /experience, in-memory, not persisted)
GuestWorkspace.tsx (client, ConversationChat injected)
  → POST /api/guest/chat (body: { message, stage, history, dataRows?, needSafetyQuiz? })
    → checkRateLimit(IP) → 429 if exceeded
    → checkBlacklistedKeywords() → 400 safety_violation if hit
    → getPromptForPhase(stage, context)  ← client-sent stage + optional dataRows/needSafetyQuiz
    → callLLM() + classifyError()
    → client-side extractStageData() merges structured output; advance via canAdvance()

# DB-backed six-phase flow (M3–M6) — the real student path
ConversationChat.tsx (client, append-only)
  → POST /api/conversations/[id]/chat  (body: { message })
    → requireUser() + getConversationForUser() (ownership: conversation.userId === user.id → else 404)
    → checkBlacklistedKeywords() → 400 safety_violation if hit
    → getPromptForPhase(currentStage, context)  ← stage is server-authoritative (StudentAssignment.currentStage)
    → callLLM() → createLLMProvider().chat() → safeParseChatResponse() (retry w/o JSON mode on fail)
    → extractStageData() merges structured output; advanceTo for stage1, else phase_complete=info only
    → append user+assistant Message to conversation.messages; on stage1_confirm → +1
    → $transaction persists messages(+stageData+currentStage); on LLM error: nothing persisted, classifyError()
  ← ChatResponse + { currentStage, stageData }
```

`callLLM` runs a two-attempt JSON strategy (JSON mode → retry as raw JSON if the parse falls back to a canned apology). The apology strings live in `app/lib/llm/chat.ts` (`APOLOGY_DIALOGUES`) and must stay in sync with `app/lib/llm/parser.ts`.

### Persistence & auth (M0–M2)

The platform is mid-migration from an in-memory prototype to a full DB-backed app (see `ROADMAP.md`). Migration complete through M8.

- **Database** — Prisma + SQLite. Schema in `prisma/schema.prisma` (6 models: `User / Class / ClassMember / Assignment / StudentAssignment / Conversation`). Access via the singleton in `app/lib/db.ts` (`import { db } from '@/app/lib/db'`). The `StudentAssignment ↔ Conversation` 1:1 holds its FK on `StudentAssignment.conversationId` only (the spec listed FKs on both sides; Prisma forbids a cyclic 1:1). `StudentAssignment` has `@@unique([assignmentId, studentId])`. `Conversation.stageData`/`messages` are JSON strings; the typed shape lives in `app/models/stageData.ts`.
- **Auth** — iron-session (encrypted cookie `hyacintech_session`). `app/lib/session.ts` exposes `getSession()` (requires `SESSION_SECRET` ≥ 32 chars) and `getCurrentUser()` (read-only, no throw — for Server Component pages). `app/lib/auth.ts` exposes `requireUser()` / `requireRole(role)` returning a `{ ok, user } | { ok:false, error, status }` discriminated union for route handlers. Endpoints: `app/api/auth/{register,login,logout,me}/route.ts`. Open self-registration with a `student`/`teacher` role; registering auto-logs-in and redirects by role. Auth pages: `/auth/login`, `/auth/register`; `app/components/AuthNav.tsx` shows login state in the home header.
- **Classes & assignments (M2)** — Routes under `app/api/classes/*` (create/list/detail/delete/join) and `app/api/{assignments,student/assignments}/*` (publish/list/start). `requireRole('teacher'|'student')` guards each; ownership/membership re-checked against the DB. Shared queries live in `app/lib/queries.ts` (reused by both API routes and Server Component pages); invite codes via `app/lib/inviteCode.ts`. `DELETE /api/classes/[id]` cascades in a transaction (studentAssignments → conversations → assignments → members → class). Pages: `app/teacher/{dashboard,classes,classes/[id],assignments}` and `app/student/{dashboard,assignments}` — all async Server Components that call `getCurrentUser()` + `redirect()` for auth and query `db` directly; interactive forms are small `"use client"` components (`CreateClassForm`, `PublishAssignmentForm`, `JoinClassForm`, `StartAssignmentButton`) that navigate or POST then `router.refresh()`.
- **Conversation persistence (M3)** — `app/lib/conversation.ts` is the shared helper layer: `ensureStudentConversation(assignmentId, studentId)` (find-or-create, seeds a static stage-1 welcome message via `initialWelcomeMessage()`, validates membership) and `getConversationForUser(conversationId, userId)` (ownership-checked load with the linked `StudentAssignment.currentStage/status`). Both the `start` endpoint and the conversation **page** call `ensureStudentConversation`, so visiting `/student/assignments/[id]` (`[id]`=assignmentId) auto-creates/resumes. `GET /api/conversations/[id]` returns `{ messages, currentStage, status }`; `POST /api/conversations/[id]/chat` appends to `conversation.messages` and advances `currentStage` on `phase_complete` (capped at 6; the stage-2/5 teacher-review gates come in M6). The student UI is `ConversationChat.tsx` (append-only — no edit/resend, to avoid desync with server history) + `StageProgress.tsx` (props-driven 1–6 bar). `conversation.messages` stores a JSON array of `Message`.
- **Stage structured protocol (M4)** — instead of markers/fenced blocks, the LLM emits optional **structured fields inside the same `ChatResponse` JSON** (`stage1_confirmed`/`snapshot`/`variables`, `data_table_schema`, `risks`, `safety_quiz`, `report_sections` — see `app/models/types.ts`); the phase prompts (`app/prompts/phase{1,2,3,5}-*.ts`) instruct *when* to emit them. `getPromptForPhase(phase, context?)` injects dynamic context (`topicDirection` into stage 1, `stage3.rows` as a text table into stage 4, a stage-1–4 summary into stage 5, `needSafetyQuiz` into stage 3). The chat route runs the **pure** `extractStageData(stage, response, prevStageData)` (`app/lib/stageExtraction.ts`) to merge structured output into `conversation.stageData` and decide stage advancement (`advanceTo` for stage 1 confirm, else `phase_complete`). Stage-3 safety quiz is gated client-side and confirmed via `POST /api/conversations/[id]/safety-quiz` (sets `Conversation.safetyQuizCompleted`). `extractStageData`/parser pass-through are covered by `scripts/test-stage-extraction.ts` (`npx tsx`).
- **Rich stage UI (M5)** — the conversation page renders `ConversationWorkspace.tsx` (client, owns `stage`+`stageData` as single source of truth) which puts `ConversationChat` (now controlled — `stage` prop + `onResult` callback) beside a stage panel switched on `currentStage`: stage 2 = read-only schema/risk preview, stage 3 = `DataTableEditor`, stage 4 = `ChartViewer` (Recharts), stage 5 = `ReportViewer`. Student-entered data persists via `PATCH /api/conversations/[id]/stage-data` (whitelist: only `stage3.rows`/`fileAssociations` at stage 3, only `conclusion`/`reflection` at stage 5 — AI-prefilled sections are protected). Stage advance is `POST /api/conversations/[id]/advance` gated by the pure `canAdvance(from,to,stageData)` (`app/lib/stageAdvance.ts`, tested by `scripts/test-stage-advance.ts`): 3→4 needs all required columns filled, 4→5 open; 1→2/2→3 stay chat-driven. Image upload is `POST /api/uploads` (`requireRole('student')`, ≤5MB, image MIME only, writes `public/uploads/` which is gitignored except `.gitkeep`). `chat`/`stage-data`/`advance` all return the fresh `{ stageData, currentStage }` so the workspace never re-runs extraction client-side.
- **Teacher review loop (M6)** — stages 2 & 5 are teacher-gated, so the chat route **no longer auto-advances on `phase_complete`** (only stage-1 `advanceTo` survives); 3→4/4→5 stay `/advance`-driven, 2→3/5→6 go through review, 6→done via `/stage6-respond`. Student endpoints: `submit-stage2` (→`PENDING_STAGE2`), `submit-stage5` (→`PENDING_STAGE5`, then calls `generateReferenceScore` in `app/lib/llm/scoring.ts` — a separate LLM call that fills `stage5.aiReferenceScore`; failure is swallowed so submit still succeeds), `stage6-respond` (→`COMPLETED`, blocks re-submit). Teacher endpoints under `app/api/teacher/review/*`: `GET` list (`getPendingReviews`), `GET/POST /[studentAssignmentId]` (class-ownership checked). The transition logic is the **pure** `applyReview(action, stage, fromStage, prevStageData, {score,feedback})` in `app/lib/review.ts` (tested by `scripts/test-review.ts`): approve advances + sets `approved`/`teacherScore`/`teacherFeedback`; reject sets `approved=false`/`submitted=false`/`teacherFeedback` and keeps data for resubmit. UI: `ConversationWorkspace` now also tracks `status` (PENDING banner / reject feedback / submit buttons), `Stage6Panel` shows the teacher score then collects the student reflection; teacher pages `app/teacher/review/{page,[id]/page}.tsx` render the plan (with red risk-column highlighting from `aiRiskAnnotations`) or report+`aiReferenceScore`, plus `ReviewActionForm`. `getTeacherStats` includes `pendingCount`.

> **Guest mode (M7)**: `/experience` runs `GuestWorkspace` — the same rich components with `allowUpload={false}`, simulated stage-2/5 stop-points, forced safety quiz, and AI self-assessment via `/api/guest/score`. `ConversationChat` is injectable (`send` + `onSafetyPassed` callbacks). Guest endpoints are rate-limited per IP (20/min) and message-length-capped (2000). No DB writes.
> **Landing page (M8)**: `/` is a clean entry point. The old anonymous prototype (`ChatInterface`/`PhaseContext`/`PhaseIndicator`/`SafetyFilter`/`PhaseContext`/`/api/chat`) has been deleted. `MessageItem` and `callLLM` are retained.

> Next.js 16 note: `cookies()` is async (`await cookies()`). Route-handler params are typed `RouteContext<'/api/.../[id]'>`; page params `PageProps<'/.../[id]'>` — both are `Promise`s (`await ctx.params`); these route types are generated by `next build`/`dev`/`typegen`, so bare `tsc --noEmit` will flag them.

### Prompt system

Each phase has its own system prompt in `app/prompts/phase<N>-<name>.ts` (~60 lines of Chinese). `app/prompts/index.ts` orchestrates them: `getPromptForPhase()` fetches the prompt and appends safety constraints via `injectSafetyConstraints()`.

### Safety filter (dual-layer)

1. **Frontend**: `SafetyFilter.tsx` wraps `ChatInterface`, checks input against `BLACKLIST_KEYWORDS` in `app/prompts/index.ts`, shows a modal on match.
2. **Backend**: `POST /api/chat` also calls `checkBlacklistedKeywords()`, returns 400 with `safety_violation` if triggered.

### LLM integration (`app/lib/llm/`)

The LLM is wired up for real (no longer a mock). The route uses a small provider/parser/error abstraction:

- **`provider.ts`** — `OpenAICompatibleProvider` hits `${baseURL}/chat/completions` (works for both OpenAI and DeepSeek, same wire format). `detectProvider()` / `validateConfig()` pick the provider from env keys, rejecting placeholder values (`sk-your-...`, `change-me`, keys < 10 chars). `createLLMProvider()` throws `LLMError('bad_config')` if nothing valid is configured. 30s timeout via `AbortController`.
- **`parser.ts`** — `safeParseChatResponse()` never throws. It tries strict `JSON.parse`, then markdown-fence extraction, then first-`{`-to-last-`}` brace matching, then a `heuristicExtract()` that reconstructs a `ChatResponse` from natural-language numbered lists. Always returns a valid `ChatResponse`, falling back to canned apology `dialogue` strings. It also passes through the optional **M4 structured fields** (`extractStructuredFields()`), keeping only well-formed ones.
- **`errors.ts`** — `classifyError()` maps raw fetch/provider errors into a typed `ErrorCode` + Chinese user message + HTTP status (401 bad key, 402 balance, 404 model, 429 rate limit, 400 context/content-filter, 5xx, etc.). `LLMError` carries a code through the provider layer.

**Two-attempt JSON strategy** in `callLLM()` (`app/lib/llm/chat.ts`, shared by `/api/chat` and `/api/conversations/[id]/chat`): attempt 1 uses `response_format: { type: 'json_object' }`; if the parse falls back to a canned apology string, attempt 2 re-sends *without* JSON mode plus a hard system instruction to emit raw JSON. Failure detection compares `dialogue` against `APOLOGY_DIALOGUES` in `chat.ts` — keep those in sync with `parser.ts`.

**Env vars** (see `.env.example`, copy to `.env.local`): `OPENAI_API_KEY` (+ optional `OPENAI_API_BASE`) or `DEEPSEEK_API_KEY` (+ optional `DEEPSEEK_API_BASE`). Optional overrides: `LLM_PROVIDER`, `LLM_MODEL` (defaults `gpt-4o` / `deepseek-chat`).

### Health check (`GET /api/health`)

Three-stage diagnostic returning `HealthResponse` (`status: healthy | degraded | unhealthy`): config validation → connectivity (`GET /models`) → auth+model (1-token `ping` chat). `ChatInterface` fetches this on mount and renders the yellow 系统诊断 banner when not healthy. Always returns HTTP 200 so the banner can read the detail.

### Response types

`ChatResponse.next_action_type` drives the UI interaction mode:
- `ask_choice` — render clickable options
- `text_input` — free-text input
- `confirmation` — confirm/acknowledge
- `info` — informational display only

### Component tree

```
RootLayout (server)
  PhaseProvider (client context)
    Home page
      PhaseIndicator (sidebar, shows 1–6 dot progress)
      SafetyFilter (injects checkSafety prop)
        ChatInterface (chat state, messages, fetch, health banner)
          MessageItem (single bubble + 重发/编辑 hover actions on last user msg)
```

`ChatInterface` keeps all chat state. Message editing/resending works by truncation: `deleteFrom(id)` slices `messages` back to that index, then `doSend()` re-posts the (possibly edited) text — there is no in-place message mutation. `phase_complete: true` in a response triggers `transitionToNextPhase()` after a 1s delay.
