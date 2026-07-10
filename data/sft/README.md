# STEM Tutor SFT Seed Data

This directory stores hand-crafted seed data for fine-tuning/post-training the Qwen model in this repository's STEM tutor workflow.

## Goal

The target is not open-world creativity. The target is stronger behavior in a bounded product setting:

- context-grounded STEM tutoring
- pedagogy-constrained phase discipline
- stable JSON output compatible with the app parser
- better topic transformation than the baseline Qwen smoke run

The first seed set is tied to blind-eval v3 evidence under `data/blind-eval/`, especially:

- `verdict-qwen-smoke-vs-dsv4-smoke-工程项目型.json`
- `verdict-qwen-smoke-vs-dsv4-smoke-高概念降级型.json`

## Files

- `sharegpt-stem-seed.json` is generated output in common ShareGPT style.
- `sharegpt-auto-*.json` files are auto-converted silver data from blind-eval transcripts.
- `sharegpt-auto-*-pure.json` files strip metadata and keep only `{ conversations }` for platform import.
- `scripts/build-sharegpt-seed.ts` is the editable hand-crafted source.
- `scripts/transcript-to-sharegpt.ts` converts `data/blind-eval/transcript-*.json` into ShareGPT records.
- `scripts/distill-dsv4-sharegpt.ts` plans, generates, cleans, and splits DSV4 distilled samples.
- `scripts/test-sharegpt-dataset.ts` validates structure and rubric-critical constraints.

## Format

Each record uses a common ShareGPT `conversations` array:

```json
{
  "id": "stem-p1-engineering-watering-threshold-v1",
  "scenario": "工程项目型-自动浇花器",
  "phase": 1,
  "rubricTargets": ["theme_fidelity", "student_agency"],
  "conversations": [
    { "from": "human", "value": "..." },
    { "from": "gpt", "value": "{\"dialogue\":\"...\",\"next_action_type\":\"text_input\",\"phase_complete\":false}" }
  ]
}
```

Extra metadata is intentional for traceability. If the competition platform requires pure ShareGPT only, strip everything except `conversations` during export.

## Commands

```bash
# Build hand-crafted gold seed data
npx tsx scripts/build-sharegpt-seed.ts

# Convert clean transcript segments into silver SFT data
npx tsx scripts/transcript-to-sharegpt.ts --source-tag dsv4-smoke --out data/sft/sharegpt-auto-smoke.json --phases 1,2,4,5

# Export pure ShareGPT records for platforms that only accept conversations
npx tsx scripts/transcript-to-sharegpt.ts --source-tag dsv4-smoke --out data/sft/sharegpt-auto-smoke-pure.json --pure true

# Validate default seed or a generated dataset
npx tsx scripts/test-sharegpt-dataset.ts
npx tsx scripts/test-sharegpt-dataset.ts data/sft/sharegpt-auto-smoke.json

# Build a 600-item six-phase DSV4 distillation plan
npx tsx scripts/distill-dsv4-sharegpt.ts plan --target 600

# Inspect the first planned DSV4 prompt without calling the API
npx tsx scripts/distill-dsv4-sharegpt.ts generate --limit 1 --dry-run true

# Generate a resumable teacher batch, then clean/split outputs
LLM_PROVIDER=deepseek LLM_MODEL=deepseek-v4-pro LLM_TIMEOUT_MS=180000 LLM_MAX_TOKENS=6000 \
  npx tsx scripts/distill-dsv4-sharegpt.ts generate --limit 30
npx tsx scripts/distill-dsv4-sharegpt.ts clean
```

## Expansion Rules

- Prefer small, high-signal examples tied to a rubric failure over bulk synthetic data.
- Every phase 1 confirmation must include `theme_mapping`, `snapshot`, and `variables.independent`.
- Engineering topics must preserve the original mechanism. Do not turn threshold-trigger systems into unrelated material-effect experiments.
- Stage 1 must not use `ask_choice` or non-empty `options`.
- One assistant turn should ask at most one core question plus one light follow-up.
- Stage 2 confirmation must include `data_table_schema` with a `notes` column and `maxRows: 200`.
- DSV4-distilled records are `gold_candidate` until a human review accepts them as gold.
