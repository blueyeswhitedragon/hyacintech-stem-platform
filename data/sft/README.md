# STEM Tutor SFT Seed Data

This directory stores scenario seeds, quarantined legacy artifacts, and dataset schema v3 rollout assets for the STEM tutor workflow.

> **Training boundary:** `sharegpt-distill-dsv4-all-clean.json` and all derivatives of the historical 489 records are `LEGACY_QUARANTINED`. They are not positive SFT data. Only their scenario identity may seed a new role-separated rollout; old assistant answers must never be copied into v3 tutor or student context.

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
- `v3/plans/*.json` separates `studentVisible`, `tutorVisible`, and `evaluatorOnly` inputs.
- `v3/legacy-489-disposition.json` records the non-SFT disposition of every historical record.
- `scripts/build-dataset-v3-plan.ts` derives scenario-only v3 plans without reading legacy assistant answers.
- `scripts/distill-dataset-v3.ts` performs resumable student/tutor/evaluator rollouts through the production Tutor prompt and contract path.
- `scripts/validate-dataset-v3.ts` validates v3 plans and candidate/release records.
- `scripts/distill-dsv4-sharegpt.ts` is legacy-only and refuses normal generation unless explicitly overridden.
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

# Build and validate the balanced 30-item calibration plan
npm run data-lab:build-v3-plan -- --target 30 --out data/sft/v3/plans/calibration-30.json
npm run data-lab:validate-v3 -- --kind plan --file data/sft/v3/plans/calibration-30.json

# Inspect selection without API calls
npm run data-lab:distill-rollout -- --plan data/sft/v3/plans/calibration-30.json --run-id calibration-30 --dry-run

# Generate or resume the calibration run
npm run data-lab:distill-rollout -- --plan data/sft/v3/plans/calibration-30.json --run-id calibration-30 --limit 30

# Validate candidates before importing them to Data Lab
npm run data-lab:validate-v3 -- --kind candidates --file data/sft/v3/runs/calibration-30/candidates.json
```

## Expansion Rules

- Prefer small, high-signal examples tied to a rubric failure over bulk synthetic data.
- Every phase 1 confirmation must include `theme_mapping`, `snapshot`, and `topic_direction`, without formalizing P2 variables early.
- Engineering topics must preserve the original mechanism. Do not turn threshold-trigger systems into unrelated material-effect experiments.
- Stage 1 must not use `ask_choice` or non-empty `options`.
- One assistant turn should ask at most one core question plus one light follow-up.
- Stage 2 confirmation must include a full `experiment_plan` (including `repeatCount`) and a wide `data_table_schema` with a `notes` column, `minRows >= 3`, and `maxRows: 200`.
- Stage 3 entry must include a relevant `safety_quiz`; passing is server-authoritative.
- Stage 4 accepted progress requires at least two real table values written by the student in that same turn.
- A same-model evaluator can only produce `needs_review`, never an automatic gold candidate. No model-produced record is Gold until human review accepts it.
