// Visual diagrams for the Security Posture page: a technical architecture
// diagram and the request-security-pipeline. Pure SVG (no chart lib) so it
// renders crisply at any width and stays trivially maintainable.
//
// Each node carries an "!" info badge. Tooltips are rendered as HTML overlays
// (not native SVG <title>) so they are styled, wrap properly, and work
// consistently across browsers — hover or tap the badge to show them.
import * as React from "react"

const INK = "#111827"
const MUTED = "#6b7280"
const LINE = "#94a3b8"
const GREEN = "#15803d"
const GREEN_BG = "#f0fdf4"
const GREEN_BORDER = "#bbf7d0"
const BLUE_BG = "#eff6ff"
const BLUE_BORDER = "#bfdbfe"
const AMBER_BG = "#fffbeb"
const AMBER_BORDER = "#fde68a"
const GRAY_BG = "#f8fafc"
const GRAY_BORDER = "#e2e8f0"

type TipState = {
  text: string
  // Position of the badge as a percentage of the diagram, so the HTML overlay
  // tracks the responsive SVG at any rendered size.
  xPct: number
  yPct: number
}

type TipHandlers = {
  show: (tip: TipState) => void
  hide: () => void
}

const TipContext = React.createContext<TipHandlers | null>(null)

/** Wraps a responsive SVG diagram and renders the active tooltip overlay. */
function DiagramShell({
  viewW,
  viewH,
  ariaLabel,
  children,
}: {
  viewW: number
  viewH: number
  ariaLabel: string
  children: React.ReactNode
}) {
  const [tip, setTip] = React.useState<TipState | null>(null)
  const handlers = React.useMemo<TipHandlers>(
    () => ({ show: setTip, hide: () => setTip(null) }),
    [],
  )
  // Flip the tooltip below the badge when the badge sits in the top third,
  // and keep it inside the horizontal bounds.
  const alignRight = tip ? tip.xPct > 55 : false
  const below = tip ? tip.yPct < 35 : false
  return (
    <TipContext.Provider value={handlers}>
      <div className="relative">
        <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full" role="img" aria-label={ariaLabel}>
          {children}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute z-20 w-64 max-w-[70vw] rounded-md border bg-popover p-2.5 text-xs leading-relaxed text-popover-foreground shadow-md"
            style={{
              left: alignRight ? undefined : `${tip.xPct}%`,
              right: alignRight ? `${100 - tip.xPct}%` : undefined,
              top: below ? `${tip.yPct}%` : undefined,
              bottom: below ? undefined : `${100 - tip.yPct}%`,
              transform: below ? "translateY(10px)" : "translateY(-10px)",
            }}
          >
            {tip.text}
          </div>
        )}
      </div>
    </TipContext.Provider>
  )
}

/** The "!" badge; reports hover/tap to the shell tooltip via context. */
function InfoBadge({
  cx,
  cy,
  info,
  viewW,
  viewH,
}: {
  cx: number
  cy: number
  info: string
  viewW: number
  viewH: number
}) {
  const handlers = React.useContext(TipContext)
  if (!handlers) return null
  const show = () =>
    handlers.show({ text: info, xPct: (cx / viewW) * 100, yPct: (cy / viewH) * 100 })
  return (
    <g
      style={{ cursor: "help", outline: "none" }}
      onMouseEnter={show}
      onMouseLeave={handlers.hide}
      onClick={show}
      role="note"
      aria-label={info}
    >
      {/* Larger invisible hit area so the badge is easy to hover. */}
      <circle cx={cx} cy={cy} r={14} fill="transparent" />
      <circle cx={cx} cy={cy} r={8} fill="#ffffff" stroke={LINE} strokeWidth={1.25} />
      <text
        x={cx}
        y={cy + 3.5}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill={MUTED}
        style={{ pointerEvents: "none" }}
      >
        !
      </text>
    </g>
  )
}

function Box({
  x,
  y,
  w,
  h,
  title,
  lines = [],
  fill = GRAY_BG,
  stroke = GRAY_BORDER,
  titleColor = INK,
  info,
  viewW,
  viewH,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  lines?: string[]
  fill?: string
  stroke?: string
  titleColor?: string
  info?: string
  viewW: number
  viewH: number
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text
        x={x + w / 2}
        y={y + 20}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill={titleColor}
      >
        {title}
      </text>
      {lines.map((l, i) => (
        <text
          key={i}
          x={x + w / 2}
          y={y + 36 + i * 13}
          textAnchor="middle"
          fontSize={10}
          fill={MUTED}
        >
          {l}
        </text>
      ))}
      {info && <InfoBadge cx={x + w - 11} cy={y + 11} info={info} viewW={viewW} viewH={viewH} />}
    </g>
  )
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
  label,
  dashed = false,
  markerId,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label?: string
  dashed?: boolean
  markerId: string
}) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={LINE}
        strokeWidth={1.5}
        strokeDasharray={dashed ? "5 4" : undefined}
        markerEnd={`url(#${markerId})`}
      />
      {label && (
        <text x={mx} y={my - 6} textAnchor="middle" fontSize={9.5} fill={MUTED}>
          {label}
        </text>
      )}
    </g>
  )
}

const ARCH_W = 860
const ARCH_H = 400

export function ArchitectureDiagram() {
  const vw = { viewW: ARCH_W, viewH: ARCH_H }
  return (
    <DiagramShell
      viewW={ARCH_W}
      viewH={ARCH_H}
      ariaLabel="Technical architecture diagram: browser client connecting over HTTPS to the Express API, which enforces authentication, rate limiting, RBAC, and tenancy scoping before reaching PostgreSQL, object storage, AI providers, and the background worker. External AI agents connect through the MCP gateway with bearer tokens."
    >
      <defs>
        <marker id="sec-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={LINE} />
        </marker>
      </defs>

      {/* Clients */}
      <Box
        {...vw}
        x={20}
        y={40}
        w={170}
        h={90}
        title="Browser (Employees)"
        lines={["React 19 + Vite", "Clerk session (httpOnly cookie)", "No tokens in storage/URLs"]}
        fill={BLUE_BG}
        stroke={BLUE_BORDER}
        info="What employees use in their browser. Sign-in state lives in a secure httpOnly cookie the page's JavaScript can never read, and no credentials are ever kept in browser storage or URLs."
      />
      <Box
        {...vw}
        x={20}
        y={270}
        w={170}
        h={76}
        title="External AI Agents"
        lines={["MCP clients", "Bearer tokens (revocable)"]}
        fill={AMBER_BG}
        stroke={AMBER_BORDER}
        info="Approved external AI tools (e.g. company copilots) that query the platform. Each holds its own revocable access token and gets the exact same permission and data-scoping rules as a signed-in user."
      />

      {/* API security boundary */}
      <rect x={250} y={20} width={300} height={360} rx={10} fill="#ffffff" stroke={GREEN} strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={400} y={40} textAnchor="middle" fontSize={11} fontWeight={600} fill={GREEN}>
        Express 5 API — security boundary
      </text>
      <Box {...vw} x={270} y={54} w={260} h={40} title="Helmet headers · Rate limiting" fill={GREEN_BG} stroke={GREEN_BORDER} info="First line of defense: adds browser security headers to every response and caps how many requests each user or IP can make, blocking abuse and flooding before anything else runs." />
      <Box {...vw} x={270} y={102} w={260} h={40} title="requireAuth — session verification" fill={GREEN_BG} stroke={GREEN_BORDER} info="Confirms who is calling. Every API request must carry a valid signed-in session; anything unauthenticated is rejected with 401 before touching any data." />
      <Box {...vw} x={270} y={150} w={260} h={40} title="RBAC — permission gates per route" fill={GREEN_BG} stroke={GREEN_BORDER} info="Confirms what the caller may do. Each route requires a specific permission (e.g. packages:read, org:manage) tied to the user's role; missing it means 403." />
      <Box {...vw} x={270} y={198} w={260} h={40} title="Tenancy scoping — org + supplier" fill={GREEN_BG} stroke={GREEN_BORDER} info="Confirms whose data the caller may see. Every database query is automatically filtered to the caller's organization — and for supplier accounts, to their own supplier only — so foreign records simply don't exist from their view." />
      <Box
        {...vw}
        x={270}
        y={246}
        w={260}
        h={56}
        title="Route handlers"
        lines={["Ownership checks · append-only audit"]}
        info="The business logic itself. Updates and deletes re-verify the record belongs to the caller before writing, and security-relevant actions are recorded in an append-only audit trail."
      />
      <Box
        {...vw}
        x={270}
        y={312}
        w={260}
        h={56}
        title="MCP Gateway"
        lines={["Own bearer auth · read-only tools", "same RBAC + tenancy scoping"]}
        fill={AMBER_BG}
        stroke={AMBER_BORDER}
        info="The single doorway for external AI agents. It authenticates their tokens, exposes read-only tools only, logs every call to a shared ledger, and reuses the exact same permission and tenancy rules as the rest of the API."
      />

      {/* Backends */}
      <Box
        {...vw}
        x={620}
        y={40}
        w={220}
        h={72}
        title="PostgreSQL"
        lines={["Org-scoped rows · Drizzle ORM", "AI keys encrypted (AES-256-GCM)"]}
        info="Where all application data lives. Rows are tagged and filtered by organization, queries go through a typed ORM (no raw string SQL from user input), and stored AI provider keys are encrypted at rest."
      />
      <Box
        {...vw}
        x={620}
        y={128}
        w={220}
        h={72}
        title="Object Storage"
        lines={["Presigned, short-lived upload URLs", "Ownership check before serving"]}
        info="Where uploaded artwork and documents live. Uploads use short-lived one-time URLs, files are validated against an extension allowlist, and every download re-checks the caller owns the file before any bytes are served."
      />
      <Box
        {...vw}
        x={620}
        y={216}
        w={220}
        h={72}
        title="AI Providers (LLMs)"
        lines={["SSRF-validated base URLs", "Prompt-injection fencing"]}
        info="The AI models that analyze packaging. Admin-configured provider URLs are validated so the server can never be tricked into calling internal addresses, and all document text sent to models is fenced as untrusted so it cannot hijack the AI's instructions."
      />
      <Box
        {...vw}
        x={620}
        y={304}
        w={220}
        h={72}
        title="Background Worker"
        lines={["In-process durable job queue", "AI analysis · routing · cleanup"]}
        info="Behind-the-scenes processing: AI package analysis, review routing, escalations, and nightly cleanup. Jobs are stored durably in the database, so nothing is lost if the server restarts."
      />

      {/* Flows */}
      <Arrow markerId="sec-arrow" x1={190} y1={85} x2={248} y2={85} label="HTTPS" />
      <Arrow markerId="sec-arrow" x1={190} y1={308} x2={268} y2={330} label="HTTPS + token" />
      <Arrow markerId="sec-arrow" x1={550} y1={76} x2={618} y2={76} />
      <Arrow markerId="sec-arrow" x1={550} y1={164} x2={618} y2={164} />
      <Arrow markerId="sec-arrow" x1={550} y1={252} x2={618} y2={252} />
      <Arrow markerId="sec-arrow" x1={550} y1={340} x2={618} y2={340} dashed />
    </DiagramShell>
  )
}

const PIPE_STEPS = [
  {
    title: "Request",
    sub: "any /api call",
    info: "Any call the app (or an external AI agent) makes to the server — loading a page of packages, saving a finding, downloading a file.",
  },
  {
    title: "Rate limit",
    sub: "per user / IP",
    info: "Caps how many requests each user or IP address can make in a window, so no one can flood the server or brute-force endpoints.",
  },
  {
    title: "Authenticate",
    sub: "verified session",
    info: "Verifies the caller's signed-in session. No valid session means the request is rejected (401) before it touches anything.",
  },
  {
    title: "Authorize",
    sub: "permission key",
    info: "Checks the caller's role grants the specific permission this route requires (e.g. packages:read). Missing permission means 403.",
  },
  {
    title: "Scope",
    sub: "org + supplier",
    info: "Automatically narrows every database query to the caller's organization — and for supplier accounts, to their own supplier — so other tenants' data is invisible.",
  },
  {
    title: "Data",
    sub: "owned rows only",
    info: "Only after passing every prior layer does the request reach data — and only rows the caller actually owns.",
  },
]

export function RequestPipelineDiagram() {
  const w = 120
  const gap = 24
  const viewW = PIPE_STEPS.length * (w + gap) - gap + 8
  const viewH = 84
  return (
    <DiagramShell
      viewW={viewW}
      viewH={viewH}
      ariaLabel="Request security pipeline: every API request passes rate limiting, authentication, permission authorization, and tenancy scoping before reaching data."
    >
      <defs>
        <marker id="sec-arrow2" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={LINE} />
        </marker>
      </defs>
      {PIPE_STEPS.map((s, i) => {
        const x = 4 + i * (w + gap)
        const last = i === PIPE_STEPS.length - 1
        return (
          <g key={s.title}>
            <Box
              viewW={viewW}
              viewH={viewH}
              x={x}
              y={14}
              w={w}
              h={56}
              title={s.title}
              lines={[s.sub]}
              fill={last ? GREEN_BG : GRAY_BG}
              stroke={last ? GREEN_BORDER : GRAY_BORDER}
              titleColor={last ? GREEN : INK}
              info={s.info}
            />
            {!last && (
              <Arrow
                markerId="sec-arrow2"
                x1={x + w}
                y1={42}
                x2={x + w + gap - 3}
                y2={42}
              />
            )}
          </g>
        )
      })}
    </DiagramShell>
  )
}
