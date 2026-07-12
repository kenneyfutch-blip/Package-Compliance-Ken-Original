import { useMemo, useState } from "react"
import { Link } from "wouter"
import { HelpCircle, Search, LifeBuoy } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { TrainingHeader } from "@/components/training/kit"
import { FAQ_CATEGORIES } from "@/lib/training/content-reference"

export default function Faq() {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return FAQ_CATEGORIES
    return FAQ_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (it) =>
          it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q),
      ),
    })).filter((cat) => cat.items.length > 0)
  }, [query])

  const total = filtered.reduce((n, c) => n + c.items.length, 0)

  return (
    <div className="space-y-8">
      <TrainingHeader
        icon={HelpCircle}
        eyebrow="Training & Help"
        title="Frequently Asked Questions"
        description="Quick answers to the questions we hear most. Search across every question below, or browse by category."
      />

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search questions and answers..."
          className="pl-9"
        />
      </div>

      {total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <HelpCircle className="h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground">
              No answers matched “{query}”. Try different words, or ask us directly.
            </p>
            <Link href="/training/support">
              <Button variant="outline" className="gap-2">
                <LifeBuoy className="h-4 w-4" />
                Contact support
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {filtered.map((cat) => (
            <div key={cat.category}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {cat.category}
              </h2>
              <Card>
                <CardContent className="p-2 sm:p-4">
                  <Accordion type="multiple" className="w-full">
                    {cat.items.map((item, i) => (
                      <AccordionItem
                        key={i}
                        value={`${cat.category}-${i}`}
                        className="border-b last:border-b-0"
                      >
                        <AccordionTrigger className="text-left text-sm font-medium hover:no-underline">
                          {item.q}
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground">
                          {item.a}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-foreground">Still stuck?</h3>
            <p className="text-sm text-muted-foreground">
              File a support request and an administrator will get back to you.
            </p>
          </div>
          <Link href="/training/support">
            <Button className="gap-2">
              <LifeBuoy className="h-4 w-4" />
              Contact support
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
