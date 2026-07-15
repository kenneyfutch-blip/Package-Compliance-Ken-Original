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

**Why:** first seen when `lib/access.tsx` exported a plain `requiredPermFor(path)` mapper next to
its components/hooks; moving that to `lib/permissions.ts` helped but did NOT fully cure it.

**The deeper, real cause (proven later):** it is NOT only "a non-component export." A Provider+hook
pair alone still crashes. `access.tsx` (PermissionProvider + usePermissions + NoAccess) and
`favorites.tsx` (FavoritesProvider + useFavorites) — all React exports, no plain function — STILL
threw `usePermissions must be used within a PermissionProvider` on HMR. Trigger: `React.createContext`
is CALLED at module scope in a file that Fast Refresh re-evaluates (because it also exports a
hook, which makes the module Fast-Refresh-incompatible → vite logs `Could not Fast Refresh
("useX" export is incompatible)` and re-runs it). Re-running mints a BRAND-NEW context object while
the mounted Provider still holds the OLD one, so `useContext` returns null → throw. The hook that
runs earliest in the tree blows up first (here `FavoritesProvider` calls `usePermissions` at render).

**Durable fix (do this):** move each `createContext(...)` call — and its state type — into its own
**component-free, hook-free module** (e.g. `lib/permission-context.ts`, `lib/favorites-context.ts`)
that exports ONLY the context object + type. The provider `.tsx` imports the stable context. Because
a dependency module is not re-run when a dependent hot-updates, the context OBJECT keeps a stable
identity across every HMR cycle → no null → no crash. This is zero-churn: all existing exports
(Provider/hook/etc.) stay in the same `.tsx`, so no consumer imports change. The benign
`Could not Fast Refresh` invalidate warning remains (harmless — it's just a full-module re-run).

**Not every such module needs the fix:** a hook that returns a no-op/default fallback instead of
throwing when context is null (e.g. `presence.tsx`'s `usePresence`) degrades gracefully and cannot
hard-crash — leave those alone rather than churn them.

**How to apply:** when adding a helper next to a provider/hook, put pure functions in a `.ts`
utility module. And keep `createContext` in its own component/hook-free module whenever the
provider file also exports a hook. If you see the "export is incompatible" vite warning on a
provider file whose hook THROWS on missing context, extract the context before it crashes.

## Related: transient crash during orval codegen
Same error can also appear transiently because `lib/api-spec/orval.config.ts` uses `clean: true`,
which deletes `lib/api-client-react/src/generated/*.ts` before rewriting them. If the vite dev
server is live during codegen, it fails to hot-load the momentarily-missing module → whole API
client fails → PermissionProvider never mounts. Self-heals once codegen finishes + server
restarts. Not app-fixable without changing the codegen/dev workflow; don't misdiagnose as a
code regression.
