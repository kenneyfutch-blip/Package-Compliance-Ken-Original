---
name: Clerk shadcn theme CSS (@source, Tailwind v4)
description: Why @clerk/themes/shadcn.css must be imported unlayered, and where the real Clerk modal layering fix lives.
---

# Clerk shadcn theme + Tailwind v4

`@clerk/themes/shadcn.css` is **one line only**: `@source "./shadcn.js";`. It contains
**no style rules** — it only registers Clerk's shadcn theme JS as a Tailwind content
source so the theme's utility classes get generated.

**Rule:** import it at the top level, NOT wrapped in a layer:
`@import '@clerk/themes/shadcn.css';`  ✅
`@import '@clerk/themes/shadcn.css' layer(clerk);`  ❌ breaks the whole stylesheet.

**Why:** Tailwind v4 rejects a nested `@source` with `` `@source` cannot be nested ``.
Wrapping the import in `layer(...)` nests the directive → the CSS transform 500s →
the entire frontend renders unstyled/blank (dev shows a vite "Internal server error").

**How to apply:** The Clerk sign-in/modal **layering/specificity** fix does NOT come
from this import (there are no styles in it to layer). It comes from:
1. `cssLayerName: "clerk"` in the `clerkAppearance` object (App.tsx) — routes Clerk's
   runtime-injected styles into the `clerk` layer, and
2. the `@layer theme, base, clerk, components, utilities;` order declaration at the top
   of `index.css`.
So you can safely import shadcn.css unlayered without regressing the modal overlap fix.
