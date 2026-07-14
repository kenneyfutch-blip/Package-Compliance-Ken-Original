import { Link } from "wouter"
import {
  ScanText, ShieldCheck, Gauge, Brain, Sparkles, Route, Wrench, Languages,
  Megaphone, AlertTriangle, Grid3x3, Scale, ShieldAlert, BookOpen, Building2,
  Trophy, Users, GitBranch, FileText, BarChart3, GraduationCap, Bot,
  ArrowRight, Upload, Inbox, ListChecks, Check, Boxes,
  type LucideIcon,
} from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

const AGENCIES = ["FDA", "FTC", "EPA", "CPSC", "USDA", "Prop 65"]

const STATS: { value: string; label: string }[] = [
  { value: "5+", label: "Federal agencies enforced" },
  { value: "Seconds", label: "To a first-pass review" },
  { value: "Every finding", label: "Cited to regulation" },
  { value: "100%", label: "Audit-logged decisions" },
]

const CAPABILITIES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ScanText,
    title: "Autonomous artwork intake",
    body: "Drop in artwork or a PDF and AI-powered OCR extracts the panels, claims, ingredient lists, and nutrition facts — with no manual transcription.",
  },
  {
    icon: Sparkles,
    title: "Multi-agency AI review",
    body: "FDA, FTC, EPA, CPSC and USDA rules are checked in seconds, with each finding cited back to the exact regulation.",
  },
  {
    icon: Route,
    title: "Smart routing & escalation",
    body: "Reviews auto-assign to the right specialist team by product category, and high-risk findings are escalated into a priority queue for faster turnaround.",
  },
  {
    icon: Gauge,
    title: "Risk grading & fixes",
    body: "Every package gets a letter grade, a risk score, and specific recommended fixes your reviewers can act on immediately.",
  },
  {
    icon: Brain,
    title: "Compliance memory",
    body: "A retrieval engine learns from every past finding, decision and fix — so the system gets sharper with every review.",
  },
  {
    icon: Bot,
    title: "AI compliance copilot",
    body: "Ask regulatory questions in plain language, attach documents for instant analysis, and jump straight to the right tool.",
  },
]

type Tool = { icon: LucideIcon; name: string; desc: string }
const TOOL_GROUPS: { label: string; icon: LucideIcon; tools: Tool[] }[] = [
  {
    label: "AI Review & Findings",
    icon: Sparkles,
    tools: [
      { icon: Upload, name: "New Package", desc: "Upload artwork to start an AI review" },
      { icon: ListChecks, name: "Active Reviews", desc: "Track everything in progress" },
      { icon: Inbox, name: "Needs Review", desc: "Items flagged for a human" },
      { icon: AlertTriangle, name: "Violations Center", desc: "Every detected violation in one place" },
      { icon: Megaphone, name: "Claim Reviews", desc: "Audit marketing claims for support" },
      { icon: Languages, name: "Language Review", desc: "Copy, tone & required disclosures" },
      { icon: Wrench, name: "Recommended Fixes", desc: "AI-suggested corrections" },
    ],
  },
  {
    label: "Compliance Intelligence",
    icon: Brain,
    tools: [
      { icon: Grid3x3, name: "Compliance Heatmaps", desc: "See where risk concentrates" },
      { icon: Brain, name: "Compliance Memory", desc: "Search past findings & decisions" },
      { icon: BarChart3, name: "Reports & Trends", desc: "Export and analyze over time" },
    ],
  },
  {
    label: "Regulatory Knowledge",
    icon: Scale,
    tools: [
      { icon: Scale, name: "Regulatory Library", desc: "Federal & state rules, searchable" },
      { icon: ShieldAlert, name: "FDA Recalls", desc: "Recent enforcement & recall data" },
      { icon: BookOpen, name: "Internal SOP", desc: "Your procedures, fully versioned" },
      { icon: FileText, name: "Approved Language", desc: "Pre-approved copy & terms" },
    ],
  },
  {
    label: "Suppliers",
    icon: Building2,
    tools: [
      { icon: Building2, name: "Vendor Directory", desc: "Manage suppliers & their status" },
      { icon: Trophy, name: "Vendor Scorecards", desc: "Compare compliance performance" },
      { icon: Boxes, name: "Supplier Portal", desc: "Let vendors submit for review" },
    ],
  },
  {
    label: "Operations",
    icon: Users,
    tools: [
      { icon: Users, name: "Teams & Roles", desc: "Assign specialists & permissions" },
      { icon: GitBranch, name: "Routing Rules", desc: "Automate who reviews what" },
      { icon: ShieldCheck, name: "Audit Trail", desc: "Every action, fully logged" },
      { icon: GraduationCap, name: "Training & Help", desc: "Guides, tours & support" },
    ],
  },
]

const STEPS: { title: string; body: string }[] = [
  { title: "Upload", body: "Drop in packaging artwork or a PDF — the AI reads it instantly." },
  { title: "Analyze", body: "Copy is extracted and checked against the relevant regulations." },
  { title: "Route & grade", body: "Findings are graded, scored, and routed to the right specialist automatically." },
  { title: "Fix & approve", body: "Act on cited fixes and approve with a full audit trail behind you." },
]

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-green-500/25 bg-green-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-green-400">
      {children}
    </span>
  )
}

function HeroPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-green-500/20 via-emerald-400/10 to-transparent blur-2xl" />
      <div className="relative rounded-2xl border border-border bg-card p-5 shadow-2xl shadow-black/10 ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Conversation Hearts 7pc</div>
            <div className="text-xs text-muted-foreground">Confectionery · Version 1</div>
          </div>
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300">Pending</span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-accent/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Grade</div>
            <div className="mt-0.5 text-2xl font-bold text-amber-500">C</div>
          </div>
          <div className="rounded-lg border border-border bg-accent/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk</div>
            <div className="mt-0.5 text-2xl font-bold text-foreground">55</div>
          </div>
          <div className="rounded-lg border border-border bg-accent/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fixes</div>
            <div className="mt-0.5 text-2xl font-bold text-green-400">3</div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">Nutrition claim needs substantiation</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">FDA</span>
                <span className="text-[10px] text-muted-foreground">Confidence 84%</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">Net quantity statement placement</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">FTC</span>
                <span className="text-[10px] text-muted-foreground">Confidence 91%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="pba-rainbow-dark inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-foreground">
            <Sparkles className="h-3 w-3 text-green-600" /> Powered by AI
          </span>
          <span className="text-[11px] text-muted-foreground">Analyzed in 6s</span>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-zinc-100 p-3 sm:p-4 lg:p-6">
      <div className="dark overflow-hidden rounded-3xl bg-background text-foreground shadow-2xl ring-1 ring-black/10">
      {/* Nav */}
      <header className="border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5 font-bold tracking-tight">
            <span className="flex items-center justify-center rounded-md bg-white p-1 ring-1 ring-black/5">
              <img
                src={`${basePath}/dollar-tree-logo.png`}
                alt="Dollar Tree"
                className="h-9 w-auto object-contain"
              />
            </span>
            <span className="hidden border-l border-border pl-2.5 text-sm sm:inline">Compliance Intelligence</span>
          </div>
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
            <a href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</a>
            <a href="#tools" className="transition-colors hover:text-foreground">Tools</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
          </nav>
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[32rem] w-[40rem] -translate-x-1/2 rounded-full bg-green-500/10 blur-[120px]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <span className="pba-rainbow-dark inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-green-600" />
              Dollar Tree · AI Compliance Intelligence
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Dollar Tree Compliance Intelligence,
              <span className="block text-green-400">built for the way your team works.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              The internal AI platform that reads your packaging artwork, analyzes it against
              the relevant federal regulations, and routes the work to the right specialist —
              designed to optimize associate productivity and compliance analysis across
              Dollar Tree, before anything reaches the shelf.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 font-semibold text-white shadow-lg shadow-green-600/25 transition-transform hover:scale-[1.02]"
              >
                Sign in to continue
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#capabilities"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 font-semibold text-foreground transition-colors hover:bg-accent"
              >
                Explore capabilities
              </a>
            </div>
            <div className="mt-8">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reviews against</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {AGENCIES.map((a) => (
                  <span
                    key={a}
                    className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <HeroPreview />
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border bg-white/[0.03]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 py-10 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-bold text-green-400 sm:text-3xl">{s.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="max-w-2xl">
            <Eyebrow>
              <Bot className="h-3.5 w-3.5" /> Agentic capabilities
            </Eyebrow>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              AI that does the compliance legwork for you
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Purpose-built AI handles intake, analysis, routing and escalation — so Dollar Tree
              associates spend their time on judgment calls, not busywork, and every review moves
              faster with fewer things slipping through.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => {
              const Icon = c.icon
              return (
                <div
                  key={c.title}
                  className="group rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-green-600/40 hover:shadow-lg hover:shadow-green-600/5"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-600/10 text-green-600 transition-colors group-hover:bg-green-600 group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Tools */}
      <section id="tools" className="scroll-mt-20 border-y border-border bg-white/[0.03]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="max-w-2xl">
            <Eyebrow>
              <Grid3x3 className="h-3.5 w-3.5" /> Everything in one place
            </Eyebrow>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              A complete compliance toolkit
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              From first upload to final approval, every workflow your compliance team needs —
              connected, searchable, and powered by the same AI engine.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {TOOL_GROUPS.map((g) => {
              const GroupIcon = g.icon
              return (
                <div key={g.label} className="rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600/10 text-green-600">
                      <GroupIcon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{g.label}</h3>
                  </div>
                  <ul className="mt-4 space-y-3">
                    {g.tools.map((t) => {
                      const Icon = t.icon
                      return (
                        <li key={t.name} className="flex items-start gap-3">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">{t.name}</div>
                            <div className="text-xs text-muted-foreground">{t.desc}</div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="max-w-2xl">
            <Eyebrow>
              <Route className="h-3.5 w-3.5" /> How it works
            </Eyebrow>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              From artwork to approval in four steps
            </h2>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative rounded-2xl border border-border bg-card p-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-sm font-bold text-white">
                  {i + 1}
                </div>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-20">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl bg-gradient-to-br from-green-600 to-emerald-700 px-8 py-16 text-center text-white shadow-xl">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-black/10 blur-3xl" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              Compliance intelligence, on autopilot
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/90">
              Sign in to start optimizing compliance analysis and team productivity with AI on your side.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-green-700 shadow-lg transition-transform hover:scale-[1.02]"
              >
                Sign in to continue
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/90">
              <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" /> Cited to regulation</span>
              <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" /> Full audit trail</span>
              <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" /> AI + human in the loop</span>
            </div>
            <p className="mt-6 text-xs text-white/75">Access restricted to Dollar Tree associates.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <img src={`${basePath}/dollar-tree-icon.png`} alt="" className="h-5 w-5 object-contain" />
            <span>Dollar Tree Compliance Intelligence</span>
          </div>
          <span>© {new Date().getFullYear()} Dollar Tree · Internal use only</span>
        </div>
      </footer>
      </div>
    </div>
  )
}
