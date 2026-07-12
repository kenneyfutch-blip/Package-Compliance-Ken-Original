---
name: AI compliance legal guardrails
description: Durable policy for how AI packaging-compliance findings must be constrained to limit legal exposure, and why enforcement lives in code not the prompt.
---

# AI compliance legal guardrails

Applies to the AI compliance analysis engines (packaging analysis, and by
extension language/claims review). These are legal-exposure controls, not UX
polish — treat them as invariants.

## Enforce in the parser, never trust the prompt alone
Prompt instructions telling the model to hedge / calibrate confidence are NOT
sufficient — the model does not obey reliably. Every legal-safety rule below is
also enforced deterministically when parsing the model output, and that code path
is authoritative.
**Why:** presenting a low-confidence AI guess as a definitive regulatory
violation is the core liability. A prompt-only guardrail fails silently the first
time the model drifts.

## Confidence gates the severity of a finding
An uncertain finding can never be surfaced as a hard, definitive violation. Below
a high-confidence bar it is capped to a softer class; below a low bar it becomes a
non-blocking informational review item. Anything high-risk OR low-confidence is
flagged for human review and carries a per-finding caveat (only genuinely
"passed"/compliant checks are exempt from the caveat).
**How to apply:** if you add finding classes or change severity/count logic, keep
this ladder intact and make sure blocking counts only tally the hard classes, so
downgraded findings stop inflating them.

## Anti-fabrication
Never invent regulations, citations, or evidence. Citations/evidence must come
only from the inputs actually provided (knowledge base, eCFR, internal standards,
artwork text). When information needed for a determination is missing, emit an
"Additional Information Required" recommendation instead of inferring.

## Standing disclaimer is fixed legal copy, mirrored
A standing "AI-assisted assessment, not legal advice/approval" disclaimer is
attached to every analysis result and shown in the review UI. The string is
mirrored as a constant on both server and frontend (same manual-sync pattern as
upload limits). No decision logic depends on its value, so drift is only a
copy-consistency risk — keep the two copies identical when editing the wording.
