# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint
```

There are no tests configured yet.

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

```
ChatInterface.tsx (client)
  → POST /api/chat (app/api/chat/route.ts)
    → checkBlacklistedKeywords() → 400 if hit
    → getPromptForPhase() → phase-specific system prompt + safety constraints
    → callLLMAPI() → currently MOCK, returns hardcoded ChatResponse per phase
  ← ChatResponse { dialogue, next_action_type, options?, phase_complete }
```

### Prompt system

Each phase has its own system prompt in `app/prompts/phase<N>-<name>.ts` (~60 lines of Chinese). `app/prompts/index.ts` orchestrates them: `getPromptForPhase()` fetches the prompt and appends safety constraints via `injectSafetyConstraints()`.

### Safety filter (dual-layer)

1. **Frontend**: `SafetyFilter.tsx` wraps `ChatInterface`, checks input against `BLACKLIST_KEYWORDS` in `app/prompts/index.ts`, shows a modal on match.
2. **Backend**: `POST /api/chat` also calls `checkBlacklistedKeywords()`, returns 400 with `safety_violation` if triggered.

### LLM integration status

`callLLMAPI()` in `app/api/chat/route.ts` is a **mock** — it ignores the system prompt and returns hardcoded `ChatResponse` objects keyed by phase number. To wire up a real LLM, replace this function with an actual API call (OpenAI or DeepSeek). Environment variables expected: `OPENAI_API_KEY` or `DEEPSEEK_API_KEY` + `DEEPSEEK_API_BASE`.

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
        ChatInterface (chat state, messages, fetch)
```
