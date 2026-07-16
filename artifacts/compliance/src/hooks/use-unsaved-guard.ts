import * as React from "react"

// Guard against losing unsaved work. Registers the component's "dirty" state in
// a shared registry; while ANY registered state is dirty:
//  - tab close / refresh / external navigation triggers the native
//    beforeunload confirmation, and
//  - in-app navigation (wouter drives history.pushState/replaceState) asks for
//    confirmation first and is cancelled if the user declines.
// Multiple components can hold guards simultaneously (e.g. an annotation draft
// and a reply box); navigation is allowed only when none are dirty.
//
// Known limit: browser back/forward (popstate) cannot be reliably intercepted
// without URL-rewriting hacks; beforeunload still covers full page unloads.

const MESSAGE =
  "You have unsaved work on this page. Leave anyway and discard it?"

const dirtyKeys = new Set<symbol>()
let installed = false

function anyDirty(): boolean {
  return dirtyKeys.size > 0
}

function install(): void {
  if (installed || typeof window === "undefined") return
  installed = true

  window.addEventListener("beforeunload", (e) => {
    if (!anyDirty()) return
    e.preventDefault()
    // Required by some browsers for the prompt to appear.
    e.returnValue = MESSAGE
  })

  // wouter performs in-app navigation through history.pushState/replaceState.
  // Wrap them (after wouter's own patch, since this runs on first mount) so a
  // declined confirm cancels the navigation before wouter ever sees it.
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history)
    window.history[method] = function (
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      if (anyDirty() && !window.confirm(MESSAGE)) return
      original(data, unused, url)
    }
  }
}

/**
 * Declare that this component currently holds unsaved work when `dirty` is
 * true. Cleans itself up on unmount (an intentional save/submit that unmounts
 * the form releases the guard automatically).
 */
export function useUnsavedGuard(dirty: boolean): void {
  const keyRef = React.useRef<symbol | null>(null)
  if (keyRef.current === null) keyRef.current = Symbol("unsaved-guard")

  React.useEffect(() => {
    install()
    const key = keyRef.current!
    if (dirty) dirtyKeys.add(key)
    else dirtyKeys.delete(key)
    return () => {
      dirtyKeys.delete(key)
    }
  }, [dirty])
}
