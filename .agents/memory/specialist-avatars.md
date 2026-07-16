---
name: AI specialist avatars (employee personas)
description: How AI Workspace specialists get human names + headshots in the chat, and the client-side mapping decision.
---

# AI specialist avatars

The AI Workspace specialists (personas defined server-side in `api-server/src/lib/specialists.ts`,
schema `WorkspaceSpecialist` = key/label/description/suggestedPrompts) are presented as "AI employees"
with a human name + headshot in the chat.

## Decision: identity is client-side, not in the API schema
Names + photos live in `compliance/src/lib/specialist-profiles.ts` (a plain `.ts` registry keyed by
specialist key), NOT on the `WorkspaceSpecialist` API type. Photos are static brand assets in
`compliance/public/specialists/<key>.jpg`, resolved via `${import.meta.env.BASE_URL}specialists/...`.

**Why:** the mapping is purely presentational and the assets are static; adding an `avatar` field to the
openapi schema would force an orval codegen + lib rebuild cycle for zero functional gain. Keep it client-side.

**How to apply:** to add/replace a specialist face, drop a square jpg in `public/specialists/` and add/edit
the entry in `specialist-profiles.ts`. `getSpecialistProfile(key,label)` synthesizes a fallback (initials
from label) for unknown keys. `agent_router` ("Workspace Router") intentionally has NO photo — it's a
dispatcher, not a person, so it renders a branded initials chip.

## SpecialistAvatar component gotcha
`components/specialist-avatar.tsx` exports ONLY the component (Fast-Refresh boundary rule — keep the plain
registry/helpers in the `.ts` file). It tracks a `broken` state for `<img onError>` -> initials fallback.
**Must** `useEffect(() => setBroken(false), [profile.photo])` — otherwise one transient image failure leaves
that mounted avatar instance stuck on initials forever, even after switching to a specialist with a valid photo.

## Selector chip + responsive-overflow interaction
The specialist selector chips include a 16px avatar. The hidden measurement row that drives the responsive
overflow calc MUST mirror the exact same avatar + gap, or the fit math desyncs. When chip inner content
changes, update both the real chip and the measurement span, and revisit `MORE_RESERVE` in the fit effect.
