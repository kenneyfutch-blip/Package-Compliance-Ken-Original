import * as React from "react"

// Lightweight, app-wide "what is the user looking at right now" registry. Record
// pages call useRegisterPageContext(...) to publish a bounded summary of the
// current record; the AI Workspace reads it via usePageContext() so answers can
// be aware of the current context. Everything is optional — the Workspace works
// fine when nothing is registered.

export type PageContext = {
  path?: string | null
  title?: string | null
  summary?: string | null
}

type PageContextValue = {
  context: PageContext | null
  setContext: (ctx: PageContext | null) => void
}

const Ctx = React.createContext<PageContextValue | null>(null)

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = React.useState<PageContext | null>(null)
  const value = React.useMemo(() => ({ context, setContext }), [context])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePageContext(): PageContext | null {
  const v = React.useContext(Ctx)
  return v?.context ?? null
}

// Hook for record pages to publish their context while mounted. The context is
// cleared automatically on unmount. Pass null/undefined fields you don't have.
export function useRegisterPageContext(ctx: PageContext | null): void {
  const v = React.useContext(Ctx)
  const setContext = v?.setContext
  // Serialize so the effect only re-runs when the meaningful fields change.
  const key = ctx ? `${ctx.path ?? ""}|${ctx.title ?? ""}|${ctx.summary ?? ""}` : ""
  React.useEffect(() => {
    if (!setContext) return
    setContext(ctx && (ctx.title || ctx.summary || ctx.path) ? ctx : null)
    return () => setContext(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setContext, key])
}
