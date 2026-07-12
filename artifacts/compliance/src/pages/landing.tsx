import { Link } from "wouter"
import { ScanText, Gauge, Sparkles, ArrowRight } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

const FEATURES = [
  {
    icon: ScanText,
    title: "OCR artwork intake",
    body: "Upload packaging artwork and the engine extracts copy, panels, and claims automatically.",
  },
  {
    icon: Sparkles,
    title: "Multi-agency AI review",
    body: "FDA, EPA, CPSC, FTC, and USDA rules checked in seconds, each finding cited to regulation.",
  },
  {
    icon: Gauge,
    title: "Risk grading & fixes",
    body: "Every package gets a grade, a risk score, and specific recommended fixes reviewers can act on.",
  },
]

export default function Landing() {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#0A1533] text-white">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-[#1F47FF]/30 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-cyan-500/10 blur-[100px]" />

      <div className="relative mx-auto flex min-h-[100dvh] max-w-6xl flex-col px-6">
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2.5 font-bold tracking-tight">
            <span className="flex items-center justify-center rounded-md bg-white p-1 ring-1 ring-black/5">
              <img
                src={`${basePath}/dollar-tree-logo.png`}
                alt="Dollar Tree"
                className="h-12 w-auto object-contain"
              />
            </span>
            <span className="border-l border-white/15 pl-2.5">Packaging Compliance AI</span>
          </div>
          <Link
            href="/sign-in"
            className="rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
          >
            Sign in
          </Link>
        </header>

        <main className="flex flex-1 flex-col justify-center py-12">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5B7BFF]" />
              Dollar Tree Compliance Platform
            </div>
            <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
              Ship compliant packaging,
              <span className="block bg-gradient-to-r from-[#7B93FF] to-cyan-300 bg-clip-text text-transparent">
                faster and with confidence.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/60">
              AI-assisted review for packaging artwork and copy. Detect regulatory violations,
              grade risk, and get cited fixes — before anything reaches the shelf.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-lg bg-[#1F47FF] px-6 py-3 font-semibold text-white shadow-lg shadow-[#1F47FF]/30 transition-transform hover:scale-[1.02]"
              >
                Sign in to continue
                <ArrowRight className="h-4 w-4" />
              </Link>
              <span className="text-sm text-white/40">Access restricted to Dollar Tree associates.</span>
            </div>
          </div>

          <div className="mt-16 grid gap-4 sm:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = f.icon
              return (
                <div
                  key={f.title}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1F47FF]/20 text-[#7B93FF]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-white/50">{f.body}</p>
                </div>
              )
            })}
          </div>
        </main>

        <footer className="py-6 text-sm text-white/30">
          {new Date().getFullYear()} Packaging Compliance AI · Internal use only
        </footer>
      </div>
    </div>
  )
}
