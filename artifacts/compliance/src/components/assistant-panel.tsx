import * as React from "react"
import { useLocation } from "wouter"
import { cn } from "@/lib/utils"
import { useAssistantChat } from "@workspace/api-client-react"
import type { AssistantToolSuggestion } from "@workspace/api-client-react"
import { X, ArrowUp, Plus, ArrowRight } from "lucide-react"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
  suggestions?: AssistantToolSuggestion[]
}

const EXAMPLE_PROMPTS = [
  "How do I start reviewing a new package?",
  "Where can I check a supplier's compliance record?",
  "Which tool audits marketing claims?",
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

  const chat = useAssistantChat()

  // Keep the transcript pinned to the latest message.
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, chat.isPending])

  // Focus the composer whenever the panel opens.
  React.useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const send = React.useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || chat.isPending) return

      const nextMessages: ChatMessage[] = [
        ...messages,
        { role: "user", content: text },
      ]
      setMessages(nextMessages)
      setInput("")

      chat.mutate(
        {
          data: {
            messages: nextMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          },
        },
        {
          onSuccess: (res) => {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: res.answer,
                suggestions: res.suggestions,
              },
            ])
          },
          onError: () => {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  "Sorry, I ran into a problem reaching the assistant. Please try again.",
              },
            ])
          },
        },
      )
    },
    [messages, chat],
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col justify-center">
              <h2 className="text-2xl font-semibold leading-tight">
                Let's find your
                <br />
                <span className="text-green-500">right tool</span>
              </h2>
              <p className="mt-2 text-sm text-white/50">
                Ask me what you're trying to do and I'll point you to the tool
                for the job.
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
              {messages.map((m, i) => (
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
                        ? "bg-green-600 text-white rounded-br-sm"
                        : "bg-white/10 text-white/90 rounded-bl-sm",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
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
              {chat.isPending && (
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
          <form
            onSubmit={onSubmit}
            className="rounded-2xl border border-white/10 bg-white/[0.06] p-2.5"
          >
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
              placeholder="Ask anything..."
              className="w-full resize-none bg-transparent px-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-white/40">
                <Plus className="h-4 w-4" />
              </span>
              <button
                type="submit"
                disabled={!input.trim() || chat.isPending}
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
