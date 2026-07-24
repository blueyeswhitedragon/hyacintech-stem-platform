---
name: hyacintech-data-lab-curator
description: Curate Hyacintech STEM Data Lab batches end to end before human final review. Use when Codex needs to inspect TopicCard coverage, generate and quality-review missing TopicCards, compile Tutor cases, run A/B candidate generation with cross-Critic, prepare or submit explicitly authorized AI first reviews, or report student-case feedback returned by human reviewers.
---

# Hyacintech Data Lab Curator

Operate from the repository root. Use the bundled CLI for state changes and resumable batch work; use the references for semantic judgment. Keep the Human Reviewer as the final gate.

## Guardrails

- Load credentials only through the repository `.env`. Never print, copy, or store API keys in this skill or generated review files.
- Use only the repository provider routes `openai` and `deepseek`. An OpenAI-compatible relay model still uses `provider=openai`; the model name does not create a new base URL. Set `family` separately when provider and model naming do not reveal the actual model family.
- Start with read-only commands. Before a paid or database-writing command, state its scope and obtain the user's authorization unless the current request already authorizes that exact action.
- Pass `--apply` and an active admin identity through `--actor <username>` or `DATA_LAB_AGENT_USERNAME` for every mutation. Never invent an identity or use a password.
- Preserve AI provenance. First-review reasons must retain the CLI-added `AI_ASSISTED_DRAFT: CODEX_AGENT_AUTHORIZED` disclosure. Never submit Codex work as `HUMAN`.
- Never bypass hard checks, approve a TopicCard with an unresolved high-confidence block, confirm second review, resolve admin case-quality tasks, freeze a release, or mark a dataset production-ready.
- Stop and report when model families are not independent, required provider configuration is absent, a review lease belongs to someone else, or live state differs from the review packet.

## CLI

Run:

```bash
npx tsx .codex/skills/hyacintech-data-lab-curator/scripts/data-lab-curator.ts <command> [options]
```

Use `help` for the full command list. Mutation commands are dry-run previews without `--apply`.

## Workflow

1. Inspect the current state with `status` and `topic-gaps`.
2. Read [topic-card-quality.md](references/topic-card-quality.md). Generate targeted drafts with `generate-topics`, then export `topic-packet` and inspect every field. Do not equate schema validity with quality.
3. Write a TopicCard review plan and apply it with `topic-review --input <file> --apply`. `REVISE` creates a new revision when an approved card is already used by cases; it never overwrites that historical input. `REJECT` may retire a weak or duplicate approved legacy card without deleting historical cases. Review every revised draft again before approval. Re-run `topic-gaps` after decisions.
4. Compile only from approved cards with `compile`. To let Codex perform first review, explicitly use `--review-policy AI_DIRECT_TO_REVIEWER`; use the same admin actor for later submission.
5. Generate A/B plus cross-Critic with `generate-candidates --run-id <id> ... --apply`. Re-run the same command to resume `READY`, `NEEDS_REGEN`, or `NEEDS_CRITIC` cases.
6. Export `first-review-packet --run-id <id> --out <file>`. Read [tutor-first-review.md](references/tutor-first-review.md), judge each case and candidate, and create a review plan. Treat Critic output as evidence, not authority.
7. Submit with `submit-first-review --input <file> --apply`. Use `RETURN_CASE` for an unnatural, contradictory, phase-invalid, or otherwise unusable student prompt. Leave every accepted draft in `AWAITING_CONFIRMATION` for an independent human Reviewer.
8. Run `case-return-report` periodically. Read [case-quality-feedback.md](references/case-quality-feedback.md), summarize recurring upstream defects, and feed them into future generation. Do not resolve those tasks in this skill version.

## Review Artifacts

Keep generated packets and plans under `tmp/` unless the user requests another location. Treat them as operational artifacts, not source files. Before applying a stale plan, export a fresh packet and compare case statuses, candidate IDs, and revision numbers.

For TopicCard plan structure, use the schema shown by `topic-review --example`. For first-review plan structure, use `submit-first-review --example`.

## Completion

Report counts for generated, failed, skipped, returned, and awaiting-human-review items. Identify any partial failures by case ID and next resumable command. Do not describe a batch as finished while cases remain in generation, first review, or returned-case states.
