import { useState, useMemo } from "react"
import { useListRegulations } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Search, Loader2, Scale, BookOpen } from "lucide-react"

interface Props {
  agency: string // "FDA" | "EPA" | "CPSC" | "FTC" | "USDA" | "Internal"
  title: string
  subtitle: string
}

export default function RegulatoryLibrary({ agency, title, subtitle }: Props) {
  const [search, setSearch] = useState("")
  const { data: all = [], isLoading } = useListRegulations({ search })

  const regs = useMemo(() => {
    const want = agency.toLowerCase()
    return all.filter((r) => {
      const a = (r.agency || "").toLowerCase()
      if (want === "internal") return /internal|sop|dollar tree|brand/.test(a)
      return a.includes(want)
    })
  }, [all, agency])

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Scale className="w-7 h-7 text-primary" /> {title}
          </h1>
          <p className="text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search rules..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : regs.length === 0 ? (
        <div className="text-center py-24 border border-dashed rounded-xl bg-card">
          <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium">No rules in this library yet</p>
          <p className="text-muted-foreground mt-1">Regulations for {title} will appear here as they are added.</p>
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-0">
            <div className="text-sm text-muted-foreground">{regs.length} regulation{regs.length === 1 ? "" : "s"}</div>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {regs.map((r) => (
                <AccordionItem key={r.id} value={String(r.id)}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 text-left">
                      <Badge variant="outline" className="font-mono shrink-0">{r.ruleCode}</Badge>
                      <span className="font-medium">{r.title}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{r.agency}</Badge>
                      <Badge variant="outline">{r.category}</Badge>
                      {r.section && <Badge variant="outline">§ {r.section}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{r.summary}</p>
                    {r.regulationText && (
                      <div className="rounded-lg bg-accent/50 p-3 text-sm leading-relaxed">{r.regulationText}</div>
                    )}
                    {r.source && <p className="text-xs text-muted-foreground">Source: {r.source}</p>}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
