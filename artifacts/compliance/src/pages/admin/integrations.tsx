import { 
  useListAiProviders, 
  useGetDocumentAiStatus, 
  useGetFdaStatus,
  useGetEcfrStatus,
  useSyncEcfr,
  getGetEcfrStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Cpu, FileText, Activity, Server, AlertTriangle, CheckCircle2, ShieldCheck, Landmark, RefreshCw } from "lucide-react";

function StatusBadge({ active, text }: { active?: boolean, text?: string }) {
  if (active) {
    return <Badge variant="outline" className="border-success text-success bg-success/10 px-2 py-0.5"><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> {text || "Active"}</Badge>;
  }
  return <Badge variant="outline" className="border-warning text-warning bg-warning/10 px-2 py-0.5"><AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> {text || "Inactive"}</Badge>;
}

export default function Integrations() {
  const { data: providers, isLoading: providersLoading } = useListAiProviders();
  const { data: docAi, isLoading: docAiLoading } = useGetDocumentAiStatus();
  const { data: fda, isLoading: fdaLoading } = useGetFdaStatus();
  const { data: ecfr, isLoading: ecfrLoading } = useGetEcfrStatus();
  const queryClient = useQueryClient();
  const syncEcfr = useSyncEcfr({
    mutation: {
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetEcfrStatusQueryKey() });
      },
    },
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Server className="w-7 h-7 text-primary" /> External Integrations
        </h1>
        <p className="text-muted-foreground mt-1">Status of connected AI, Document Intelligence, and Live Data feeds.</p>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Cpu className="w-5 h-5 text-primary" /> AI Providers</CardTitle>
            <CardDescription>Configured language models for compliance analysis.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {providersLoading ? (
              <div className="col-span-full py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : providers?.length === 0 ? (
              <div className="col-span-full py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">No AI providers configured.</div>
            ) : providers?.map(p => (
              <div key={p.id} className="border rounded-xl p-5 space-y-4 bg-card hover:border-primary/50 transition-colors shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-lg text-foreground">{p.name}</div>
                    <div className="text-sm text-muted-foreground font-mono mt-0.5">{p.model}</div>
                  </div>
                  <StatusBadge active={p.active} />
                </div>
                <div className="text-sm space-y-2 pt-2 border-t border-border/50">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Type</span>
                    <span className="capitalize font-medium">{p.providerType}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">API Key</span>
                    <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">{p.hasKey ? "••••" + (p.keyLast4 || "") : "Missing"}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Document AI</CardTitle>
            <CardDescription>OCR and layout extraction engine.</CardDescription>
          </CardHeader>
          <CardContent>
            {docAiLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : !docAi ? (
              <div className="py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">Document AI status unavailable.</div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between pb-4 border-b border-border/50">
                  <div className="font-semibold text-lg text-foreground">Status</div>
                  <StatusBadge active={docAi.configured} text={docAi.configured ? "Configured" : "Not Configured"} />
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center bg-muted/30 p-2.5 rounded-md">
                    <span className="text-muted-foreground">Engine</span>
                    <span className="font-bold uppercase tracking-wider text-primary">{docAi.engine}</span>
                  </div>
                  {docAi.processorType && (
                    <div className="flex justify-between items-center px-2.5">
                      <span className="text-muted-foreground">Processor Type</span>
                      <span className="font-mono">{docAi.processorType}</span>
                    </div>
                  )}
                  {docAi.location && (
                    <div className="flex justify-between items-center px-2.5">
                      <span className="text-muted-foreground">Region</span>
                      <span className="font-medium">{docAi.location}</span>
                    </div>
                  )}
                  
                  <div className="mt-6 pt-4 border-t border-border/50">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Service Checks</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2 bg-muted/40 p-2 rounded-md">
                        {docAi.projectConfigured ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertTriangle className="w-4 h-4 text-warning" />}
                        <span className="font-medium text-xs">Project Config</span>
                      </div>
                      <div className="flex items-center gap-2 bg-muted/40 p-2 rounded-md">
                        {docAi.processorConfigured ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertTriangle className="w-4 h-4 text-warning" />}
                        <span className="font-medium text-xs">Processor Link</span>
                      </div>
                      <div className="flex items-center gap-2 bg-muted/40 p-2 rounded-md">
                        {docAi.serviceAccountConfigured ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertTriangle className="w-4 h-4 text-warning" />}
                        <span className="font-medium text-xs">Service Auth</span>
                      </div>
                      <div className="flex items-center gap-2 bg-muted/40 p-2 rounded-md">
                        {docAi.locationConfigured ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertTriangle className="w-4 h-4 text-warning" />}
                        <span className="font-medium text-xs">Location Sync</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> Live FDA Intelligence</CardTitle>
            <CardDescription>Real-time regulatory recalls and guidance.</CardDescription>
          </CardHeader>
          <CardContent>
            {fdaLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : !fda ? (
              <div className="py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">FDA Integration status unavailable.</div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between pb-4 border-b border-border/50">
                  <div className="font-semibold text-lg text-foreground">Connection</div>
                  <div className="flex items-center gap-2">
                    <StatusBadge active={fda.configured} text={fda.configured ? "Configured" : "Unconfigured"} />
                    <StatusBadge active={fda.reachable} text={fda.reachable ? "Reachable" : "Unreachable"} />
                  </div>
                </div>
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between items-center px-2.5">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Activity className="w-4 h-4" /> Last Checked</span>
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{fda.checkedAt ? new Date(fda.checkedAt).toLocaleString() : "Never"}</span>
                  </div>
                  <div className="flex justify-between items-center px-2.5">
                    <span className="text-muted-foreground flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Catalog Entries</span>
                    <span className="font-bold text-lg">{fda.catalog?.length || 0}</span>
                  </div>
                  <div className="p-4 bg-muted/40 border border-border/50 rounded-lg mt-4">
                    <div className="text-xs text-muted-foreground leading-relaxed italic">{fda.disclaimer}</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Landmark className="w-5 h-5 text-primary" /> eCFR Regulatory Data</CardTitle>
            <CardDescription>Synced federal regulation text (Title 21 FDA / Title 40 EPA).</CardDescription>
          </CardHeader>
          <CardContent>
            {ecfrLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : !ecfr ? (
              <div className="py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">eCFR status unavailable.</div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between pb-4 border-b border-border/50">
                  <div className="font-semibold text-lg text-foreground">Status</div>
                  <div className="flex items-center gap-2">
                    <StatusBadge active={ecfr.synced} text={ecfr.synced ? "Synced" : "Not Synced"} />
                    <StatusBadge active={ecfr.reachable} text={ecfr.reachable ? "Reachable" : "Unreachable"} />
                  </div>
                </div>
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between items-center px-2.5">
                    <span className="text-muted-foreground flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Sections Synced</span>
                    <span className="font-bold text-lg">{ecfr.totalSections}</span>
                  </div>
                  {ecfr.countsByTitle.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-2.5">
                      {ecfr.countsByTitle.map((c) => (
                        <Badge key={c.title} variant="outline" className="font-normal">Title {c.title}: {c.sections}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between items-center px-2.5">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Activity className="w-4 h-4" /> Last Synced</span>
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{ecfr.lastSyncedAt ? new Date(ecfr.lastSyncedAt).toLocaleString() : "Never"}</span>
                  </div>
                  <div className="flex justify-between items-center px-2.5">
                    <span className="text-muted-foreground flex items-center gap-1.5"><FileText className="w-4 h-4" /> Edition Date</span>
                    <span className="font-mono text-xs">{ecfr.editionDate || "—"}</span>
                  </div>
                  <div className="flex justify-between items-center px-2.5">
                    <span className="text-muted-foreground flex items-center gap-1.5"><Landmark className="w-4 h-4" /> Curated Parts</span>
                    <span className="font-bold">{ecfr.curatedParts.length}</span>
                  </div>
                  <div className="pt-3 border-t border-border/50">
                    <Button
                      size="sm"
                      onClick={() => syncEcfr.mutate()}
                      disabled={syncEcfr.isPending}
                      className="w-full"
                    >
                      {syncEcfr.isPending ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Syncing…</>
                      ) : (
                        <><RefreshCw className="w-4 h-4 mr-2" /> Sync now</>
                      )}
                    </Button>
                    {syncEcfr.isError && (
                      <p className="text-xs text-destructive mt-2 text-center">Sync failed. Check permissions and try again.</p>
                    )}
                    {syncEcfr.isSuccess && syncEcfr.data && (
                      <p className="text-xs text-success mt-2 text-center">Synced {syncEcfr.data.sectionsStored} sections across {syncEcfr.data.partsSynced} parts.</p>
                    )}
                  </div>
                  <div className="p-4 bg-muted/40 border border-border/50 rounded-lg mt-2">
                    <div className="text-xs text-muted-foreground leading-relaxed italic">{ecfr.disclaimer}</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
