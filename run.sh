#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BATCH_ID:-}" ]]; then
  echo "BATCH_ID is required, for example: BATCH_ID=distill-dsv4-batch500 ./run.sh" >&2
  exit 1
fi

BATCH_ID="$BATCH_ID"
PLAN="${PLAN:-data/sft/distill-plan-dsv4.json}"
RAW="${RAW:-data/sft/sharegpt-${BATCH_ID}-raw.json}"
CLEAN="${CLEAN:-data/sft/sharegpt-${BATCH_ID}-clean.json}"
GOLD="${GOLD:-data/sft/sharegpt-${BATCH_ID}-gold-candidate.json}"
SILVER="${SILVER:-data/sft/sharegpt-${BATCH_ID}-silver.json}"
REJECTED="${REJECTED:-data/sft/sharegpt-${BATCH_ID}-rejected.json}"
MANIFEST="${MANIFEST:-data/sft/review-manifest-${BATCH_ID}.json}"

PHASE1_OFFSET="${PHASE1_OFFSET:-11}"
PHASE2_OFFSET="${PHASE2_OFFSET:-8}"
PHASE3_OFFSET="${PHASE3_OFFSET:-3}"
PHASE4_OFFSET="${PHASE4_OFFSET:-4}"
PHASE5_OFFSET="${PHASE5_OFFSET:-3}"
PHASE6_OFFSET="${PHASE6_OFFSET:-2}"

PHASE1_LIMIT="${PHASE1_LIMIT:-35}"
PHASE2_LIMIT="${PHASE2_LIMIT:-28}"
PHASE3_LIMIT="${PHASE3_LIMIT:-9}"
PHASE4_LIMIT="${PHASE4_LIMIT:-13}"
PHASE5_LIMIT="${PHASE5_LIMIT:-9}"
PHASE6_LIMIT="${PHASE6_LIMIT:-6}"

SKIP_GENERATE="${SKIP_GENERATE:-false}"
SKIP_CLEAN="${SKIP_CLEAN:-false}"
SKIP_TEST="${SKIP_TEST:-false}"

if [[ ! -f "$PLAN" ]]; then
  echo "Plan not found: $PLAN" >&2
  exit 1
fi

if [[ "$SKIP_GENERATE" != "true" ]]; then
  if [[ ! -f .env ]]; then
    echo ".env not found. Copy .env.example to .env and set DEEPSEEK_API_KEY first." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1091
  source .env
  set +a

  export LLM_PROVIDER="${LLM_PROVIDER:-deepseek}"
  export LLM_MODEL="${LLM_MODEL:-deepseek-v4-pro}"
  export LLM_TIMEOUT_MS="${LLM_TIMEOUT_MS:-180000}"
  export LLM_MAX_TOKENS="${LLM_MAX_TOKENS:-6000}"

  echo "Generating raw records into $RAW"
  npx tsx scripts/distill-dsv4-sharegpt.ts generate --plan "$PLAN" --raw-out "$RAW" --phase 1 --offset "$PHASE1_OFFSET" --limit "$PHASE1_LIMIT"
  npx tsx scripts/distill-dsv4-sharegpt.ts generate --plan "$PLAN" --raw-out "$RAW" --phase 2 --offset "$PHASE2_OFFSET" --limit "$PHASE2_LIMIT"
  npx tsx scripts/distill-dsv4-sharegpt.ts generate --plan "$PLAN" --raw-out "$RAW" --phase 3 --offset "$PHASE3_OFFSET" --limit "$PHASE3_LIMIT"
  npx tsx scripts/distill-dsv4-sharegpt.ts generate --plan "$PLAN" --raw-out "$RAW" --phase 4 --offset "$PHASE4_OFFSET" --limit "$PHASE4_LIMIT"
  npx tsx scripts/distill-dsv4-sharegpt.ts generate --plan "$PLAN" --raw-out "$RAW" --phase 5 --offset "$PHASE5_OFFSET" --limit "$PHASE5_LIMIT"
  npx tsx scripts/distill-dsv4-sharegpt.ts generate --plan "$PLAN" --raw-out "$RAW" --phase 6 --offset "$PHASE6_OFFSET" --limit "$PHASE6_LIMIT"
fi

if [[ "$SKIP_CLEAN" != "true" ]]; then
  echo "Cleaning $RAW"
  npx tsx scripts/distill-dsv4-sharegpt.ts clean \
    --plan "$PLAN" \
    --raw "$RAW" \
    --clean-out "$CLEAN" \
    --gold-candidate-out "$GOLD" \
    --silver-out "$SILVER" \
    --rejected-out "$REJECTED" \
    --manifest-out "$MANIFEST" \
    --batch-id "$BATCH_ID"
fi

if [[ "$SKIP_TEST" != "true" ]]; then
  echo "Validating cleaned datasets"
  npx tsx scripts/test-sharegpt-dataset.ts "$CLEAN"
  npx tsx scripts/test-sharegpt-dataset.ts "$GOLD"
  npx tsx scripts/test-sharegpt-dataset.ts "$SILVER"
fi

echo "Summary"
node -e "const m=require('./${MANIFEST}'); console.log(JSON.stringify(m.summary,null,2));"
