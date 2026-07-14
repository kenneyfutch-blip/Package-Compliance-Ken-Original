import { Link } from "wouter"
import {
  ScanText, ShieldCheck, Gauge, Brain, Sparkles, Route, Wrench, Languages,
  Megaphone, AlertTriangle, Grid3x3, Scale, ShieldAlert, BookOpen, Building2,
  Trophy, Users, GitBranch, FileText, BarChart3, GraduationCap, Bot,
  ArrowRight, Upload, Inbox, ListChecks, Check, Boxes, Search, SlidersHorizontal,
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

const SHOWCASE: { badge: string | null; title: string; cat: string; grade: string; gradeColor: string; agency: string }[] = [
  { badge: "New", title: "Conversation Hearts 7pc", cat: "Confectionery", grade: "C", gradeColor: "text-amber-500", agency: "FDA" },
  { badge: "Updated", title: "Garden Hose 50 ft", cat: "Home & Garden", grade: "A", gradeColor: "text-green-400", agency: "CPSC" },
  { badge: null, title: "Bubble Bath 24 oz", cat: "Personal Care", grade: "B", gradeColor: "text-green-400", agency: "FTC" },
]

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-green-500/25 bg-green-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-green-400">
      {children}
    </span>
  )
}

function MiniCard({ item }: { item: (typeof SHOWCASE)[number] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative flex h-24 items-center justify-center bg-gradient-to-br from-accent/60 to-background">
        {item.badge && (
          <span className="absolute left-2 top-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground ring-1 ring-border">
            {item.badge}
          </span>
        )}
        <span className={`text-3xl font-bold ${item.gradeColor}`}>{item.grade}</span>
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-semibold text-foreground">{item.title}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">{item.agency}</span>
          <span className="text-xs text-muted-foreground">{item.cat}</span>
        </div>
      </div>
    </div>
  )
}

function ProductPanel() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-20">
      <div className="rounded-3xl border border-border bg-gradient-to-b from-card to-background p-3 shadow-2xl shadow-black/40 sm:p-4">
        <div className="overflow-hidden rounded-2xl border border-border bg-background">
          {/* Window top bar */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center rounded-md bg-white p-0.5 ring-1 ring-black/5">
                <img src={`${basePath}/dollar-tree-icon.png`} alt="" className="h-5 w-5 object-contain" />
              </span>
              <span className="hidden text-sm font-bold text-foreground sm:inline">Compliance Intelligence</span>
            </div>
            <div className="ml-2 hidden items-center gap-4 text-xs font-medium md:flex">
              <span className="text-foreground">Dashboard</span>
              <span className="text-muted-foreground">Packages</span>
              <span className="text-muted-foreground">Suppliers</span>
            </div>
            <div className="ml-auto flex flex-1 items-center gap-2 sm:max-w-xs">
              <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-accent/40 px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Search packages…</span>
              </div>
            </div>
            <span className="h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-green-500 to-emerald-700" />
          </div>

          {/* Category columns */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-6 px-6 py-6 sm:grid-cols-4">
            {TOOL_GROUPS.slice(0, 4).map((g) => (
              <div key={g.label}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
                <ul className="mt-3 space-y-1.5">
                  {g.tools.slice(0, 5).map((t) => (
                    <li key={t.name} className="truncate text-sm font-medium text-foreground/90">{t.name}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Filter row */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3">
            <div className="flex items-center gap-1 rounded-full border border-border bg-accent/40 p-0.5 text-xs font-medium">
              <span className="rounded-full bg-background px-2.5 py-1 text-foreground shadow-sm">Latest</span>
              <span className="px-2.5 py-1 text-muted-foreground">Most flagged</span>
              <span className="px-2.5 py-1 text-muted-foreground">Top rated</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Filter
            </span>
          </div>

          {/* Thumbnails */}
          <div className="grid grid-cols-1 gap-4 px-6 pb-6 sm:grid-cols-3">
            {SHOWCASE.map((item) => (
              <MiniCard key={item.title} item={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <div className="dark min-h-[100dvh] bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-30 px-6 pt-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 rounded-full border border-border/70 bg-card/80 py-2 pl-4 pr-2 shadow-lg shadow-black/30 backdrop-blur-md">
          <div className="flex items-center gap-2 font-bold tracking-tight">
            <span className="flex items-center justify-center rounded-md bg-white p-0.5 ring-1 ring-black/5">
              <img src={`${basePath}/dollar-tree-icon.png`} alt="Dollar Tree" className="h-6 w-6 object-contain" />
            </span>
            <span className="hidden text-sm sm:inline">Compliance Intelligence</span>
          </div>
          <nav className="flex items-center gap-1 text-sm font-medium">
            <a href="#capabilities" className="hidden rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:inline">Capabilities</a>
            <a href="#how" className="hidden rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:inline">How it works</a>
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-4 py-1.5 font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[32rem] w-[46rem] -translate-x-1/2 rounded-full bg-green-500/10 blur-[130px]" />
        <div className="relative mx-auto max-w-3xl px-6 pb-14 pt-16 text-center lg:pt-20">
          {/* Icon mark */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-xl ring-1 ring-black/5">
            <img src={`${basePath}/dollar-tree-icon.png`} alt="" className="h-10 w-10 object-contain" />
          </div>

          <div className="mt-8 flex justify-center">
            <span className="pba-rainbow-dark inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-green-600" />
              Dollar Tree · AI Compliance Intelligence
            </span>
          </div>

          <h1 className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Catch compliance issues
            <span className="block text-green-400">before they reach the shelf.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            The internal AI platform that reads your packaging artwork, checks it against the
            relevant federal regulations, and routes each review to the right specialist — built to
            speed up compliance analysis and associate productivity across Dollar Tree.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          {/* Reviews against */}
          <div className="mt-14">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reviews against</div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
              {AGENCIES.map((a) => (
                <span key={a} className="text-sm font-semibold text-muted-foreground">{a}</span>
              ))}
            </div>
          </div>
        </div>

        <ProductPanel />
      </section>

      {/* Stats */}
      <section className="border-y border-border bg-muted/40">
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
      <section id="capabilities" className="scroll-mt-24">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
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
      <section id="tools" className="scroll-mt-24 border-y border-border bg-muted/40">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
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
      <section id="how" className="scroll-mt-24">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
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
  )
}
