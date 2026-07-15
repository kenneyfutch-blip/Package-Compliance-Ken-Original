import * as React from "react"
import { useLocation, useParams } from "wouter"
import {
  useListWorkspaceConversations,
  useListWorkspaceSpecialists,
  useCreateWorkspaceConversation,
  useGetWorkspaceConversation,
  useUpdateWorkspaceConversation,
  useDeleteWorkspaceConversation,
  useAssistantExtract,
  getListWorkspaceConversationsQueryKey,
  getGetWorkspaceConversationQueryKey,
} from "@workspace/api-client-react"
import type {
  WorkspaceConversation,
  WorkspaceMessage,
  WorkspaceSpecialist,
  AssistantToolSuggestion,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { usePageContext } from "@/lib/workspace-context"
import {
  streamWorkspaceMessage,
  type WorkspaceCitation,
  type WorkspaceAttachmentPayload,
} from "@/lib/workspace-stream"
import {
  extractAttachmentText,
  ATTACHMENT_ACCEPT,
  type RunOcr,
} from "@/lib/attachment-extract"
import {
  Sparkles,
  Plus,
  Search,
  Star,
  ArrowUp,
  Maximize2,
  Minimize2,
  Columns2,
  X,
  ArrowRight,
  Trash2,
  MessageSquare,
  Loader2,
  FileText,
  Paperclip,
  Link2,
} from "lucide-react"

// A locally-tracked message (persisted messages plus the in-flight streaming
// assistant turn, which has no id yet).
type LocalMessage = {
  id?: number
  role: "user" | "assistant"
  content: string
  suggestions?: AssistantToolSuggestion[] | null
  citations?: WorkspaceCitation[] | null
  attachmentNames?: string[] | null
  // Transient tool-activity label shown while the turn is still streaming.
  status?: string | null
  streaming?: boolean
}

// A staged attachment (already extracted to text) awaiting the next send.
type StagedAttachment = { name: string; text: string }

type ViewMode = "chat" | "fullscreen" | "split"

// Handoff payload written by the assistant panel's "Launch Workspace" action.
const HANDOFF_KEY = "ai-workspace-handoff"

export default function AiWorkspacePage() {
  const params = useParams()
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const pageContext = usePageContext()

  const routeId = params.id ? Number(params.id) : null
  const [activeId, setActiveId] = React.useState<number | null>(routeId)
  const [mode, setMode] = React.useState<ViewMode>("chat")
  const [search, setSearch] = React.useState("")
  const [favoritesOnly, setFavoritesOnly] = React.useState(false)
  const [specialist, setSpecialist] = React.useState<string>("general")
  const [input, setInput] = React.useState("")
  const [liveMessages, setLiveMessages] = React.useState<LocalMessage[]>([])
  const [streaming, setStreaming] = React.useState(false)
  const [streamError, setStreamError] = React.useState<string | null>(null)
  const [attachments, setAttachments] = React.useState<StagedAttachment[]>([])
  const [attaching, setAttaching] = React.useState(false)
  const [attachError, setAttachError] = React.useState<string | null>(null)
  const abortRef = React.useRef<null | (() => void)>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const extract = useAssistantExtract()

  // Reuse the shared attachment pipeline: text/PDF are read client-side, images
  // are OCR'd server-side via the assistant extract endpoint.
  const runOcr: RunOcr = React.useCallback(
    async (imageDataUrl: string) => {
      const r = await extract.mutateAsync({ data: { imageDataUrl } })
      return r.text ?? ""
    },
    [extract],
  )

  const onSelectFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      setAttachError(null)
      setAttaching(true)
      try {
        for (const file of Array.from(files)) {
          try {
            const text = await extractAttachmentText(file, runOcr)
            setAttachments((prev) => [...prev, { name: file.name, text }])
          } catch (err) {
            setAttachError(
              err instanceof Error ? err.message : `Couldn't read ${file.name}.`,
            )
          }
        }
      } finally {
        setAttaching(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    },
    [runOcr],
  )

  const specialistsQuery = useListWorkspaceSpecialists()
  const specialists: WorkspaceSpecialist[] =
    specialistsQuery.data?.specialists ?? []
  const activeSpecialist =
    specialists.find((s) => s.key === specialist) ?? specialists[0] ?? null

  const listQuery = useListWorkspaceConversations({
    q: search || undefined,
    favorite: favoritesOnly || undefined,
  })
  const conversations: WorkspaceConversation[] =
    listQuery.data?.conversations ?? []

  const detailQuery = useGetWorkspaceConversation(activeId ?? 0, {
    query: {
      enabled: activeId != null,
      queryKey: getGetWorkspaceConversationQueryKey(activeId ?? 0),
    },
  })
  const detail = detailQuery.data

  const createMut = useCreateWorkspaceConversation()
  const updateMut = useUpdateWorkspaceConversation()
  const deleteMut = useDeleteWorkspaceConversation()

  // Sync route param → active conversation.
  React.useEffect(() => {
    if (routeId && routeId !== activeId) setActiveId(routeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  // When a conversation loads, hydrate local messages and adopt its specialist.
  React.useEffect(() => {
    if (detail) {
      setLiveMessages(
        (detail.messages ?? []).map((m: WorkspaceMessage) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          suggestions: (m.suggestions as AssistantToolSuggestion[] | null) ?? null,
          citations:
            ((m as { citations?: WorkspaceCitation[] | null }).citations as
              | WorkspaceCitation[]
              | null) ?? null,
          attachmentNames: Array.isArray(
            (m as { attachments?: unknown }).attachments,
          )
            ? ((m as { attachments?: { name?: string }[] }).attachments ?? [])
                .map((a) => a?.name)
                .filter((n): n is string => typeof n === "string")
            : null,
        })),
      )
      setSpecialist(detail.specialist || "general")
    }
  }, [detail])

  // Keep pinned to the newest message.
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [liveMessages, streaming])

  // Handoff from the assistant panel: seed a fresh conversation with prior text.
  React.useEffect(() => {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    if (!raw) return
    sessionStorage.removeItem(HANDOFF_KEY)
    try {
      const parsed = JSON.parse(raw) as {
        messages?: { role: string; content: string }[]
      }
      if (parsed.messages && parsed.messages.length > 0) {
        void seedFromHandoff(parsed.messages)
      }
    } catch {
      /* ignore malformed handoff */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const invalidateList = React.useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: getListWorkspaceConversationsQueryKey(),
    })
  }, [queryClient])

  // Abort any in-flight stream and reset the UI. The stream helper deliberately
  // stays silent on abort (no onDone/onError), so the caller must clear the
  // streaming flag and drop/finalize the placeholder assistant turn itself —
  // otherwise the composer stays disabled and the page looks stuck.
  const stopStream = React.useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setStreaming(false)
    setLiveMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last && last.streaming) {
        if (!last.content) next.pop()
        else next[next.length - 1] = { ...last, streaming: false }
      }
      return next
    })
  }, [])

  const seedFromHandoff = async (
    prior: { role: string; content: string }[],
  ) => {
    // Create a conversation and PERSIST the prior transcript as real messages so
    // history survives refetch/refresh and the model sees the panel context on
    // the next turn (the stream endpoint rebuilds history from the DB).
    const conv = await createMut.mutateAsync({
      data: {
        specialist: "general",
        seedMessages: prior.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      },
    })
    setActiveId(conv.id)
    navigate(`/ai-workspace/${conv.id}`)
    // The detail query (enabled once activeId is set) hydrates liveMessages.
    invalidateList()
  }

  const startNew = async () => {
    stopStream()
    const conv = await createMut.mutateAsync({ data: { specialist } })
    setActiveId(conv.id)
    setLiveMessages([])
    setStreamError(null)
    navigate(`/ai-workspace/${conv.id}`)
    invalidateList()
  }

  const openConversation = (id: number) => {
    if (id === activeId) return
    stopStream()
    setActiveId(id)
    setStreamError(null)
    navigate(`/ai-workspace/${id}`)
  }

  const persistSpecialist = async (key: string) => {
    setSpecialist(key)
    if (activeId != null) {
      await updateMut.mutateAsync({ id: activeId, data: { specialist: key } })
      invalidateList()
    }
  }

  const toggleFavorite = async (conv: WorkspaceConversation) => {
    await updateMut.mutateAsync({
      id: conv.id,
      data: { favorite: !conv.favorite },
    })
    invalidateList()
  }

  const removeConversation = async (id: number) => {
    await deleteMut.mutateAsync({ id })
    if (activeId === id) {
      setActiveId(null)
      setLiveMessages([])
      navigate("/ai-workspace")
    }
    invalidateList()
  }

  const send = async (raw: string) => {
    const text = raw.trim()
    if ((!text && attachments.length === 0) || streaming || attaching) return

    // Ensure we have a conversation to stream into.
    let convId = activeId
    if (convId == null) {
      const conv = await createMut.mutateAsync({ data: { specialist } })
      convId = conv.id
      setActiveId(conv.id)
      navigate(`/ai-workspace/${conv.id}`)
      invalidateList()
    }

    const staged = attachments
    const attachmentPayload: WorkspaceAttachmentPayload[] = staged.map((a) => ({
      name: a.name,
      kind: "text",
      content: a.text,
    }))

    setInput("")
    setAttachments([])
    setAttachError(null)
    setStreamError(null)
    setLiveMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: text,
        attachmentNames: staged.length ? staged.map((a) => a.name) : null,
      },
      { role: "assistant", content: "", streaming: true },
    ])
    setStreaming(true)

    const ctxPayload = pageContext
      ? {
          path: pageContext.path ?? null,
          title: pageContext.title ?? null,
          summary: pageContext.summary ?? null,
        }
      : null

    abortRef.current = streamWorkspaceMessage(
      convId,
      {
        message: text,
        pageContext: ctxPayload,
        ...(attachmentPayload.length ? { attachments: attachmentPayload } : {}),
      },
      {
        onDelta: (delta) => {
          setLiveMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === "assistant" && last.streaming) {
              next[next.length - 1] = {
                ...last,
                content: last.content + delta,
                // First token arrived — clear the "searching…" status.
                status: null,
              }
            }
            return next
          })
        },
        onStatus: (info) => {
          setLiveMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === "assistant" && last.streaming) {
              next[next.length - 1] = { ...last, status: info.label }
            }
            return next
          })
        },
        onCitations: (citations) => {
          setLiveMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === "assistant" && last.streaming) {
              next[next.length - 1] = { ...last, citations }
            }
            return next
          })
        },
        onDone: () => {
          setStreaming(false)
          setLiveMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.streaming) {
              next[next.length - 1] = { ...last, streaming: false }
            }
            return next
          })
          // Refresh persisted messages + list ordering/title.
          if (convId != null) {
            void queryClient.invalidateQueries({
              queryKey: getGetWorkspaceConversationQueryKey(convId),
            })
          }
          invalidateList()
        },
        onError: (message) => {
          setStreaming(false)
          setStreamError(message)
          setLiveMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.streaming && !last.content) {
              next.pop()
            } else if (last && last.streaming) {
              next[next.length - 1] = { ...last, streaming: false }
            }
            return next
          })
        },
      },
    )
  }

  React.useEffect(() => () => abortRef.current?.(), [])

  const goTo = (href: string) => navigate(href)

  const linkedLabel = detail?.linkedRecordLabel ?? null
  const hasContext = Boolean(linkedLabel || pageContext?.title || pageContext?.summary)

  const isOverlay = mode === "fullscreen" || mode === "split"

  const body = (
    <div
      className={cn(
        "flex overflow-hidden rounded-xl border bg-card",
        isOverlay ? "fixed inset-0 z-50 rounded-none border-0" : "h-[calc(100vh-9rem)]",
      )}
    >
      {/* Conversation history sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-muted/30 md:flex">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">AI Workspace</span>
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={startNew}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
        <div className="space-y-2 border-b p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => setFavoritesOnly((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
              favoritesOnly
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Star className={cn("h-3.5 w-3.5", favoritesOnly && "fill-primary")} />
            Favorites
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {listQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No conversations yet.
            </p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-2 text-sm transition-colors",
                  c.id === activeId
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted",
                )}
              >
                <button
                  type="button"
                  onClick={() => openConversation(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{c.title}</span>
                </button>
                <button
                  type="button"
                  aria-label="Toggle favorite"
                  onClick={() => toggleFavorite(c)}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                >
                  <Star className={cn("h-3.5 w-3.5", c.favorite && "fill-primary text-primary opacity-100")} />
                </button>
                <button
                  type="button"
                  aria-label="Delete conversation"
                  onClick={() => removeConversation(c.id)}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Split-screen context pane */}
      {mode === "split" && (
        <section className="hidden w-96 shrink-0 flex-col border-r bg-background lg:flex">
          <div className="flex items-center gap-2 border-b p-3">
            <FileText className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Context</span>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
            {linkedLabel && (
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Linked record
                </p>
                <p className="mt-1">{linkedLabel}</p>
              </div>
            )}
            {pageContext?.title && (
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Currently viewing
                </p>
                <p className="mt-1 font-medium">{pageContext.title}</p>
                {pageContext.path && (
                  <button
                    type="button"
                    onClick={() => goTo(pageContext.path!)}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            {pageContext?.summary && (
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Summary
                </p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {pageContext.summary}
                </p>
              </div>
            )}
            {!hasContext && (
              <p className="text-muted-foreground">
                Open a package, report, or task and the workspace will show its
                details here for context-aware answers.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Main chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar: specialist switcher + mode controls */}
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            {specialists.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => persistSpecialist(s.key)}
                title={s.description}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  s.key === specialist
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon"
              variant={mode === "split" ? "secondary" : "ghost"}
              className="h-8 w-8"
              title="Split screen"
              onClick={() => setMode((m) => (m === "split" ? "chat" : "split"))}
            >
              <Columns2 className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title={mode === "fullscreen" ? "Exit full screen" : "Full screen"}
              onClick={() =>
                setMode((m) => (m === "fullscreen" ? "chat" : "fullscreen"))
              }
            >
              {mode === "fullscreen" ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            {isOverlay && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                title="Close overlay"
                onClick={() => setMode("chat")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          {liveMessages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col justify-center">
              <h2 className="text-2xl font-semibold">
                {activeSpecialist?.label ?? "AI Workspace"}
              </h2>
              <p className="mt-1 text-muted-foreground">
                {activeSpecialist?.description ??
                  "Ask a compliance question or describe what you're trying to do."}
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {(activeSpecialist?.suggestedPrompts ?? []).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => send(p)}
                    className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3.5 py-2.5 text-left text-sm hover:bg-muted transition-colors"
                  >
                    <span>{p}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {liveMessages.map((m, i) => (
                <div
                  key={m.id ?? `live-${i}`}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                      m.role === "user"
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm bg-muted text-foreground",
                    )}
                  >
                    {m.attachmentNames && m.attachmentNames.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {m.attachmentNames.map((n, j) => (
                          <span
                            key={`${n}-${j}`}
                            className="flex items-center gap-1 rounded-md bg-black/10 px-1.5 py-0.5 text-xs"
                          >
                            <FileText className="h-3 w-3" />
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.streaming && m.status && !m.content && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {m.status}…
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">
                      {m.content}
                      {m.streaming && !m.content && !m.status && (
                        <Loader2 className="inline h-4 w-4 animate-spin" />
                      )}
                      {m.streaming && m.content && (
                        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-current align-middle" />
                      )}
                    </p>
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-3 border-t border-border/60 pt-2">
                        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                          Sources
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {m.citations.map((c, j) => {
                            const key = `${c.type}-${c.id}-${j}`
                            const content = (
                              <>
                                <Link2 className="h-3 w-3 shrink-0" />
                                <span className="truncate">{c.label}</span>
                              </>
                            )
                            return c.href ? (
                              <button
                                key={key}
                                type="button"
                                onClick={() => goTo(c.href as string)}
                                className="flex max-w-full items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
                              >
                                {content}
                              </button>
                            ) : (
                              <span
                                key={key}
                                className="flex max-w-full items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs text-muted-foreground"
                              >
                                {content}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {m.suggestions && m.suggestions.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {m.suggestions.map((s) => (
                          <button
                            key={s.href}
                            type="button"
                            onClick={() => goTo(s.href)}
                            className="flex w-full flex-col gap-0.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left hover:bg-primary/10 transition-colors"
                          >
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                              {s.label}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </span>
                            {s.reason && (
                              <span className="text-xs text-muted-foreground">
                                {s.reason}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t p-3">
          {streamError && (
            <p className="mx-auto mb-2 max-w-3xl px-1 text-xs text-destructive">
              {streamError}
            </p>
          )}
          {attachError && (
            <p className="mx-auto mb-2 max-w-3xl px-1 text-xs text-destructive">
              {attachError}
            </p>
          )}
          {attachments.length > 0 && (
            <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5 px-1">
              {attachments.map((a, i) => (
                <span
                  key={`${a.name}-${i}`}
                  className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
                >
                  <FileText className="h-3 w-3" />
                  <span className="max-w-[12rem] truncate">{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => void onSelectFiles(e.target.files)}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send(input)
            }}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-background p-2"
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={streaming || attaching}
              onClick={() => fileInputRef.current?.click()}
              className="h-9 w-9 shrink-0 rounded-full"
              aria-label="Attach files"
            >
              {attaching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </Button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              rows={1}
              placeholder={`Message the ${activeSpecialist?.label ?? "assistant"}...`}
              className="max-h-40 min-h-[2.5rem] w-full resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || streaming}
              className="h-9 w-9 shrink-0 rounded-full"
              aria-label="Send"
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )

  return body
}
