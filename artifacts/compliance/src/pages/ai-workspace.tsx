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
  useGetDashboardStats,
  useGetComplianceTrends,
  useListReports,
  getGetDashboardStatsQueryKey,
  getGetComplianceTrendsQueryKey,
  getListReportsQueryKey,
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { SpecialistAvatar } from "@/components/specialist-avatar"
import { ChatMarkdown } from "@/components/chat-markdown"
import { getSpecialistProfile } from "@/lib/specialist-profiles"
import { usePageContext } from "@/lib/workspace-context"
import {
  streamWorkspaceMessage,
  confirmWorkspaceAction,
  cancelWorkspaceAction,
  type WorkspaceCitation,
  type WorkspaceAttachmentPayload,
  type WorkspaceProposedAction,
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
  RefreshCw,
  BarChart3,
  ChevronDown,
} from "lucide-react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  Tooltip,
} from "recharts"
import { servingUrl } from "@/lib/proof-utils"

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
  // State-changing actions the assistant proposed on this turn (confirm cards).
  proposedActions?: WorkspaceProposedAction[] | null
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

  // On-demand live snapshot for the Context pane. Nothing is fetched until the
  // user explicitly asks for it (enabled gate), so it never auto-polls.
  const [liveOpen, setLiveOpen] = React.useState(false)
  const liveStats = useGetDashboardStats({
    query: { enabled: liveOpen, queryKey: getGetDashboardStatsQueryKey() },
  })
  const liveTrends = useGetComplianceTrends({
    query: { enabled: liveOpen, queryKey: getGetComplianceTrendsQueryKey() },
  })
  const liveReports = useListReports({
    query: { enabled: liveOpen, queryKey: getListReportsQueryKey() },
  })
  const liveLoading =
    liveOpen &&
    (liveStats.isLoading || liveTrends.isLoading || liveReports.isLoading)
  const liveFetching =
    liveStats.isFetching || liveTrends.isFetching || liveReports.isFetching
  const liveError =
    liveOpen &&
    (liveStats.isError || liveTrends.isError || liveReports.isError)
  const refreshLive = () => {
    void liveStats.refetch()
    void liveTrends.refetch()
    void liveReports.refetch()
  }

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

  // Responsive overflow for the specialist bar: measure how many chips actually
  // fit on one row at the current width and tuck the rest into the "More" menu.
  // Recomputed whenever the bar resizes, so shrinking the screen never hides a
  // chip abruptly — chips flow into the menu as space runs out.
  const specialistBarRef = React.useRef<HTMLDivElement>(null)
  const specialistMeasureRef = React.useRef<HTMLDivElement>(null)
  const [visibleSpecialists, setVisibleSpecialists] = React.useState(
    specialists.length,
  )

  React.useLayoutEffect(() => {
    const bar = specialistBarRef.current
    const measure = specialistMeasureRef.current
    if (!bar || !measure) return
    const GAP = 6 // matches gap-1.5 (0.375rem)
    const MORE_RESERVE = 140 // room for the "More"/selected trigger chip (incl. avatar)
    const compute = () => {
      const available = bar.clientWidth
      const items = Array.from(measure.children) as HTMLElement[]
      let used = 0
      let count = 0
      for (let i = 0; i < items.length; i++) {
        const w = items[i].getBoundingClientRect().width
        const withGap = used + w + (count > 0 ? GAP : 0)
        const isLast = i === items.length - 1
        const reserve = isLast ? 0 : MORE_RESERVE + GAP
        if (withGap + reserve <= available) {
          used = withGap
          count++
        } else break
      }
      setVisibleSpecialists(Math.max(1, count))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(bar)
    // Recompute once fonts settle (chip widths shift after webfont load).
    document.fonts?.ready.then(compute).catch(() => {})
    return () => ro.disconnect()
  }, [specialists])

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
          proposedActions:
            ((m as { proposedActions?: WorkspaceProposedAction[] | null })
              .proposedActions as WorkspaceProposedAction[] | null) ?? null,
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
        onProposedAction: (proposal) => {
          setLiveMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === "assistant" && last.streaming) {
              next[next.length - 1] = {
                ...last,
                proposedActions: [...(last.proposedActions ?? []), proposal],
              }
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

  // Track which proposals are mid-request so their buttons can disable/spinner.
  const [pendingProposal, setPendingProposal] = React.useState<number | null>(null)

  // Replace a proposal in-place across the transcript after confirm/cancel.
  const updateProposal = React.useCallback((p: WorkspaceProposedAction) => {
    setLiveMessages((prev) =>
      prev.map((m) =>
        m.proposedActions
          ? {
              ...m,
              proposedActions: m.proposedActions.map((x) =>
                x.id === p.id ? p : x,
              ),
            }
          : m,
      ),
    )
  }, [])

  const confirmProposal = React.useCallback(
    async (proposal: WorkspaceProposedAction) => {
      if (activeId == null || pendingProposal != null) return
      setPendingProposal(proposal.id)
      setStreamError(null)
      try {
        const res = await confirmWorkspaceAction(activeId, proposal.id)
        updateProposal(res.proposal)
        if (res.message) {
          setLiveMessages((prev) => [
            ...prev,
            {
              id: res.message!.id,
              role: "assistant",
              content: res.message!.content,
              citations:
                (res.message!.citations as WorkspaceCitation[] | null) ?? null,
            },
          ])
        }
        void queryClient.invalidateQueries({
          queryKey: getGetWorkspaceConversationQueryKey(activeId),
        })
      } catch (err) {
        setStreamError(
          err instanceof Error ? err.message : "The action could not be completed.",
        )
      } finally {
        setPendingProposal(null)
      }
    },
    [activeId, pendingProposal, queryClient, updateProposal],
  )

  const cancelProposal = React.useCallback(
    async (proposal: WorkspaceProposedAction) => {
      if (activeId == null || pendingProposal != null) return
      setPendingProposal(proposal.id)
      try {
        const res = await cancelWorkspaceAction(activeId, proposal.id)
        updateProposal(res.proposal)
      } catch (err) {
        setStreamError(
          err instanceof Error ? err.message : "Could not cancel the action.",
        )
      } finally {
        setPendingProposal(null)
      }
    },
    [activeId, pendingProposal, updateProposal],
  )

  const goTo = (href: string) => navigate(href)

  const linkedLabel = detail?.linkedRecordLabel ?? null
  const hasContext = Boolean(linkedLabel || pageContext?.title || pageContext?.summary)

  const isOverlay = mode === "fullscreen" || mode === "split"

  const body = (
    <div
      className={cn(
        "flex overflow-hidden rounded-xl border bg-card shadow-sm",
        isOverlay ? "fixed inset-0 z-50 rounded-none border-0" : "h-[calc(100vh-9rem)]",
      )}
    >
      {/* Conversation history sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-muted/30 md:flex">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white p-1 ring-1 ring-black/5">
              <img
                src={`${import.meta.env.BASE_URL}dollar-tree-icon.png`}
                alt="Dollar Tree"
                className="h-full w-full object-contain"
              />
            </span>
            <span className="text-sm font-semibold tracking-tight">AI Workspace</span>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={startNew}>
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
                  "group flex items-center gap-1 rounded-lg px-2 py-2 text-sm transition-colors",
                  c.id === activeId
                    ? "bg-primary/10 text-foreground ring-1 ring-primary/15"
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
        <section className="hidden min-w-0 flex-1 flex-col border-r bg-background lg:flex">
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

            {/* On-demand live snapshot: fetched only when the user asks. */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Live snapshot
                </p>
                {liveOpen && (
                  <button
                    type="button"
                    onClick={refreshLive}
                    title="Refresh live data"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw
                      className={cn(
                        "h-3.5 w-3.5",
                        liveFetching && "animate-spin",
                      )}
                    />
                  </button>
                )}
              </div>

              {!liveOpen ? (
                <div className="mt-1.5">
                  <p className="text-xs text-muted-foreground">
                    Pull live compliance metrics, recent reports, and trends on
                    demand.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-8 gap-1.5"
                    onClick={() => setLiveOpen(true)}
                  >
                    <BarChart3 className="h-3.5 w-3.5" /> Load live snapshot
                  </Button>
                </div>
              ) : liveLoading ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pulling live
                  data…
                </div>
              ) : liveError ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-destructive">
                    Couldn't load live data. Try again.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    onClick={refreshLive}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </Button>
                </div>
              ) : (
                <div className="mt-3 space-y-4">
                  {/* Key metrics */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      {
                        label: "Reviewed",
                        value: liveStats.data?.totalPackages ?? 0,
                        tone: "text-foreground",
                      },
                      {
                        label: "Passed",
                        value: liveStats.data?.passed ?? 0,
                        tone: "text-success",
                      },
                      {
                        label: "Critical",
                        value: liveStats.data?.criticalViolations ?? 0,
                        tone: "text-destructive",
                      },
                      {
                        label: "Today",
                        value: liveStats.data?.reviewedToday ?? 0,
                        tone: "text-foreground",
                      },
                    ].map((m) => (
                      <div
                        key={m.label}
                        className="rounded-md border bg-card px-2.5 py-2"
                      >
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {m.label}
                        </p>
                        <p className={cn("text-lg font-bold", m.tone)}>
                          {m.value.toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Compact compliance trend */}
                  {(liveTrends.data?.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Pass / fail trend
                      </p>
                      <div className="h-[110px] w-full rounded-md border bg-card p-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={liveTrends.data ?? []}>
                            <XAxis
                              dataKey="date"
                              hide
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "hsl(var(--popover))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                                fontSize: "11px",
                              }}
                              itemStyle={{ color: "hsl(var(--foreground))" }}
                            />
                            <Line
                              type="monotone"
                              dataKey="passed"
                              stroke="hsl(var(--success))"
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="failed"
                              stroke="hsl(var(--destructive))"
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Recent reports */}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Recent reports
                      </p>
                      <button
                        type="button"
                        onClick={() => goTo("/reports")}
                        className="text-[11px] text-primary hover:underline"
                      >
                        View all
                      </button>
                    </div>
                    {(liveReports.data?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No reports generated yet.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {(liveReports.data ?? []).slice(0, 4).map((r) => {
                          const url = servingUrl(r.objectPath)
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                if (url)
                                  window.open(url, "_blank", "noopener,noreferrer")
                                else goTo("/reports")
                              }}
                              className="group flex w-full items-start gap-2 rounded-md border bg-card px-2.5 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                            >
                              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">
                                  {r.title}
                                </span>
                                <span className="block text-[10px] text-muted-foreground">
                                  {r.type} ·{" "}
                                  {new Date(r.createdAt).toLocaleDateString()}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Main chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar: specialist switcher + mode controls */}
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
          {(() => {
            const inline = specialists.slice(0, visibleSpecialists)
            const overflow = specialists.slice(visibleSpecialists)
            const selectedOverflow = overflow.find((s) => s.key === specialist)
            const specialistBtn = (
              s: (typeof specialists)[number],
              active: boolean,
            ) =>
              cn(
                "shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-muted hover:text-foreground",
              )
            return (
              <div
                ref={specialistBarRef}
                className="relative flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pr-2"
              >
                {/* Hidden measurement row: natural chip widths drive how many
                    fit on the visible row. Absolute + invisible = no layout. */}
                <div
                  ref={specialistMeasureRef}
                  aria-hidden
                  className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1.5"
                >
                  {specialists.map((s) => (
                    <span
                      key={s.key}
                      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium"
                    >
                      <SpecialistAvatar specialistKey={s.key} size={16} />
                      {s.label}
                    </span>
                  ))}
                </div>
                {inline.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => persistSpecialist(s.key)}
                    title={s.description}
                    className={cn(
                      specialistBtn(s, s.key === specialist),
                      "flex items-center gap-1.5",
                    )}
                  >
                    <SpecialistAvatar specialistKey={s.key} size={16} />
                    {s.label}
                  </button>
                ))}
                {overflow.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        title="More specialists"
                        className={cn(
                          specialistBtn(
                            selectedOverflow ?? overflow[0],
                            Boolean(selectedOverflow),
                          ),
                          "flex items-center gap-1.5",
                        )}
                      >
                        {selectedOverflow && (
                          <SpecialistAvatar
                            specialistKey={selectedOverflow.key}
                            size={16}
                          />
                        )}
                        {selectedOverflow ? selectedOverflow.label : "More"}
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {overflow.map((s) => (
                        <DropdownMenuItem
                          key={s.key}
                          onSelect={() => persistSpecialist(s.key)}
                          className={cn(
                            "flex flex-col items-start gap-0.5",
                            s.key === specialist && "bg-accent",
                          )}
                        >
                          <span className="text-xs font-medium">{s.label}</span>
                          {s.description && (
                            <span className="line-clamp-1 text-[10px] text-muted-foreground">
                              {s.description}
                            </span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )
          })()}
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6">
          {liveMessages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col justify-center">
              <div className="mb-5 flex flex-col items-start gap-4">
                <SpecialistAvatar
                  specialistKey={specialist}
                  label={activeSpecialist?.label}
                  size={112}
                  shape="square"
                  showStatus
                />
                <div className="min-w-0">
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    <Sparkles className="h-3 w-3" /> AI Specialist
                  </span>
                  <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Online now
                  </div>
                </div>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {getSpecialistProfile(specialist, activeSpecialist?.label).name}
              </h2>
              <p className="mt-0.5 text-sm font-medium text-muted-foreground">
                {activeSpecialist?.label ?? "AI Workspace"}
              </p>
              <p className="mt-2 text-muted-foreground">
                {activeSpecialist?.description ??
                  "Ask a compliance question or describe what you're trying to do."}
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {(activeSpecialist?.suggestedPrompts ?? []).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => send(p)}
                    className="group flex items-center justify-between gap-2 rounded-xl border bg-card px-3.5 py-3 text-left text-sm shadow-sm transition-all hover:border-primary/30 hover:bg-primary/5"
                  >
                    <span>{p}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {liveMessages.map((m, i) => {
                const isUser = m.role === "user"
                return (
                <div
                  key={m.id ?? `live-${i}`}
                  className={cn(
                    "flex gap-3",
                    isUser ? "justify-end" : "justify-start",
                  )}
                >
                  {!isUser && (
                    <SpecialistAvatar
                      specialistKey={specialist}
                      label={activeSpecialist?.label}
                      size={30}
                      className="mt-0.5"
                    />
                  )}
                  <div
                    className={cn(
                      "min-w-0 text-sm leading-relaxed",
                      isUser
                        ? "max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-brand-foreground shadow-sm"
                        : "max-w-[calc(100%-2.5rem)] flex-1 pt-0.5 text-foreground",
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
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    ) : (
                      m.content && (
                        <div className="max-w-none">
                          <ChatMarkdown
                            content={m.content}
                            citations={m.citations}
                            onNavigate={goTo}
                          />
                          {m.streaming && (
                            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-current align-middle" />
                          )}
                        </div>
                      )
                    )}
                    {!isUser && m.streaming && !m.content && !m.status && (
                      <Loader2 className="inline h-4 w-4 animate-spin" />
                    )}
                    {m.proposedActions && m.proposedActions.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {m.proposedActions.map((p) => (
                          <div
                            key={p.id}
                            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-foreground"
                          >
                            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                              <Sparkles className="h-3.5 w-3.5" />
                              Confirm action
                            </p>
                            <p className="mt-1 text-sm">{p.summary}</p>
                            {p.status === "pending" ? (
                              <div className="mt-2.5 flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-8"
                                  disabled={pendingProposal != null}
                                  onClick={() => confirmProposal(p)}
                                >
                                  {pendingProposal === p.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    "Confirm"
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  disabled={pendingProposal != null}
                                  onClick={() => cancelProposal(p)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <p
                                className={cn(
                                  "mt-2 flex items-center gap-1.5 text-xs font-medium",
                                  p.status === "executed"
                                    ? "text-emerald-700"
                                    : p.status === "failed"
                                      ? "text-destructive"
                                      : "text-muted-foreground",
                                )}
                              >
                                {p.status === "executing" && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                )}
                                {p.status === "executed"
                                  ? "Confirmed and completed."
                                  : p.status === "cancelled"
                                    ? "Cancelled."
                                    : p.status === "executing"
                                      ? "Running…"
                                      : "This action could not be completed."}
                              </p>
                            )}
                          </div>
                        ))}
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
                )
              })}
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
            className="pba-rainbow-input mx-auto flex max-w-3xl items-end gap-2 rounded-2xl p-2 shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary/10"
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
              placeholder={`Message ${getSpecialistProfile(specialist, activeSpecialist?.label).name}...`}
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
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
            Powered by Claude Agentic AI · claude-haiku-4.5
          </p>
        </div>
      </div>
    </div>
  )

  return body
}
