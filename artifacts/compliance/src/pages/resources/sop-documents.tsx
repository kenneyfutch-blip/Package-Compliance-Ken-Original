import { Link } from "wouter"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileText, ArrowLeft, Upload, History, GitCompare } from "lucide-react"

// Reserved Resource Center section. The SOP document management feature (uploads,
// version history, comparison) drops into this page + its own API/data model
// without touching shared navigation or routing.
export default function SopDocuments() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link href="/resources" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Resource Center
      </Link>

      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <FileText className="h-7 w-7 text-primary" />
          SOP Documents
        </h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          A managed library of standard operating procedure documents with uploads, version
          history and side-by-side comparison.
        </p>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <FileText className="h-7 w-7" />
          </div>
          <div>
            <p className="text-lg font-semibold">SOP document management is coming soon</p>
            <p className="mx-auto mt-1 max-w-md text-muted-foreground">
              This section is reserved in the Resource Center. Once enabled you&apos;ll be able to
              upload SOPs, track every revision, and compare versions.
            </p>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Upload className="h-4 w-4" /> Uploads</span>
            <span className="inline-flex items-center gap-1.5"><History className="h-4 w-4" /> Version history</span>
            <span className="inline-flex items-center gap-1.5"><GitCompare className="h-4 w-4" /> Comparison</span>
          </div>
          <Link href="/resources">
            <Button variant="outline" className="mt-2">Back to Resource Center</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
