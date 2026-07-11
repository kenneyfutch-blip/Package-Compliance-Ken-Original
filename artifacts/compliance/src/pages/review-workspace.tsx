import { useParams, Link } from "wouter"
import { useGetPackage, useAnalyzePackage, useUpdatePackage, getGetPackageQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { 
  ArrowLeft, BrainCircuit, CheckCircle, ShieldAlert, AlertTriangle, 
  FileText, Activity, Loader2, PlayCircle, Settings2, Info,
  ArrowRight
} from "lucide-react"
import { Input } from "@/components/ui/input"

export default function ReviewWorkspace() {
  const { id } = useParams()
  const packageId = Number(id)
  const queryClient = useQueryClient()
  
  const { data: pkg, isLoading } = useGetPackage(packageId, { 
    query: { enabled: !!packageId, queryKey: getGetPackageQueryKey(packageId) } 
  })
  
  const analyze = useAnalyzePackage()
  const updateStatus = useUpdatePackage()

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    )
  }

  if (!pkg) return <div>Not found</div>

  const handleReAnalyze = () => {
    analyze.mutate({ id: packageId }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetPackageQueryKey(packageId), data)
      }
    })
  }

  const handleStatusChange = (status: string) => {
    updateStatus.mutate({ id: packageId, data: { status } }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetPackageQueryKey(packageId), data)
      }
    })
  }

  const criticalViolations = pkg.violations?.filter(v => v.severity === 'critical') || []
  const majorViolations = pkg.violations?.filter(v => v.severity === 'major') || []
  const otherViolations = pkg.violations?.filter(v => v.severity !== 'critical' && v.severity !== 'major') || []

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col animate-in fade-in duration-300">
      {/* Workspace Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/reviews">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{pkg.name}</h1>
              <Badge variant={pkg.status === 'Approved' ? 'success' : 'outline'}>{pkg.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground font-mono">{pkg.sku} • {pkg.vendor}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {pkg.status === 'Draft' || pkg.status === 'Needs Revision' ? (
            <Button variant="outline" className="gap-2 bg-success/10 text-success border-success/20 hover:bg-success/20" onClick={() => handleStatusChange('Approved')}>
              <CheckCircle className="w-4 h-4" /> Approve
            </Button>
          ) : null}
          <Button 
            variant="default" 
            onClick={handleReAnalyze} 
            disabled={analyze.isPending}
            className="gap-2"
          >
            {analyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
            Run Analysis
          </Button>
        </div>
      </div>

      {/* Split Screen */}
      <div className="flex flex-1 overflow-hidden mt-4 gap-6">
        
        {/* LEFT: Artwork Viewer */}
        <div className="w-1/2 flex flex-col bg-accent/30 border border-border rounded-xl overflow-hidden relative">
          <div className="p-3 border-b border-border bg-card flex justify-between items-center shrink-0">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Artwork Viewer
            </h3>
          </div>
          <div className="flex-1 relative overflow-auto p-4 flex items-center justify-center">
            {pkg.artworkUrl ? (
               <div className="relative max-w-full">
                 <img src={pkg.artworkUrl} alt={pkg.name} className="max-h-[600px] object-contain shadow-xl" />
                 {/* Render bounding boxes if we had actual pixel dimensions, 
                     for now we simulate the CSS overlay idea */}
                 {pkg.violations.map((v, i) => v.bbox && (
                   <div 
                     key={i} 
                     className={`hotspot-box hotspot-${v.severity}`}
                     style={{
                       left: `${v.bbox.x * 100}%`,
                       top: `${v.bbox.y * 100}%`,
                       width: `${v.bbox.w * 100}%`,
                       height: `${v.bbox.h * 100}%`
                     }}
                     title={v.title}
                   />
                 ))}
               </div>
            ) : (
              <div className="text-center text-muted-foreground p-12">
                 <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
                 <p>No visual artwork provided.</p>
                 <p className="text-sm mt-1">Analysis performed on extracted text only.</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Compliance Intelligence */}
        <div className="w-1/2 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
          <Tabs defaultValue="violations" className="flex-1 flex flex-col">
            <div className="px-4 pt-3 border-b border-border bg-muted/20 shrink-0">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Grade</p>
                    <div className={`text-4xl font-black mt-1 ${pkg.grade === 'A' || pkg.grade === 'B' ? 'text-success' : pkg.grade === 'F' ? 'text-destructive' : 'text-warning'}`}>
                      {pkg.grade || '-'}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Risk Score</p>
                    <div className="text-3xl font-mono mt-1 font-bold">{pkg.riskScore || 0}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="text-center px-3 py-1 bg-destructive/10 rounded-md border border-destructive/20">
                    <div className="text-lg font-bold text-destructive">{pkg.criticalCount}</div>
                    <div className="text-[10px] text-destructive uppercase">Critical</div>
                  </div>
                  <div className="text-center px-3 py-1 bg-warning/10 rounded-md border border-warning/20">
                    <div className="text-lg font-bold text-warning">{pkg.majorCount}</div>
                    <div className="text-[10px] text-warning uppercase">Major</div>
                  </div>
                </div>
              </div>

              <TabsList className="w-full justify-start rounded-none border-b-0 h-auto p-0 bg-transparent gap-6">
                <TabsTrigger value="violations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-2 px-1">Violations</TabsTrigger>
                <TabsTrigger value="ocr" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-2 px-1">Extracted Data</TabsTrigger>
                <TabsTrigger value="copilot" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-2 px-1">AI Copilot</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto p-0">
              <TabsContent value="violations" className="m-0 p-4 space-y-6">
                {pkg.violations?.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle className="w-12 h-12 mx-auto mb-3 text-success opacity-50" />
                    <p>No violations detected.</p>
                  </div>
                ) : (
                  <>
                    {/* Critical */}
                    {criticalViolations.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="flex items-center gap-2 font-bold text-destructive">
                          <ShieldAlert className="w-4 h-4" /> Critical Risks
                        </h4>
                        {criticalViolations.map(v => (
                          <div key={v.id} className="p-4 rounded-lg border border-destructive/30 bg-destructive/5 space-y-2">
                            <div className="flex justify-between items-start">
                              <h5 className="font-semibold text-sm">{v.title}</h5>
                              <Badge variant="outline" className="text-[10px]">{v.engine}</Badge>
                            </div>
                            <p className="text-sm text-foreground/80">{v.description}</p>
                            {v.recommendation && (
                              <div className="mt-2 p-2 bg-background rounded border border-border text-sm">
                                <span className="font-semibold text-xs uppercase text-muted-foreground block mb-1">Fix:</span>
                                {v.recommendation}
                              </div>
                            )}
                            {v.regulationRef && <div className="text-xs font-mono text-muted-foreground mt-2">Ref: {v.regulationRef}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Major */}
                    {majorViolations.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="flex items-center gap-2 font-bold text-warning">
                          <AlertTriangle className="w-4 h-4" /> Major Issues
                        </h4>
                        {majorViolations.map(v => (
                          <div key={v.id} className="p-4 rounded-lg border border-warning/30 bg-warning/5 space-y-2">
                            <div className="flex justify-between items-start">
                              <h5 className="font-semibold text-sm">{v.title}</h5>
                              <Badge variant="outline" className="text-[10px]">{v.engine}</Badge>
                            </div>
                            <p className="text-sm text-foreground/80">{v.description}</p>
                            {v.suggestedText && (
                              <div className="mt-2 p-2 bg-background rounded border border-border text-sm font-mono">
                                <span className="text-destructive line-through mr-2">{v.detectedText}</span>
                                <span className="text-success">{v.suggestedText}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Minor / Info */}
                    {otherViolations.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="flex items-center gap-2 font-bold text-muted-foreground">
                          <Info className="w-4 h-4" /> Minor & Info
                        </h4>
                        {otherViolations.map(v => (
                          <div key={v.id} className="p-3 rounded-lg border border-border bg-card space-y-1">
                            <h5 className="font-medium text-sm">{v.title}</h5>
                            <p className="text-xs text-muted-foreground">{v.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="ocr" className="m-0 p-4 space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                   {pkg.ocr && Object.entries(pkg.ocr).map(([key, val]) => {
                     if (!val) return null;
                     return (
                       <div key={key} className="p-3 bg-accent/50 rounded-lg border border-border">
                         <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                         <span className="text-sm break-words">{Array.isArray(val) ? val.join(', ') : String(val)}</span>
                       </div>
                     )
                   })}
                 </div>
              </TabsContent>

              <TabsContent value="copilot" className="m-0 p-4 h-full flex flex-col">
                <div className="flex-1 bg-accent/30 rounded-lg border border-border p-4 mb-4 overflow-y-auto">
                   <div className="flex items-start gap-3 mb-4">
                     <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                       <BrainCircuit className="w-4 h-4 text-primary" />
                     </div>
                     <div className="bg-card border border-border p-3 rounded-lg text-sm">
                       I've analyzed this package. It has a {pkg.grade} grade due to {pkg.criticalCount} critical issues. Ask me how to fix them or about specific regulations.
                     </div>
                   </div>
                </div>
                <div className="relative shrink-0">
                  <Input placeholder="Ask compliance copilot..." className="pr-10 bg-card" />
                  <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-primary">
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
