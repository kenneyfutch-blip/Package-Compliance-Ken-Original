import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync, mkdirSync } from "node:fs";

// ---- Content ----------------------------------------------------------------
const TITLE = "Packaging Compliance AI";
const SUBTITLE = "Comprehensive Capabilities Overview";
const INTRO =
  "An AI-powered enterprise platform that automates packaging & label compliance review — from artwork upload through AI analysis, human proofing, regulatory cross-referencing, and executive reporting — with full multi-tenant access control and a supplier collaboration portal.";

const sections = [
  {
    h: "AI Compliance Engine",
    items: [
      "Automated packaging/label compliance analysis with AI-flagged violations mapped to specific artwork regions",
      "Multi-provider AI support (OpenAI, Gemini, OpenRouter, Anthropic) with encrypted key storage and a single-active-model invariant",
      "Tiered AI orchestration (fast-triage vs. deep-reasoning models) with bounded automatic escalation for high-severity findings",
      "Background/asynchronous analysis jobs on a durable Postgres queue with retries and heartbeat-based recovery",
      "Legal guardrails — low-confidence AI findings are never surfaced as definitive violations (enforced in code, not prompts)",
      "AI usage & cost analytics via a per-call telemetry ledger with rate-card cost estimation",
    ],
  },
  {
    h: "Document & Artwork Processing",
    items: [
      "Direct-to-cloud artwork uploads (PDF, AI, INDD, PNG, JPG) via presigned URLs for large files",
      "OCR / document extraction with a provider-based architecture (OpenAI Vision default, Google Document AI selectable)",
      "Server-side PDF/artwork thumbnail rendering with caching",
      "Content-hash caching to avoid re-processing identical documents",
    ],
  },
  {
    h: "Proofing & Review Studio",
    items: [
      "Collaborative proofing workspace with pin/box markup, comments, @mentions, and approval decisions",
      "Full version control with append-only history, SHA-256 integrity hashing, and version restore",
      "AI-violation overlays anchored to model-provided bounding boxes",
      "Exportable proof PDFs with executive summary + embedded marked-up artwork, downloadable as named attachments",
      "Live reviewer presence and soft advisory review locks to prevent conflicting edits",
      "Concurrent-edit protection — reviewers can never silently overwrite each other's work",
    ],
  },
  {
    h: "Review Assignment & Workload Engine",
    items: [
      "Durable job queue with category-to-team routing rules",
      "SLA tracking, escalation stages, and monotonic escalation logic",
      "Specialist directory, workload balancing, and routing/escalation configuration",
      "Active-reviews dashboard unifying AI-review packages and specialist assignments",
      "Recurring review scheduling with deduplication",
    ],
  },
  {
    h: "Regulatory Intelligence",
    items: [
      "eCFR integration — weekly sync of curated federal regulation parts with semantic recall injected into AI analysis",
      "openFDA integration — recall lookups and per-category enforcement data",
      "Regulatory library, updates feed, and category-specific coverage",
      "Semantic search via pgvector — org- and supplier-scoped embeddings for compliance memory and regulation recall",
      "Self-hosted embedding generation (no external embedding dependency)",
    ],
  },
  {
    h: "Language & Claims Review",
    items: [
      "6-layer AI copy/language review with a quality scoring system",
      "Dedicated Claims Compliance Engine that auto-escalates high/critical findings to reasoning-tier AI",
      "Approved-language glossary with change-tracking audit trail, fed back into AI review",
    ],
  },
  {
    h: "Internal Standards & Documents",
    items: [
      "Internal Policy & Standards engine — org policies treated as first-class compliance rules",
      "SOP document management with full version lineage and server-side diffing",
      "Policy repository, glossary, and a unified Resource Center hub",
      "Version publishing with row-locking and uniqueness guarantees",
    ],
  },
  {
    h: "Supplier Collaboration",
    items: [
      "Dedicated supplier portal with strict data isolation — suppliers can never see each other's data",
      "Anti-spoofing enforcement on supplier-scoped operations",
      "Supplier submissions, scorecards, and status lifecycle management",
      "Vendor scorecards and supplier detail views",
    ],
  },
  {
    h: "Multi-Tenancy, Security & Access Control",
    items: [
      "Role-based access control (RBAC), code-as-source-of-truth, gating both navigation and API routes",
      "Full multi-tenant org isolation — operations data never leaks across tenants",
      "Clerk authentication with org provisioning and employees-only login enforcement",
      "Object-level authorization (IDOR/BOLA protection) — downloads are record-authorized, not just authenticated",
      "API hardening: rate limiting, upload allowlists, stored-XSS mitigation, Helmet headers, SSRF-validated URLs",
      "Append-only audit trail with archiving",
    ],
  },
  {
    h: "Analytics & Reporting",
    items: [
      "Executive dashboards and reports",
      "Trend analysis, heatmaps, and a violations center",
      "Vendor scorecards and usage analytics",
      "Role-aware, org-scoped dashboard aggregation with resilient per-widget loading",
    ],
  },
  {
    h: "Operations & Admin Console",
    items: [
      "Admin console for users, teams, departments, roles, and role reassignment",
      "Activity monitor, audit center, and system configuration",
      "AI provider/model management and integrations management",
      "Self-lockout guards and auth-cache invalidation on role changes",
    ],
  },
  {
    h: "Onboarding & Support",
    items: [
      "In-app Training & Help center: guided tours, user guides, FAQ, videos, best practices",
      "Server-saved training progress",
      "Built-in support ticketing",
      "AI Assistant side panel — a conversational 'find the right tool' helper with a server-side tool catalog",
    ],
  },
  {
    h: "Engineering Highlights",
    items: [
      "Stack: React + TypeScript + Vite, Node.js + Express, PostgreSQL + Drizzle ORM + pgvector, Clerk auth, cloud object storage",
      "pnpm monorepo with OpenAPI-driven, type-safe client codegen (orval)",
      "Scalability hardening: single-flight TTL caches, clamped pagination, load-tested throughput baselines",
      "Notifications with per-user read/archive overlays over org-wide broadcasts",
      "Prod-safe vs. dev-only seed separation",
    ],
  },
];

// ---- Layout -----------------------------------------------------------------
const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

const NAVY = rgb(0.05, 0.13, 0.25);
const BLACK = rgb(0, 0, 0);
const BLUE = rgb(0.02, 0.42, 0.78);
const GRAY = rgb(0.28, 0.32, 0.38);
const LIGHT = rgb(0.6, 0.64, 0.7);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

let page = doc.addPage([PAGE_W, PAGE_H]);
let y = PAGE_H - MARGIN;

function newPage() {
  page = doc.addPage([PAGE_W, PAGE_H]);
  y = PAGE_H - MARGIN;
}
function ensure(space) {
  if (y - space < MARGIN) newPage();
}
function wrap(text, f, size, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (f.widthOfTextAtSize(test, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function drawText(text, f, size, color, x, maxW, lineGap = 3) {
  const lines = wrap(text, f, size, maxW);
  for (const ln of lines) {
    ensure(size + lineGap);
    page.drawText(ln, { x, y: y - size, size, font: f, color });
    y -= size + lineGap;
  }
}

// ---- Header band ------------------------------------------------------------
page.drawRectangle({ x: 0, y: PAGE_H - 132, width: PAGE_W, height: 132, color: BLACK });
page.drawRectangle({ x: 0, y: PAGE_H - 136, width: PAGE_W, height: 4, color: BLUE });
page.drawText(TITLE, { x: MARGIN, y: PAGE_H - 66, size: 26, font: bold, color: rgb(1, 1, 1) });
page.drawText(SUBTITLE, { x: MARGIN, y: PAGE_H - 92, size: 13, font, color: rgb(0.75, 0.85, 0.95) });
page.drawText("Project portfolio summary", {
  x: MARGIN, y: PAGE_H - 114, size: 10, font, color: rgb(0.6, 0.72, 0.85),
});
y = PAGE_H - 132 - 28;

// Intro
drawText(INTRO, font, 11, GRAY, MARGIN, CONTENT_W, 5);
y -= 14;

// ---- Sections ---------------------------------------------------------------
for (const sec of sections) {
  ensure(46);
  // section heading
  page.drawText(sec.h, { x: MARGIN, y: y - 14, size: 14, font: bold, color: NAVY });
  y -= 20;
  page.drawRectangle({ x: MARGIN, y: y, width: CONTENT_W, height: 1.2, color: rgb(0.87, 0.9, 0.94) });
  y -= 12;
  for (const it of sec.items) {
    ensure(16);
    const bulletY = y - 10;
    page.drawCircle({ x: MARGIN + 3, y: bulletY + 1.5, size: 1.8, color: BLUE });
    const startY = y;
    // draw wrapped text indented
    const lines = wrap(it, font, 10.5, CONTENT_W - 16);
    for (let i = 0; i < lines.length; i++) {
      ensure(10.5 + 3);
      page.drawText(lines[i], { x: MARGIN + 14, y: y - 10.5, size: 10.5, font, color: GRAY });
      y -= 10.5 + 3;
    }
    y -= 4;
    void startY;
  }
  y -= 10;
}

// ---- Footer on every page ---------------------------------------------------
const pages = doc.getPages();
pages.forEach((p, i) => {
  p.drawText(`Packaging Compliance AI  ·  Capabilities Overview`, {
    x: MARGIN, y: 30, size: 8, font, color: LIGHT,
  });
  const num = `${i + 1} / ${pages.length}`;
  p.drawText(num, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(num, 8), y: 30, size: 8, font, color: LIGHT });
});

const bytes = await doc.save();
mkdirSync("attached_assets", { recursive: true });
const out = "attached_assets/Packaging-Compliance-AI-Capabilities.pdf";
writeFileSync(out, bytes);
console.log("WROTE", out, bytes.length, "bytes,", pages.length, "pages");
