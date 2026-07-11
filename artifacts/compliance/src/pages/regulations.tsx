import { useState } from "react"
import { useListRegulations } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Scale, BookOpen, ExternalLink } from "lucide-react"

export default function RegulationsPage() {
  const [search, setSearch] = useState("")
  const { data: regulations = [], isLoading } = useListRegulations({ search })

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Regulatory Knowledge Base</h1>
          <p className="text-muted-foreground mt-1">Search FDA, EPA, CPSC and internal rules.</p>
        </div>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input 
          placeholder="Search rule codes, summaries, agencies..." 
          className="pl-10 h-12 text-base bg-card"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading regulations...</div>
        ) : regulations.length === 0 ? (
          <div className="p-8 text-center bg-card rounded-xl border border-dashed">No regulations found.</div>
        ) : regulations.map(reg => (
          <Card key={reg.id} className="hover-elevate transition-all">
            <CardHeader className="py-4">
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/20">{reg.agency}</Badge>
                    <Badge variant="outline">{reg.ruleCode}</Badge>
                    <span className="text-xs text-muted-foreground">{reg.category}</span>
                  </div>
                  <CardTitle className="text-lg leading-tight mt-2">{reg.title}</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="py-0 pb-4">
              <p className="text-sm text-foreground/80 leading-relaxed mb-4">
                {reg.summary}
              </p>
              <div className="flex gap-4 text-xs text-muted-foreground bg-accent/50 p-3 rounded-md">
                {reg.section && <span className="flex items-center gap-1"><BookOpen className="w-3 h-3"/> Section: {reg.section}</span>}
                {reg.source && <span className="flex items-center gap-1"><Scale className="w-3 h-3"/> Source: {reg.source}</span>}
                <a href="#" className="ml-auto flex items-center gap-1 text-primary hover:underline">
                  View Full Text <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
