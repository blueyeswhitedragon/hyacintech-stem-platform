# Returned Case Feedback

Human final review may choose `RETURN_CASE`. The service then creates a pending `CASE` quality task and moves the source case to `CASE_NEEDS_REVISION`. An administrator may later create a revision, keep the original, or reject it.

This skill version is read-only for that queue.

## Use the Feedback

- Run `case-return-report` and group results by category, phase, topic, compiler profile, and repeated wording pattern.
- Separate isolated mistakes from systematic compiler defects.
- Feed recurring findings into future TopicCard selection, case compilation constraints, and first-review judgment.
- Treat proposed student messages as reviewer evidence, not automatically approved replacements.
- Report task and case IDs so an administrator can resolve them in the normal UI.

## Do Not

- Do not call the admin resolution service.
- Do not modify the original case, create a revision, keep a case, or reject it on behalf of the administrator.
- Do not regenerate Tutor candidates for a case while it remains `CASE_NEEDS_REVISION`.
- Do not count a returned case as completed first or final review.
