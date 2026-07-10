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

Six-phase STEM inquiry pipeline (1=选题定向, 2=方案设计, 3=过程执行, 4=数据分析, 5=报告成型, 6=结果反思). Two chat modes share the same LLM core:
- **DB-backed** — `ConversationWorkspace` → `POST /api/conversations/[id]/chat`, server-authoritative `currentStage`
- **Guest** — `GuestWorkspace` → `POST /api/guest/chat` (no DB, IP rate-limited, in-memory state)

DB: SQLite + Prisma (6 models). Auth: iron-session (`hyacintech_session` cookie). Path alias: `@/*` → `./*` (project root, not `./src/*`).

## Conventions

- All route handlers use `requireUser()` / `requireRole()` guards from `app/lib/auth.ts`
- `checkBlacklistedKeywords()` must run before every chat LLM call
- LLM parsing uses `safeParseChatResponse()` which **never throws** — always handle null
- `extractStageData()` and `canAdvance()` are pure functions shared by both chat modes
- Conversation ownership check: `getConversationForUser(conversationId, userId)` returns null if not owner → reply 404
- `stageData` and `messages` are stored as JSON strings in the Conversation model

For full architecture detail, see [CLAUDE.md](./CLAUDE.md).
