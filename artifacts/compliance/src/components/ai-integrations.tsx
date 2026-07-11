import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListAiProviders,
  useCreateAiProvider,
  useUpdateAiProvider,
  useDeleteAiProvider,
  useActivateAiProvider,
  useTestAiProvider,
  getListAiProvidersQueryKey,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Sparkles, Plus, Plug, CheckCircle2, XCircle, CircleDashed, Trash2, Loader2, KeyRound, Star,
} from "lucide-react"

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; modelHint: string }> = {
  openai: { label: "OpenAI", baseUrl: "", modelHint: "e.g. gpt-4o, gpt-4.1" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", modelHint: "e.g. anthropic/claude-3.5-sonnet, google/gemini-pro-1.5" },
  custom: { label: "Custom (OpenAI-compatible)", baseUrl: "", modelHint: "model id exposed by your endpoint" },
}

type ProviderForm = {
  name: string
  providerType: string
  model: string
  baseUrl: string
  apiKey: string
}

const EMPTY_FORM: ProviderForm = { name: "", providerType: "openrouter", model: "", baseUrl: PROVIDER_PRESETS.openrouter.baseUrl, apiKey: "" }

function StatusBadge({ status }: { status: string }) {
  if (status === "connected")
    return <Badge className="bg-success/10 text-success hover:bg-success/20 gap-1"><CheckCircle2 className="w-3 h-3" />Connected</Badge>
  if (status === "error")
    return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Error</Badge>
  return <Badge variant="secondary" className="gap-1"><CircleDashed className="w-3 h-3" />Not tested</Badge>
}

export function AiIntegrations() {
  const queryClient = useQueryClient()
  const { data: providers = [], isLoading } = useListAiProviders()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAiProvidersQueryKey() })

  const createMut = useCreateAiProvider({ mutation: { onSuccess: invalidate } })
  const updateMut = useUpdateAiProvider({ mutation: { onSuccess: invalidate } })
  const deleteMut = useDeleteAiProvider({ mutation: { onSuccess: invalidate } })
  const activateMut = useActivateAiProvider({ mutation: { onSuccess: invalidate } })
  const testMut = useTestAiProvider({ mutation: { onSuccess: invalidate } })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [form, setForm] = React.useState<ProviderForm>(EMPTY_FORM)
  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [testingId, setTestingId] = React.useState<number | null>(null)

  const openAdd = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (p: (typeof providers)[number]) => {
    setEditingId(p.id)
    setForm({
      name: p.name,
      providerType: p.providerType,
      model: p.model,
      baseUrl: p.baseUrl ?? "",
      apiKey: "",
    })
    setDialogOpen(true)
  }

  const onProviderTypeChange = (v: string) => {
    setForm((f) => ({
      ...f,
      providerType: v,
      baseUrl: editingId ? f.baseUrl : (PROVIDER_PRESETS[v]?.baseUrl ?? ""),
    }))
  }

  const submit = () => {
    if (editingId) {
      updateMut.mutate(
        { id: editingId, data: { name: form.name, model: form.model, baseUrl: form.baseUrl || undefined, apiKey: form.apiKey || undefined } },
        { onSuccess: () => setDialogOpen(false) },
      )
    } else {
      createMut.mutate(
        { data: { name: form.name, providerType: form.providerType, model: form.model, baseUrl: form.baseUrl || undefined, apiKey: form.apiKey || undefined } },
        { onSuccess: () => setDialogOpen(false) },
      )
    }
  }

  const runTest = (id: number) => {
    setTestingId(id)
    testMut.mutate({ id }, { onSettled: () => setTestingId(null) })
  }

  const formValid = form.name.trim().length > 0 && form.model.trim().length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">AI Integrations</h2>
            <p className="text-sm text-muted-foreground">Connect the AI models that power compliance analysis. The active model runs every review.</p>
          </div>
        </div>
        <Button onClick={openAdd} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" /> Add Model Provider
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading providers...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {providers.map((p) => (
            <Card key={p.id} className={p.active ? "border-primary/50 ring-1 ring-primary/20" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Plug className="w-4 h-4 text-primary shrink-0" />
                      <span className="truncate">{p.name}</span>
                    </CardTitle>
                    <CardDescription className="mt-1 font-mono text-xs">{p.model}</CardDescription>
                  </div>
                  {p.active && (
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/20 gap-1 shrink-0">
                      <Star className="w-3 h-3" /> Active
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="capitalize">{PROVIDER_PRESETS[p.providerType]?.label ?? p.providerType}</Badge>
                  <StatusBadge status={p.status} />
                  {p.managed ? (
                    <Badge variant="outline" className="gap-1 text-muted-foreground"><KeyRound className="w-3 h-3" /> Managed key</Badge>
                  ) : p.hasKey ? (
                    <Badge variant="outline" className="gap-1 font-mono text-muted-foreground"><KeyRound className="w-3 h-3" /> ••••{p.keyLast4}</Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-destructive"><KeyRound className="w-3 h-3" /> No key</Badge>
                  )}
                </div>
                {p.status === "error" && p.statusMessage && (
                  <p className="text-xs text-destructive break-words">{p.statusMessage}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {!p.active && (
                    <Button size="sm" variant="default" onClick={() => activateMut.mutate({ id: p.id })} disabled={activateMut.isPending}>
                      Set Active
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => runTest(p.id)} disabled={testingId === p.id}>
                    {testingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
                    Test
                  </Button>
                  {!p.managed && (
                    <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>Edit</Button>
                  )}
                  {!p.managed && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive gap-1.5">
                          <Trash2 className="w-3.5 h-3.5" /> Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {p.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This provider will be deleted. If it is the active model, analysis falls back to the managed OpenAI provider.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMut.mutate({ id: p.id })} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Provider" : "Add Model Provider"}</DialogTitle>
            <DialogDescription>
              Connect an OpenAI, OpenRouter, or any OpenAI-compatible endpoint. OpenRouter unlocks Anthropic Claude, Google Gemini, Llama, and more.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prov-name">Display name</Label>
              <Input id="prov-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Claude 3.5 Sonnet" />
            </div>
            {!editingId && (
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select value={form.providerType} onValueChange={onProviderTypeChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROVIDER_PRESETS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="prov-model">Model ID</Label>
              <Input id="prov-model" className="font-mono text-sm" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={PROVIDER_PRESETS[form.providerType]?.modelHint} />
            </div>
            {form.providerType !== "openai" && (
              <div className="space-y-1.5">
                <Label htmlFor="prov-base">Base URL</Label>
                <Input id="prov-base" className="font-mono text-sm" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://openrouter.ai/api/v1" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="prov-key">API key {editingId && <span className="text-muted-foreground font-normal">(leave blank to keep current)</span>}</Label>
              <Input id="prov-key" type="password" className="font-mono text-sm" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." />
              <p className="text-xs text-muted-foreground">Keys are stored securely on the server and never displayed again.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!formValid || createMut.isPending || updateMut.isPending}>
              {(createMut.isPending || updateMut.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Save Changes" : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
