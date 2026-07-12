import * as React from "react"
import { usePermissions } from "@/lib/access"

// -----------------------------------------------------------------------------
// Favorite tools — lets each user star the tools they use most so they surface
// in a pinned sidebar section and a quick-access menu in the top navigation.
//
// Persisted per-browser AND per-user: the storage key is scoped by the signed-in
// user id so one account's stars never bleed into another on a shared browser.
// The ordered list of hrefs preserves the order the user starred them in.
// -----------------------------------------------------------------------------

const STORAGE_PREFIX = "compliance-favorite-tools-v1"

function storageKey(userId: string | number | null | undefined): string {
  return `${STORAGE_PREFIX}:${userId ?? "anon"}`
}

function loadFavorites(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    // Dedupe defensively in case storage was hand-edited or corrupted.
    const seen = new Set<string>()
    const out: string[] = []
    for (const x of parsed) {
      if (typeof x === "string" && !seen.has(x)) {
        seen.add(x)
        out.push(x)
      }
    }
    return out
  } catch {
    return []
  }
}

type FavoritesState = {
  /** Starred hrefs, in the order they were added. */
  favorites: string[]
  isFavorite: (href: string) => boolean
  toggle: (href: string) => void
}

const FavoritesContext = React.createContext<FavoritesState | null>(null)

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { me } = usePermissions()
  const key = storageKey(me?.id)

  const [favorites, setFavorites] = React.useState<string[]>(() => loadFavorites(key))

  // When the signed-in user changes, load that user's stored favorites. We do
  // NOT persist from an effect — writes are done write-through in toggle() — to
  // avoid a race where the old user's list gets written under the new key.
  React.useEffect(() => {
    setFavorites(loadFavorites(key))
  }, [key])

  const value = React.useMemo<FavoritesState>(
    () => ({
      favorites,
      isFavorite: (href: string) => favorites.includes(href),
      toggle: (href: string) => {
        const next = favorites.includes(href)
          ? favorites.filter((h) => h !== href)
          : [...favorites, href]
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          /* storage unavailable — non-fatal, favorites just won't persist */
        }
        setFavorites(next)
      },
    }),
    [favorites, key],
  )

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites(): FavoritesState {
  const ctx = React.useContext(FavoritesContext)
  if (!ctx) {
    throw new Error("useFavorites must be used within a FavoritesProvider")
  }
  return ctx
}
