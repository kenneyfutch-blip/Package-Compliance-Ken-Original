---
name: Brand green token (chat bubbles)
description: Why --brand equals Tailwind green-600 and must not be "fixed" for WCAG contrast.
---

# Brand green token

`--brand` in `compliance/src/index.css` = Tailwind **green-600** (`142 76% 36%` / `#16a34a`) in both
light and dark themes. It is used for the AI Workspace + assistant-panel user chat bubbles (`bg-brand`)
and the `agent_router` avatar tint.

**Why:** the user explicitly asked the chat bubble to be "the same green as the New Package upload button,"
and that button uses the default `Button` variant which is literally `bg-green-600 text-white`. So the token
is pinned to green-600 for an exact visual match.

**How to apply:** do NOT darken `--brand` back toward AA contrast (white-on-green-600 is ~3.3:1, below the
4.5:1 normal-text bar). That lower contrast is an accepted, deliberate tradeoff to match the button — it was
previously darkened to `146 100% 26%` for AA and the user overrode that. If the button's green changes, update
`--brand` to track it (or switch the bubble to reference the same utility) rather than diverging.
