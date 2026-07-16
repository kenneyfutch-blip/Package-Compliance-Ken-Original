import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkspaceCitation } from "@/lib/workspace-stream"

interface ChatMarkdownProps {
  content: string
  citations?: WorkspaceCitation[] | null
  /** In-app navigation for internal citation/link hrefs (e.g. "/reports/1"). */
  onNavigate: (href: string) => void
  className?: string
}

// Escape the few characters that would otherwise break out of a markdown link
// label. Citation labels are plain record names, but this keeps us safe.
function escapeLinkLabel(label: string): string {
  return label.replace(/([[\]\\])/g, "\\$1")
}

// Flatten a React node tree to its raw text (code blocks arrive as a `code`
// element whose children may be strings or nested nodes).
function nodeText(node: React.ReactNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return nodeText(node.props.children)
  }
  return ""
}

// Turn the first mention of each cited record's name into a markdown link, so
// the source sits inline in the prose (OpenAI/Copilot-style) rather than in a
// separate list. We only touch text OUTSIDE fenced code blocks so code samples
// are never rewritten.
function injectCitationLinks(
  content: string,
  citations: WorkspaceCitation[] | null | undefined,
): string {
  const linkable = (citations ?? []).filter(
    (c): c is WorkspaceCitation & { href: string } =>
      Boolean(c.href) && Boolean(c.label),
  )
  if (linkable.length === 0) return content
  // Longest labels first so a label containing another isn't shadowed.
  const byLength = [...linkable].sort((a, b) => b.label.length - a.label.length)
  const used = new Set<string>()

  // Split into code and non-code spans; closed ``` fences, an UNTERMINATED
  // trailing fence (common mid-stream), closed `inline code`, and an
  // unterminated trailing backtick are all left untouched so streaming code is
  // never rewritten before its fence closes.
  const parts = content.split(
    /(```[\s\S]*?```|```[\s\S]*$|`[^`]*`|`[^`]*$)/g,
  )
  return parts
    .map((part) => {
      if (part.startsWith("```") || part.startsWith("`")) return part
      let out = part
      for (const cite of byLength) {
        if (used.has(cite.label)) continue
        const idx = out.indexOf(cite.label)
        if (idx === -1) continue
        used.add(cite.label)
        const link = `[${escapeLinkLabel(cite.label)}](${cite.href})`
        out = out.slice(0, idx) + link + out.slice(idx + cite.label.length)
      }
      return out
    })
    .join("")
}

function CodeBlock({
  language,
  code,
}: {
  language: string | null
  code: string
}) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/60 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {language || "Plain Text"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}

/**
 * Renders assistant chat text as GitHub-flavored markdown, Copilot-style:
 * fenced code renders inside a bordered box with a language header + copy
 * button, prose gets proper paragraph/list/table spacing, and cited records
 * are linked inline. Internal links route through the app router.
 */
export function ChatMarkdown({
  content,
  citations,
  onNavigate,
  className,
}: ChatMarkdownProps) {
  const source = React.useMemo(
    () => injectCitationLinks(content, citations),
    [content, citations],
  )

  const components = React.useMemo<Components>(
    () => ({
      p: ({ children }) => (
        <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>
      ),
      ul: ({ children }) => (
        <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
      h1: ({ children }) => (
        <h1 className="mb-2 mt-4 text-lg font-semibold first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">
          {children}
        </h3>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold">{children}</strong>
      ),
      a: ({ href, children }) => (
        <a
          href={href}
          onClick={(e) => {
            if (href && href.startsWith("/")) {
              e.preventDefault()
              onNavigate(href)
            }
          }}
          target={href && href.startsWith("/") ? undefined : "_blank"}
          rel="noreferrer"
          className="font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
        >
          {children}
        </a>
      ),
      blockquote: ({ children }) => (
        <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-4 border-border" />,
      table: ({ children }) => (
        <div className="my-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="bg-muted/60">{children}</thead>
      ),
      th: ({ children }) => (
        <th className="border-b border-border px-3 py-1.5 text-left font-medium">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border-b border-border/60 px-3 py-1.5">{children}</td>
      ),
      // Inline code only — block/fenced code is handled by `pre` below, which is
      // the reliable way to distinguish the two in react-markdown v9 (the
      // `code` renderer no longer receives an `inline` flag).
      code: ({ children, ...props }) => (
        <code
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          {...props}
        >
          {children}
        </code>
      ),
      // Fenced code block: pull the language + text off the inner `code` element
      // and render it as a bordered box with a header + copy button.
      pre: ({ children }) => {
        const child = React.Children.toArray(children)[0]
        const codeClass = React.isValidElement<{ className?: string }>(child)
          ? child.props.className || ""
          : ""
        const match = /language-(\w+)/.exec(codeClass)
        const code = nodeText(child).replace(/\n$/, "")
        return <CodeBlock language={match ? match[1] : null} code={code} />
      },
    }),
    [onNavigate],
  )

  return (
    <div className={cn("text-sm", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
