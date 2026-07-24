<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Quick reference

- `npm run dev` — start dev server (localhost:3000)
- `npm run lint` — ESLint (no separate typecheck command)
- `npx tsx scripts/test-<name>.ts` — run a single pure-function unit test (no test framework)
- `npm run db:migrate` — apply Prisma schema changes + run seed
- `npm run db:seed` — re-run seed idempotently
- `npm run db:studio` — open Prisma Studio (browse SQLite dev.db)

## Env

Copy `.env.example` → `.env` (not `.env.local`). Requires:
- `DATABASE_URL="file:./dev.db"`
- `SESSION_SECRET` (≥32 chars, generate with `openssl rand -base64 32`)
- `OPENAI_API_KEY` or `DEEPSEEK_API_KEY`

## Next.js 16 route handler rules

Dynamic route handlers must type the second arg as `RouteContext` (global type, no import needed) and **`await` params**:

```ts
export async function POST(req: Request, ctx: RouteContext<'/api/conversations/[id]/chat'>) {
  const { id } = await ctx.params;  // ctx.params is a Promise!
  // ...
}
```

## Architecture

Six-phase STEM inquiry pipeline: 1=选题定向, 2=方案设计, 3=过程执行, 4=数据分析, 5=报告成型, 6=结果反思. The DB-backed flow is server-authoritative; Guest reuses versioned contracts where practical but owns its in-memory lifecycle separately.

Stage boundaries are product contracts, not prompt suggestions:
- **P1**: canonical research question + explicit confirmation only. Interest, mechanism, and classroom proxy are optional context. Variables, levels, measurement, controls, materials, procedure, repeats, and safety belong to P2.
- **P2**: the server composes a complete plan preview. Confirmation is accepted only for the current draft hash, then freezes the plan and derives schema/risks.
- **P3**: safety answers are verified server-side; approved schema and plan are immutable during collection. Teacher review is nonblocking.
- **P4**: analysis progress requires distinct, verifiable citations to submitted row values, not message count.
- **P5**: platform report sections are authoritative; uploaded Word files are attachments. Reflection here means experiment limitations/discussion. Teacher approval requires a valid 0–10 score.
- **P6**: respond to teacher feedback and reflect on learning, then complete.

SQLite + Prisma persist operational, teaching, Data Lab, model, and audit records. Do not hard-code a model count. Auth uses iron-session (`hyacintech_session`). Path alias `@/*` resolves from the project root.

## Conventions

- All route handlers use `requireUser()` / `requireRole()` guards from `app/lib/auth.ts`
- `checkBlacklistedKeywords()` must run before every chat LLM call
- Dynamic Tutor responses use the versioned Tutor parser/contract; legacy six-phase responses may still use `safeParseChatResponse()`. Always handle parse failure.
- Stage artifacts, confirmation hashes, safety verification, evidence fingerprints, and transitions are server-owned. Never trust client claims for them.
- Prompt execution is pinned to the model/conversation's recorded `promptPolicyVersion`; never silently replace it with a global current version.
- Student-visible prompt state contains only authorized facts. TopicCard answer keys, hidden rubrics, Critic output, and evaluator-only evidence must never be injected into Tutor-visible state.
- Pending, submitted, and completed assignment status is enforced on every write route. Soft deadlines record/display lateness but do not lock student work.
- Existing releases and traces are immutable historical data. A new stage contract gets newly generated cases and explicit provenance; do not relabel or derive them from an old release.
- Conversation ownership check: `getConversationForUser(conversationId, userId)` returns null if not owner → reply 404
- `stageData` and `messages` are stored as JSON strings in the Conversation model

For full architecture detail, see [CLAUDE.md](./CLAUDE.md).
