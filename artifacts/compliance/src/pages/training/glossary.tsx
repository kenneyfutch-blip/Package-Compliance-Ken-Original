import { useMemo, useState } from "react"
import { BookMarked, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { TrainingHeader, Chip } from "@/components/training/kit"
import { cn } from "@/lib/utils"
import { GLOSSARY_TERMS } from "@/lib/training/content-reference"

export default function PlatformGlossary() {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string>("All")

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(GLOSSARY_TERMS.map((t) => t.category)))],
    [],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return GLOSSARY_TERMS.filter((t) => {
      const matchesCat = category === "All" || t.category === category
      const matchesQ =
        !q ||
        t.term.toLowerCase().includes(q) ||
        t.definition.toLowerCase().includes(q)
      return matchesCat && matchesQ
    }).sort((a, b) => a.term.localeCompare(b.term))
  }, [query, category])

  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={BookMarked}
        eyebrow="Training & Help"
        title="Platform Glossary"
        description="Plain-language definitions of the terms you'll see across the platform. For approved on-pack wording, see the Approved Language library under Resources."
      />

      <div className="flex flex-col gap-4">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search terms..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                category === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">No terms matched your search.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((term) => (
            <Card key={term.term} className="hover-elevate transition-all">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{term.term}</h3>
                  <Chip tone="primary">{term.category}</Chip>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{term.definition}</p>
                {term.related && term.related.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Related:</span>
                    {term.related.map((r) => (
                      <Chip key={r}>{r}</Chip>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
