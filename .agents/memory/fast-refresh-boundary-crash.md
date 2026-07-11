---
name: Fast Refresh boundary crash
description: Mixing non-component exports into a React component file breaks HMR and throws context-provider errors during dev.
---

# React Fast Refresh boundary crashes (compliance app)

Symptom: dev-only white-screen with "usePermissions must be used within a PermissionProvider"
(or any `useX must be used within XProvider`), often preceded in vite logs by:
`hmr invalidate /src/.../X.tsx Could not Fast Refresh ("<name>" export is incompatible)`
and in the browser console by "Invalid hook call ... more than one copy of React".

**Rule:** a `.tsx` file that exports React components/hooks must export ONLY components and
hooks. Adding a plain function (or other value export) makes the file an invalid Fast Refresh
boundary; on hot-update vite tears down and re-creates the module's React context, so consumers
mid-tree read a null context and throw. This is NOT a logic bug in the provider — it is HMR
state loss. It self-heals on full reload, which is why it looks intermittent.

**Why:** happened when `lib/access.tsx` exported `PermissionProvider`/`usePermissions`/`NoAccess`
plus a plain `requiredPermFor(path)` route→permission mapper. Fix: move the plain function to a
separate non-React module (`lib/permissions.ts`) and import it from there. Provider+hook pairs in
one file (e.g. ThemeProvider+useTheme) are fine — the trigger is a NON-component/non-hook export.

**How to apply:** when adding a helper next to a provider/hook, put pure functions in a `.ts`
utility module, not in the component `.tsx`. If you see the "export is incompatible" vite warning,
that file is the culprit — split it before it causes a context crash.

## Related: transient crash during orval codegen
Same error can also appear transiently because `lib/api-spec/orval.config.ts` uses `clean: true`,
which deletes `lib/api-client-react/src/generated/*.ts` before rewriting them. If the vite dev
server is live during codegen, it fails to hot-load the momentarily-missing module → whole API
client fails → PermissionProvider never mounts. Self-heals once codegen finishes + server
restarts. Not app-fixable without changing the codegen/dev workflow; don't misdiagnose as a
code regression.
