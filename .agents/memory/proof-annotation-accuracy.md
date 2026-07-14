---
name: Proof annotation geometry (pin accuracy)
description: Why compliance-proof finding pins are NOT grounded in real artwork geometry, and the correct fix.
---
# Proof annotation accuracy

Finding pins on the compliance proof (and the exported PDF) are **NOT** grounded
in real artwork geometry — they are model guesses or a synthetic grid.

Mechanism:
- `analyzePackaging` prompt (lib/ai.ts) asks the model for an "approximate
  normalized bounding box {x,y,w,h}" based on TYPICAL packaging layout
  (top=branding/claims, middle=ingredients, bottom=net weight). The model only
  sees OCR **text**, never coordinates, so the boxes are heuristic guesses.
- When the model returns no bbox, `applyAnalysis`/`layoutPinPositions`
  (packageService.ts) drops the pin into a synthetic non-overlapping grid in a
  central "safe band."
- Default **OpenAI Vision OCR returns a flat transcript with NO coordinates**;
  Google Document AI returns per-block/entity boxes but the analysis IGNORES
  that spatial data.
- Pins render (proof-viewer.tsx) and export (proofPdf.ts) from these normalized
  coords; the pin NUMBER is just the finding's array index, not a location.

**Why it matters:** the exported proof goes back to a specialist to locate and
fix offending copy. Guessed pins point at the wrong place → misleading, not
evidentiary.

**Correct fix (LLM must NEVER source coordinates):** use spatial OCR that returns
word/line boxes, then deterministically map each finding's `detectedText` (the
prompt already forces it to be literal artwork copy) back to the matching OCR
tokens to compute a REAL bbox. Missing-element findings (`detectedText` null)
have no location → label "location N/A", never a fake pin.

**Cost tradeoff (ties to the token-cost work):** spatial OCR is the lever —
Google Document AI (per-page $, good text + boxes) vs local Tesseract (free,
lower fidelity on stylized art) vs OpenAI Vision (cheap, great text, ZERO boxes →
can't support accurate pins). The `detectedText`→box matcher is provider-independent.
