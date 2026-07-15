import * as React from "react"

// The Favorites React context lives in this component-free module so its object
// identity stays stable across Fast Refresh. See permission-context.ts for the
// full rationale — a context created alongside components/hooks can be re-minted
// on HMR, detaching consumers from their Provider and crashing the dev app.

export type FavoritesState = {
  /** Starred hrefs, in the order they were added. */
  favorites: string[]
  isFavorite: (href: string) => boolean
  toggle: (href: string) => void
}

export const FavoritesContext = React.createContext<FavoritesState | null>(null)
