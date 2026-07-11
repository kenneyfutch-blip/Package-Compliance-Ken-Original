import { Link } from "wouter"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Languages, ArrowLeft, BookOpen, CheckCircle2 } from "lucide-react"

// Reserved Resource Center section. The editable approved-language / glossary
// library drops into this page + its own API/data model without touching shared
// navigation or routing. The unified search already reserves its "glossary" type.
export default function Glossary() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link href="/resources" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Resource Center
      </Link>

      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Languages className="h-7 w-7 text-primary" />
          Approved Language & Glossary
        </h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          A maintained library of pre-approved compliance language and a searchable glossary of
          terms reviewers can reuse with confidence.
        </p>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <Languages className="h-7 w-7" />
          </div>
          <div>
            <p className="text-lg font-semibold">The approved-language library is coming soon</p>
            <p className="mx-auto mt-1 max-w-md text-muted-foreground">
              This section is reserved in the Resource Center. Once enabled you&apos;ll be able to
              curate approved phrasing and glossary terms, and find them from unified search.
            </p>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Approved phrasing</span>
            <span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> Glossary terms</span>
          </div>
          <Link href="/resources">
            <Button variant="outline" className="mt-2">Back to Resource Center</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
