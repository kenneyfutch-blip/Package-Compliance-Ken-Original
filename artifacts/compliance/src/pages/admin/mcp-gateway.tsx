import { useState } from "react"
import {
  useListMcpTokens,
  useCreateMcpToken,
  useRevokeMcpToken,
  useListMcpToolCalls,
  getListMcpTokensQueryKey,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import {
  Loader2, KeyRound, Plus, Copy, Check, ShieldCheck, Ban, Bot, Plug2, ScrollText,
} from "lucide-react"

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—"
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString()
}

// Admin surface for the MCP (Model Context Protocol) gateway: personal access
// tokens for external AI agents, plus the org-wide AI tool-call audit ledger
// covering BOTH the external gateway and the in-app AI Workspace.
export default function McpGateway() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: tokens = [], isLoading: tokensLoading } = useListMcpTokens()
  const { data: calls = [], isLoading: callsLoading } = useListMcpToolCalls({ limit: 50 })

  const [createOpen, setCreateOpen] = useState(false)
  const [tokenName, setTokenName] = useState("")
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const invalidateTokens = () =>
    queryClient.invalidateQueries({ queryKey: getListMcpTokensQueryKey() })

  const createToken = useCreateMcpToken({
    mutation: {
      onSuccess: (created) => {
        setNewToken(created.token)
        setTokenName("")
        invalidateTokens()
      },
      onError: () =>
        toast({ title: "Could not create token", description: "Please try again.", variant: "destructive" }),
    },
  })
  const revokeToken = useRevokeMcpToken({
    mutation: {
      onSuccess: () => {
        toast({ title: "Token revoked", description: "The credential stops working immediately." })
        invalidateTokens()
      },
      onError: () =>
        toast({ title: "Could not revoke token", variant: "destructive" }),
    },
  })

  const copyToken = async () => {
    if (!newToken) return
    try {
      await navigator.clipboard.writeText(newToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: "Copy failed", description: "Select and copy the token manually.", variant: "destructive" })
    }
  }

  const closeCreate = () => {
    setCreateOpen(false)
    setNewToken(null)
    setCopied(false)
    setTokenName("")
  }

  const activeTokens = tokens.filter((t) => !t.revokedAt)

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Plug2 className="w-7 h-7 text-primary" /> AI Gateway (MCP)
        </h1>
        <p className="text-muted-foreground mt-1">
          Secure gateway for external AI agents. Every connection acts as a specific user and
          inherits that user's permissions and organization scope. Reads run directly; any
          state-changing action requires explicit human confirmation first.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-success" />
            <div>
              <div className="font-semibold">Confirmed actions only</div>
              <div className="text-sm text-muted-foreground">Reads run freely; any change (task, comment, assignment, report) requires explicit human confirmation. No deletes, secrets, or configuration.</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <KeyRound className="w-8 h-8 text-primary" />
            <div>
              <div className="font-semibold">Per-user tokens</div>
              <div className="text-sm text-muted-foreground">Tokens act as you — same permissions, same tenant scope, instantly revocable.</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <ScrollText className="w-8 h-8 text-warning" />
            <div>
              <div className="font-semibold">Fully audited</div>
              <div className="text-sm text-muted-foreground">Every tool call is logged: who, what, inputs, and outcome.</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Your access tokens
            </CardTitle>
            <CardDescription>
              Connect Claude Desktop or other MCP clients to <code className="text-xs">/api/mcp</code> with a Bearer token.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-mcp-token">
            <Plus className="w-4 h-4 mr-1.5" /> New token
          </Button>
        </CardHeader>
        <CardContent>
          {tokensLoading ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : tokens.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
              No tokens yet. Create one to connect an external AI agent.
            </div>
          ) : (
            <div className="divide-y">
              {tokens.map((t) => (
                <div key={t.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {t.name}
                      {t.revokedAt ? (
                        <Badge variant="outline" className="border-destructive text-destructive">Revoked</Badge>
                      ) : (
                        <Badge variant="outline" className="border-success text-success bg-success/10">Active</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground font-mono">
                      {t.tokenPrefix}…
                      <span className="font-sans ml-3">Created {fmt(t.createdAt)}</span>
                      <span className="font-sans ml-3">Last used {fmt(t.lastUsedAt)}</span>
                    </div>
                  </div>
                  {!t.revokedAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revokeToken.isPending}
                      onClick={() => revokeToken.mutate({ id: t.id })}
                      data-testid={`button-revoke-token-${t.id}`}
                    >
                      <Ban className="w-4 h-4 mr-1.5" /> Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {activeTokens.length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {activeTokens.length} active token{activeTokens.length === 1 ? "" : "s"}. Revocation takes effect immediately.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" /> AI tool-call ledger
          </CardTitle>
          <CardDescription>
            Every tool invocation by AI — external MCP clients and the in-app AI Workspace — recorded with user, tool, inputs, and outcome.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {callsLoading ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : calls.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
              No AI tool calls recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">User</th>
                    <th className="py-2 pr-4 font-medium">Source</th>
                    <th className="py-2 pr-4 font-medium">Tool</th>
                    <th className="py-2 pr-4 font-medium">Outcome</th>
                    <th className="py-2 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{fmt(c.createdAt)}</td>
                      <td className="py-2 pr-4">{c.userName}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline" className={c.source === "mcp" ? "border-primary text-primary" : ""}>
                          {c.source === "mcp" ? "MCP gateway" : "AI Workspace"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{c.tool}</td>
                      <td className="py-2 pr-4">
                        {!c.permissionOk ? (
                          <Badge variant="outline" className="border-destructive text-destructive">Denied</Badge>
                        ) : c.success ? (
                          <Badge variant="outline" className="border-success text-success bg-success/10">OK</Badge>
                        ) : (
                          <Badge variant="outline" className="border-warning text-warning">Failed</Badge>
                        )}
                      </td>
                      <td className="py-2 text-muted-foreground">{c.durationMs != null ? `${c.durationMs} ms` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeCreate() }}>
        <DialogContent>
          {newToken ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your token now</DialogTitle>
                <DialogDescription>
                  This is the only time the full token is shown. Only a fingerprint is stored on the server.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs break-all select-all" data-testid="text-new-mcp-token">
                  {newToken}
                </code>
                <Button variant="outline" size="icon" onClick={copyToken} data-testid="button-copy-mcp-token">
                  {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={closeCreate}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>New MCP access token</DialogTitle>
                <DialogDescription>
                  Name it after the client that will use it (e.g. "Claude Desktop").
                </DialogDescription>
              </DialogHeader>
              <Input
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Token name"
                maxLength={100}
                data-testid="input-mcp-token-name"
              />
              <DialogFooter>
                <Button variant="outline" onClick={closeCreate}>Cancel</Button>
                <Button
                  disabled={!tokenName.trim() || createToken.isPending}
                  onClick={() => createToken.mutate({ data: { name: tokenName.trim() } })}
                  data-testid="button-confirm-create-token"
                >
                  {createToken.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                  Create token
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
