import { useMemo, useState } from "react"
import { BookOpen, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { TrainingHeader, Chip } from "@/components/training/kit"
import { cn } from "@/lib/utils"
import { GUIDE_SECTIONS } from "@/lib/training/content-guide"

export default function UserGuide() {
  const [query, setQuery] = useState("")
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const q = query.trim().toLowerCase()

  const sections = useMemo(() => {
    if (!q) return GUIDE_SECTIONS
    return GUIDE_SECTIONS.map((section) => ({
      ...section,
      articles: section.articles.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.body.some((p) => p.toLowerCase().includes(q)),
      ),
    })).filter((s) => s.articles.length > 0)
  }, [q])

  const scrollTo = (id: string) => {
    setActiveSection(id)
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={BookOpen}
        eyebrow="Training & Help"
        title="User Guide"
        description="The complete reference for Packaging Compliance AI, organized by area. Search across every article or jump straight to a section."
      />

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the user guide..."
          className="pl-9"
        />
      </div>

      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
        {!q && (
          <nav className="mb-6 hidden lg:block">
            <div className="sticky top-4 space-y-1">
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sections
              </p>
              {GUIDE_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollTo(section.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                    activeSection === section.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <section.icon className="h-4 w-4 shrink-0" />
                  {section.title}
                </button>
              ))}
            </div>
          </nav>
        )}

        <div className="space-y-8">
          {sections.length === 0 ? (
            <p className="text-muted-foreground">No articles matched “{query}”.</p>
          ) : (
            sections.map((section) => {
              const Icon = section.icon
              return (
                <section key={section.id} id={`guide-${section.id}`} className="scroll-mt-4">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
                      <p className="text-sm text-muted-foreground">{section.summary}</p>
                    </div>
                  </div>
                  <Card>
                    <CardContent className="p-2 sm:p-4">
                      <Accordion type="multiple" defaultValue={q ? section.articles.map((a) => a.key) : []} className="w-full">
                        {section.articles.map((article) => (
                          <AccordionItem
                            key={article.key}
                            value={article.key}
                            className="border-b last:border-b-0"
                          >
                            <AccordionTrigger className="text-left hover:no-underline">
                              <span className="flex flex-1 items-center gap-2 pr-4">
                                <span className="font-medium text-foreground">{article.title}</span>
                                {article.audience && <Chip tone="blue">{article.audience}</Chip>}
                              </span>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="space-y-3 text-sm text-muted-foreground">
                                {article.body.map((p, i) => (
                                  <p key={i}>{p}</p>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </CardContent>
                  </Card>
                </section>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
