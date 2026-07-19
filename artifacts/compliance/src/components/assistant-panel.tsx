import * as React from "react"
import { useLocation } from "wouter"
import { cn } from "@/lib/utils"
import { useAssistantExtract } from "@workspace/api-client-react"
import type { AssistantToolSuggestion } from "@workspace/api-client-react"
import { streamAssistantChat } from "@/lib/assistant-stream"
import { fetchWorkspaceFollowups } from "@/lib/workspace-stream"
import { ChatMarkdown } from "@/components/chat-markdown"
import { X, ArrowUp, Plus, ArrowRight, FileText, Loader2, Maximize2 } from "lucide-react"
import {
  extractAttachmentText,
  ATTACHMENT_ACCEPT,
  type RunOcr,
} from "@/lib/attachment-extract"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
  // True while this assistant turn is still receiving streamed tokens.
  streaming?: boolean
  // Full content actually sent to the model — may embed extracted document text
  // that we don't want to render in the user's chat bubble.
  apiContent?: string
  attachments?: string[]
  suggestions?: AssistantToolSuggestion[]
}

type Attachment = { name: string; text: string }

const EXAMPLE_PROMPTS = [
  "What warnings are required on cleaning product labels?",
  "Does an 'all natural' claim need substantiation?",
  "How do I start reviewing a new package?",
  "Where do I find FDA recalls?",
]

export function AssistantPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [, navigate] = useLocation()
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = React.useState<Attachment[]>([])
  const [attachError, setAttachError] = React.useState<string | null>(null)
  const [attaching, setAttaching] = React.useState(false)

  const [streaming, setStreaming] = React.useState(false)
  // Suggested follow-up questions for the latest Q&A (same UX as the AI
  // Workspace). Sequence counter drops stale responses when the user has
  // already sent another message.
  const [followups, setFollowups] = React.useState<string[]>([])
  const followupSeqRef = React.useRef(0)
  // Abort function for the in-flight stream, so closing the panel or
  // unmounting never leaves a dangling reader.
  const abortRef = React.useRef<(() => void) | null>(null)
  React.useEffect(() => () => abortRef.current?.(), [])
  const extract = useAssistantExtract()

  const runOcr: RunOcr = React.useCallback(
    async (imageDataUrl) => {
      const r = await extract.mutateAsync({ data: { imageDataUrl } })
      return r.text ?? ""
    },
    [extract],
  )

  const handleFiles = React.useCallback(
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
      }
    },
    [runOcr],
  )

  // Keep the transcript pinned to the latest message.
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streaming])

  // Focus the composer whenever the panel opens.
  React.useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const send = React.useCallback(
    (raw: string) => {
      const text = raw.trim()
      if ((!text && attachments.length === 0) || streaming || attaching)
        return

      const display = text || "Please review the attached document."
      const apiContent =
        attachments.length > 0
          ? [
              display,
              ...attachments.map(
                (a) => `--- Attached document: ${a.name} ---\n${a.text}`,
              ),
            ].join("\n\n")
          : display
      const attachedNames = attachments.map((a) => a.name)

      const nextMessages: ChatMessage[] = [
        ...messages,
        {
          role: "user",
          content: display,
          apiContent,
          attachments: attachedNames.length ? attachedNames : undefined,
        },
      ]
      setMessages(nextMessages)
      setInput("")
      setAttachments([])
      setAttachError(null)

      // Stream the answer into a placeholder assistant turn, but pace the
      // display: raw model tokens arrive in bursts and feel "dumped", so
      // deltas land in a buffer that a timer drains at a readable typing
      // speed (speeding up only when far behind, so we never lag the model
      // by more than a few seconds).
      setStreaming(true)
      setFollowups([])
      const followupSeq = ++followupSeqRef.current
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true },
      ])
      const patchLast = (patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (!last || last.role !== "assistant") return prev
          next[next.length - 1] = {
            ...last,
            ...(typeof patch === "function" ? patch(last) : patch),
          }
          return next
        })
      // --- Paced typing drain -------------------------------------------
      let buffer = "" // text received from the model but not yet shown
      let finished = false // model stream ended; finish once buffer empties
      let timer: ReturnType<typeof setInterval> | null = null

      // Tool suggestion cards arrive from the server before the text finishes
      // typing out; hold them here and attach them only at finalize, so they
      // appear after the full answer instead of ahead of it.
      let pendingSuggestions: ChatMessage["suggestions"] | undefined

      const finalize = () => {
        patchLast({ streaming: false, suggestions: pendingSuggestions })
        setStreaming(false)
        abortRef.current = null
        // Best-effort follow-up chips for the finished Q&A; drop the
        // result if the user already sent another message.
        setMessages((prev) => {
          const answer = prev[prev.length - 1]
          if (answer?.role === "assistant" && answer.content) {
            void fetchWorkspaceFollowups(display, answer.content).then(
              (qs) => {
                if (followupSeqRef.current === followupSeq) setFollowups(qs)
              },
            )
          }
          return prev
        })
      }

      const stopTimer = () => {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
      }

      const startTimer = () => {
        if (timer) return
        timer = setInterval(() => {
          if (buffer.length === 0) {
            if (finished) {
              stopTimer()
              finalize()
            }
            return
          }
          // Readable typing pace (~65 chars/sec baseline); catch-up is
          // gentle and hard-capped so long answers never dump all at once
          // (same tuning as the AI Workspace typewriter).
          const n = Math.min(Math.max(2, Math.ceil(buffer.length / 150)), 24)
          const chunk = buffer.slice(0, n)
          buffer = buffer.slice(n)
          patchLast((m) => ({ content: m.content + chunk }))
        }, 36)
      }

      const rawAbort = streamAssistantChat(
        {
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.apiContent ?? m.content,
          })),
        },
        {
          onDelta: (t) => {
            buffer += t
            startTimer()
          },
          onSuggestions: (suggestions) => {
            pendingSuggestions = suggestions
          },
          onDone: () => {
            finished = true
            startTimer() // ensure the remaining buffer drains, then finalize
          },
          onError: (message) => {
            // Show everything we have immediately — errors shouldn't type.
            stopTimer()
            const rest = buffer
            buffer = ""
            patchLast((m) => ({
              streaming: false,
              content:
                m.content + rest ||
                message ||
                "Sorry, I ran into a problem reaching the assistant. Please try again.",
            }))
            setStreaming(false)
            abortRef.current = null
          },
        },
      )
      // Aborting (panel closed / unmount) must also stop the drain timer.
      abortRef.current = () => {
        stopTimer()
        rawAbort?.()
      }
    },
    [messages, streaming, attachments, attaching],
  )

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    send(input)
  }

  const goTo = (href: string) => {
    navigate(href)
    onClose()
  }

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        "dark shrink-0 overflow-hidden bg-black text-white transition-[width] duration-300 ease-in-out",
        open ? "w-full sm:w-[400px] border-l border-white/10" : "w-0",
      )}
    >
      {/* Fixed-width inner shell so content doesn't reflow during the slide. */}
      <div className="flex h-full w-full flex-col sm:w-[400px]">
        {/* Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white p-1">
              <img
                src={`${import.meta.env.BASE_URL}dollar-tree-icon.png`}
                alt="Dollar Tree"
                className="h-full w-full object-contain"
              />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold">AI Assistant</p>
              <p className="text-[11px] text-white/50">Find the right tool</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                // Hand the current transcript to the full AI Workspace, which
                // seeds a fresh saved conversation from it.
                sessionStorage.setItem(
                  "ai-workspace-handoff",
                  JSON.stringify({
                    messages: messages.map((m) => ({
                      role: m.role,
                      content: m.apiContent ?? m.content,
                    })),
                  }),
                )
                navigate("/ai-workspace")
                onClose()
              }}
              aria-label="Open AI Workspace"
              title="Open full AI Workspace"
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Maximize2 className="h-4 w-4" />
              <span className="hidden sm:inline">Workspace</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close assistant"
              className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col justify-center">
              <h2 className="text-2xl font-semibold leading-tight">
                How can I
                <br />
                <span className="text-green-500">help you?</span>
              </h2>
              <p className="mt-2 text-sm text-white/50">
                Ask a compliance question or tell me what you're trying to do —
                I'll answer and point you to the right tool.
              </p>
              <div className="mt-5 space-y-2">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => send(p)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <span>{p}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-white/40" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => m.streaming && !m.content ? null : (
                <div
                  key={i}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-brand text-brand-foreground rounded-br-sm"
                        : "bg-white/10 text-white/90 rounded-bl-sm",
                    )}
                  >
                    {m.role === "user" ? (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    ) : (
                      <ChatMarkdown content={m.content} onNavigate={goTo} />
                    )}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.attachments.map((n, j) => (
                          <span
                            key={j}
                            className="flex items-center gap-1 rounded bg-black/25 px-1.5 py-0.5 text-[11px]"
                          >
                            <FileText className="h-3 w-3 shrink-0" />
                            <span className="max-w-[160px] truncate">{n}</span>
                          </span>
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
                            className="flex w-full flex-col gap-0.5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-left hover:bg-green-500/20 transition-colors"
                          >
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-green-400">
                              {s.label}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </span>
                            {s.reason && (
                              <span className="text-xs text-white/60">
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
              {streaming &&
                messages[messages.length - 1]?.role === "assistant" &&
                !messages[messages.length - 1]?.content && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-white/10 px-4 py-3">
                    <Dot />
                    <Dot className="[animation-delay:150ms]" />
                    <Dot className="[animation-delay:300ms]" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer — styled after the reference "Ask anything" box */}
        <div className="shrink-0 p-3">
          {!streaming && followups.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5 px-1">
              {followups.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-left text-xs text-white/80 transition-colors hover:border-green-500/40 hover:bg-green-500/10 hover:text-green-300"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {attachError && (
            <p className="mb-2 px-1 text-xs text-red-400">{attachError}</p>
          )}
          <form
            onSubmit={onSubmit}
            className="rounded-2xl border border-white/10 bg-white/[0.06] p-2.5"
          >
            {attachments.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
                {attachments.map((a, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white/80"
                  >
                    <FileText className="h-3 w-3 shrink-0 text-green-400" />
                    <span className="max-w-[140px] truncate">{a.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((_, j) => j !== i))
                      }
                      aria-label={`Remove ${a.name}`}
                      className="text-white/40 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              rows={2}
              placeholder="Ask a question or attach a document..."
              className="w-full resize-none bg-transparent px-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files)
                e.target.value = ""
              }}
            />
            <div className="mt-1 flex items-center justify-between">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={attaching}
                aria-label="Add documents"
                title="Add documents"
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 disabled:opacity-50"
              >
                {attaching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </button>
              <button
                type="submit"
                disabled={
                  (!input.trim() && attachments.length === 0) ||
                  streaming ||
                  attaching
                }
                aria-label="Send"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </aside>
  )
}

function Dot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 animate-bounce rounded-full bg-white/50",
        className,
      )}
    />
  )
}
