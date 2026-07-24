# Tutor First Review

Read this file before preparing a first-review plan. The objective is a strong draft for an independent Human Reviewer, not final approval.

## Evaluate the Case First

Before comparing A and B, verify that the compiled student case is usable:

- The student message sounds natural in context and does not read like a rubric prompt or model-generated error injection.
- The message, history, visible facts, knowledge state, phase, and allowed focus agree.
- The scenario has real discrimination value: a good Tutor response can be distinguished from a bad one.
- The prompt contains enough visible evidence for the expected task without exposing private review material.

Use `RETURN_CASE` when the case itself is defective. Include one or more categories from:

- `UNNATURAL_STUDENT_MESSAGE`
- `KNOWLEDGE_STATE_CONTRADICTION`
- `DATA_PROMPT_MISMATCH`
- `PHASE_MISMATCH`
- `INVALID_SCENARIO`
- `LOW_DISCRIMINATION_VALUE`
- `OTHER`

Give a concrete note and, when possible, a natural suggested student message. Do not force a Tutor answer to compensate for a broken case.

## Evaluate A and B

- Reject candidates with deterministic hard errors. Warnings require judgment; they are not automatic rejection.
- Check grounding against student message and visible facts. Never let private review specifications leak into Tutor language.
- Keep one pedagogical task per turn. Explanations may be followed by one closely coupled question.
- Preserve student agency. Avoid answer menus, variable lists, over-scaffolding, and completing evidence analysis for the student.
- Correct unsafe actions and material misconceptions directly when needed.
- Match the allowed focus and current phase. Do not advance the workflow early.
- Prefer concise, natural Chinese without generic praise, process narration, or template residue.

Critic issues are leads. Verify quotes and evidence yourself; ignore low-confidence or optimization-only advice that is not an actual violation.

## Decisions

- `SELECT_A` / `SELECT_B`: use an unchanged valid candidate.
- `EDIT`: use one candidate as the base and provide a corrected final output.
- `MERGE`: combine useful parts only when the result is more coherent than either source.
- `RETURN_CASE`: send an invalid student case to the admin queue.
- `REGENERATE`: request new candidates when both are unusable but the case is valid.
- `REGRESSION`, `NEGATIVE`, `REJECT`: use only for their established dataset governance purpose, with a precise reason.

Create a preference pair only when both selected and rejected candidates are structurally usable and the superiority is substantive. Do not manufacture preferences from stylistic ties or compare against a hard-failed output.

## Plan Shape

```json
{
  "runId": "case-compilation-run-id",
  "reviews": [
    {
      "caseId": "case-id",
      "decision": "EDIT",
      "selectedSlot": "A",
      "finalOutput": {
        "dialogue": "...",
        "interactionType": "clarification",
        "focus": "allowed-focus-id",
        "hints": []
      },
      "reason": "Case-grounded comparison and edit rationale.",
      "preferenceRejectedSlot": "B",
      "preferenceReason": "Why the final draft is materially better than B."
    },
    {
      "caseId": "broken-case-id",
      "decision": "RETURN_CASE",
      "reason": "The student message contradicts the visible knowledge state.",
      "caseIssue": {
        "categories": ["KNOWLEDGE_STATE_CONTRADICTION"],
        "suggestedStudentMessage": "...",
        "note": "Exact contradiction and why it invalidates comparison."
      }
    }
  ]
}
```

The CLI adds the Codex provenance disclosure and submits through the existing audited service. Never remove or overwrite that disclosure.
