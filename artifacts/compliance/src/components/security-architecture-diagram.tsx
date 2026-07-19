// Visual diagrams for the Security Posture page: a technical architecture
// diagram and the request-security-pipeline. Pure SVG (no chart lib) so it
// renders crisply at any width and stays trivially maintainable.
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

function Box({
  x,
  y,
  w,
  h,
  title,
  lines = [],
  fill = GRAY_BG,
  stroke = GRAY_BORDER,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  lines?: string[]
  fill?: string
  stroke?: string
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
        fill={INK}
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
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label?: string
  dashed?: boolean
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
        markerEnd="url(#sec-arrow)"
      />
      {label && (
        <text x={mx} y={my - 6} textAnchor="middle" fontSize={9.5} fill={MUTED}>
          {label}
        </text>
      )}
    </g>
  )
}

export function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 860 400"
      className="w-full"
      role="img"
      aria-label="Technical architecture diagram: browser client connecting over HTTPS to the Express API, which enforces authentication, rate limiting, RBAC, and tenancy scoping before reaching PostgreSQL, object storage, AI providers, and the background worker. External AI agents connect through the MCP gateway with bearer tokens."
    >
      <defs>
        <marker id="sec-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={LINE} />
        </marker>
      </defs>

      {/* Clients */}
      <Box
        x={20}
        y={40}
        w={170}
        h={90}
        title="Browser (Employees)"
        lines={["React 19 + Vite", "Clerk session (httpOnly cookie)", "No tokens in storage/URLs"]}
        fill={BLUE_BG}
        stroke={BLUE_BORDER}
      />
      <Box
        x={20}
        y={270}
        w={170}
        h={76}
        title="External AI Agents"
        lines={["MCP clients", "Bearer tokens (revocable)"]}
        fill={AMBER_BG}
        stroke={AMBER_BORDER}
      />

      {/* API security boundary */}
      <rect x={250} y={20} width={300} height={360} rx={10} fill="#ffffff" stroke={GREEN} strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={400} y={40} textAnchor="middle" fontSize={11} fontWeight={600} fill={GREEN}>
        Express 5 API — security boundary
      </text>
      <Box x={270} y={54} w={260} h={40} title="Helmet headers · Rate limiting" fill={GREEN_BG} stroke={GREEN_BORDER} />
      <Box x={270} y={102} w={260} h={40} title="requireAuth — session verification" fill={GREEN_BG} stroke={GREEN_BORDER} />
      <Box x={270} y={150} w={260} h={40} title="RBAC — permission gates per route" fill={GREEN_BG} stroke={GREEN_BORDER} />
      <Box x={270} y={198} w={260} h={40} title="Tenancy scoping — org + supplier" fill={GREEN_BG} stroke={GREEN_BORDER} />
      <Box
        x={270}
        y={246}
        w={260}
        h={56}
        title="Route handlers"
        lines={["Ownership checks · append-only audit"]}
      />
      <Box
        x={270}
        y={312}
        w={260}
        h={56}
        title="MCP Gateway"
        lines={["Own bearer auth · read-only tools", "same RBAC + tenancy scoping"]}
        fill={AMBER_BG}
        stroke={AMBER_BORDER}
      />

      {/* Backends */}
      <Box
        x={620}
        y={40}
        w={220}
        h={72}
        title="PostgreSQL"
        lines={["Org-scoped rows · Drizzle ORM", "AI keys encrypted (AES-256-GCM)"]}
      />
      <Box
        x={620}
        y={128}
        w={220}
        h={72}
        title="Object Storage"
        lines={["Presigned, short-lived upload URLs", "Ownership check before serving"]}
      />
      <Box
        x={620}
        y={216}
        w={220}
        h={72}
        title="AI Providers (LLMs)"
        lines={["SSRF-validated base URLs", "Prompt-injection fencing"]}
      />
      <Box
        x={620}
        y={304}
        w={220}
        h={72}
        title="Background Worker"
        lines={["In-process durable job queue", "AI analysis · routing · cleanup"]}
      />

      {/* Flows */}
      <Arrow x1={190} y1={85} x2={248} y2={85} label="HTTPS" />
      <Arrow x1={190} y1={308} x2={268} y2={330} label="HTTPS + token" />
      <Arrow x1={550} y1={76} x2={618} y2={76} />
      <Arrow x1={550} y1={164} x2={618} y2={164} />
      <Arrow x1={550} y1={252} x2={618} y2={252} />
      <Arrow x1={550} y1={340} x2={618} y2={340} dashed />
    </svg>
  )
}

export function RequestPipelineDiagram() {
  const steps = [
    { title: "Request", sub: "any /api call" },
    { title: "Rate limit", sub: "per user / IP" },
    { title: "Authenticate", sub: "verified session" },
    { title: "Authorize", sub: "permission key" },
    { title: "Scope", sub: "org + supplier" },
    { title: "Data", sub: "owned rows only" },
  ]
  const w = 120
  const gap = 24
  return (
    <svg
      viewBox={`0 0 ${steps.length * (w + gap) - gap + 8} 84`}
      className="w-full"
      role="img"
      aria-label="Request security pipeline: every API request passes rate limiting, authentication, permission authorization, and tenancy scoping before reaching data."
    >
      <defs>
        <marker id="sec-arrow2" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={LINE} />
        </marker>
      </defs>
      {steps.map((s, i) => {
        const x = 4 + i * (w + gap)
        const last = i === steps.length - 1
        return (
          <g key={s.title}>
            <rect
              x={x}
              y={14}
              width={w}
              height={56}
              rx={8}
              fill={last ? GREEN_BG : GRAY_BG}
              stroke={last ? GREEN_BORDER : GRAY_BORDER}
              strokeWidth={1.5}
            />
            <text x={x + w / 2} y={38} textAnchor="middle" fontSize={12} fontWeight={600} fill={last ? GREEN : INK}>
              {s.title}
            </text>
            <text x={x + w / 2} y={54} textAnchor="middle" fontSize={10} fill={MUTED}>
              {s.sub}
            </text>
            {!last && (
              <line
                x1={x + w}
                y1={42}
                x2={x + w + gap - 3}
                y2={42}
                stroke={LINE}
                strokeWidth={1.5}
                markerEnd="url(#sec-arrow2)"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
