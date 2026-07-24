# TopicCard Quality Gate

Read this file before generating, revising, or approving TopicCards. A structurally valid card is only a draft; approval requires semantic judgment across every gate below.

## Decision Order

1. Reject an incoherent, pseudoscientific, unsafe, infeasible, or fundamentally trivial premise.
2. Revise a sound premise whose opening, bridges, measurements, engineering loop, or wording is weak.
3. Approve only when all gates pass and the card adds useful coverage without duplicating an existing project family.

For legacy approved cards, choose deliberately: create a V2 revision only when the project family remains worth carrying forward; reject/retire a duplicate or fundamentally weak legacy card. Historical cases keep their original reference, so retirement must not be disguised as deletion.

## Required Gates

### Logic and Mechanism

- The authentic need, core mechanism, factors, phenomena, and measurements must form one causal chain.
- Each proposed level must plausibly affect the stated phenomenon through that mechanism.
- Reject category errors, impossible causal claims, mismatched variables, and pseudoscientific framing.
- Do not accept a theme whose answer is obvious before any evidence is collected.

### Authenticity and Student Voice

- The opening must sound like a real junior-high student with a concrete observation, problem, or need.
- Reject openings that list variables, enumerate research directions, offer answer menus, recite a rubric, or sound like an AI assignment generator.
- Keep the context consequential enough to motivate inquiry without turning it into adult professional work.

### Measurability

- Every bridge needs at least two feasible, concrete levels and an observable outcome.
- Measurement, unit, and metric kind must agree. A qualitative rubric is allowed only when its categories are reproducible and evidence-bearing.
- Controlled conditions must isolate the chosen factor rather than restate it.
- Avoid proxy drift: the measured proxy must still answer the authentic need or evaluate the core mechanism.

### Age, Safety, and Feasibility

- Materials, time, tools, and required knowledge must fit a supervised junior-high setting.
- Reject hazardous chemicals, unsafe voltages, pressure, heat, biological exposure, structural loads, field access, or privacy collection without a realistic safe scaffold.
- Do not hide an infeasible experiment behind simulation language unless simulation is itself the intended, accessible activity.

### Inquiry Breadth

- Provide at least two genuinely different inquiry bridges under the same mechanism, not cosmetic changes to one variable.
- Avoid a unique predetermined solution. The card should support evidence-based choice, comparison, or redesign.
- Curriculum anchors must be real junior-high concepts and relevant to the actual mechanism.

### Engineering Completeness

For `ENGINEERING_DESIGN` and `HYBRID` cards:

- State a concrete stakeholder and functional engineering goal.
- Include realistic constraints and measurable performance criteria.
- Connect each bridge's evidence back to a design decision through `returnToDesign`.
- Reject science experiments relabeled as engineering when no artifact, tradeoff, constraint, or redesign loop exists.

### Diversity and Duplication

- Compare title, core mechanism, authentic need, bridge factors, and artifact/project family against approved and current draft cards.
- Reject or redirect cards that duplicate an existing project family even when surface wording differs.
- Prefer one draft that closes several real coverage gaps, but never distort subject or context labels merely to satisfy counts.

## Approval Evidence

In the review plan, mark every checklist field `PASS` and write a specific reason that mentions the mechanism, measurement feasibility, student authenticity, safety, and distinct contribution. If any field is uncertain, revise or reject instead of approving by default.
