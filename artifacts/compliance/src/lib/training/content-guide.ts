import {
  Rocket,
  Box,
  Brain,
  ClipboardCheck,
  Scale,
  Users,
  BarChart3,
  Settings,
} from "lucide-react"
import type { GuideSection } from "./content-types"

// The comprehensive User Guide, organized by functional area. Articles are
// searchable on the User Guide page; `audience` badges flag role-specific ones.
export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Rocket,
    summary: "Orientation, roles, and the shape of the platform.",
    articles: [
      {
        key: "guide:overview",
        title: "What the platform does",
        body: [
          "Packaging Compliance AI reviews product packaging against federal regulations, internal company standards, and approved language before it goes to print or market.",
          "Work flows through a simple lifecycle: a package is created from artwork, its text is extracted, the AI engine analyzes it for compliance issues, a human reviewer confirms and decides, and every step is captured in an audit trail.",
          "The goal is speed with a safety net: the AI does the heavy lifting of scanning against thousands of rules, while people make the final, accountable decisions.",
        ],
      },
      {
        key: "guide:navigation",
        title: "Finding your way around",
        body: [
          "The left sidebar groups every tool into labeled sections. The 'My Work' section at the top is scoped to you personally; everything below it is organized by function.",
          "Use global search in the top bar to jump to any package, SKU, or vendor. Star frequently used tools to pin them to the favorites menu.",
          "The notification bell surfaces review assignments, SLA warnings, and replies to support requests.",
        ],
      },
      {
        key: "guide:roles",
        title: "Roles and what they can do",
        body: [
          "Your role determines which sections and actions you can access. Roles range from Platform Administrator and Compliance Director down to Designer, Supplier User, and Read Only.",
          "If a page shows 'No access', your role doesn't include that permission — contact an administrator to review your role assignment.",
          "Supplier Users are external and only ever see their own packages and submissions.",
        ],
      },
    ],
  },
  {
    id: "packages",
    title: "Packages & Uploads",
    icon: Box,
    summary: "Creating and managing the records everything revolves around.",
    articles: [
      {
        key: "guide:create-package",
        title: "Creating a package",
        audience: "Designers, Packaging Managers",
        body: [
          "Use 'New Package' to upload artwork (PDF, AI, INDD, or image files). Provide the product name, SKU/UPC, category, and supplier.",
          "Category matters: it determines which regulations apply during analysis, so choose the most specific one.",
          "If the SKU or UPC matches an existing record, a soft duplicate warning appears. Confirm it's genuinely new before overriding.",
        ],
      },
      {
        key: "guide:extraction",
        title: "Text extraction",
        body: [
          "Once artwork is uploaded, Document AI extracts the on-pack text along with its position, so the AI engine and reviewers can work against the actual copy.",
          "Extraction runs automatically. Wait for it to complete before running analysis — analyzing an empty package produces nothing useful.",
        ],
      },
      {
        key: "guide:package-states",
        title: "Package states",
        body: [
          "Packages move through Active, Approved, Rejected, and Archived. Each state has its own view under the Packages section.",
          "A rejected package can be corrected and re-submitted against the same record so the version history stays linked.",
        ],
      },
    ],
  },
  {
    id: "ai-analysis",
    title: "AI Analysis",
    icon: Brain,
    summary: "How the engine finds issues and how to read them.",
    articles: [
      {
        key: "guide:how-ai-works",
        title: "How AI analysis works",
        body: [
          "The engine checks each package against federal regulations, internal standards, approved language, and marketing-claim rules. It runs on upload and can be re-run on demand.",
          "Higher-risk or uncertain packages can be escalated to a stronger reasoning model automatically, so difficult cases get more scrutiny.",
        ],
      },
      {
        key: "guide:reading-findings",
        title: "Reading findings",
        body: [
          "Every finding shows a severity, the rule it maps to, the exact on-pack text, and a suggested correction. Citations link back to the source regulation or standard.",
          "Findings also carry a confidence level. Low-confidence or uncertain findings are surfaced as items to review, never as definitive violations — the platform will not present an uncertain result as a hard fact.",
        ],
      },
      {
        key: "guide:acting-findings",
        title: "Acting on findings",
        audience: "Reviewers",
        body: [
          "Confirm genuine issues, dismiss false positives with a short note, and convert findings into required fixes where appropriate.",
          "Your actions become part of the package's review record and the audit trail, so document your reasoning as you go.",
        ],
      },
    ],
  },
  {
    id: "reviews",
    title: "Reviews & Decisions",
    icon: ClipboardCheck,
    summary: "The reviewer workflow, from assignment to decision.",
    articles: [
      {
        key: "guide:my-work",
        title: "My Work",
        body: [
          "My Dashboard, My Reviews, and My Tasks show only what's assigned to you, ordered by urgency and due date. If they're empty, nothing is currently assigned to you.",
        ],
      },
      {
        key: "guide:review-workspace",
        title: "The review workspace",
        audience: "Reviewers",
        body: [
          "The workspace puts artwork, extracted text, AI findings, and regulation references on one screen. Add your own findings and annotations directly on the artwork.",
          "Reviewer presence shows who else is looking at a package, and soft review locks warn you before two people work the same item — they warn rather than block.",
        ],
      },
      {
        key: "guide:decisions",
        title: "Recording decisions",
        audience: "Reviewers",
        body: [
          "Approve or reject each package. Rejections require a reason so the supplier knows exactly what to change.",
          "Concurrent edits are protected: the platform prevents two reviewers from silently overwriting each other's decision.",
        ],
      },
    ],
  },
  {
    id: "regulatory",
    title: "Regulatory & Standards",
    icon: Scale,
    summary: "The knowledge base, live intelligence, and internal standards.",
    articles: [
      {
        key: "guide:knowledge-base",
        title: "The regulatory knowledge base",
        body: [
          "Search federal regulations by product category, read the underlying text, and follow citations. Regulations are kept current through a scheduled sync.",
          "Live FDA recall and source intelligence is available alongside the static library.",
        ],
      },
      {
        key: "guide:internal-standards",
        title: "Internal standards & SOPs",
        body: [
          "Company policies and standards participate in reviews with the same authority as government regulations. SOP documents carry full version history and comparison.",
          "SOP owners are warned before a procedure's effective date lapses so standards never quietly expire.",
        ],
      },
      {
        key: "guide:approved-language",
        title: "Approved language & glossary",
        body: [
          "Approved-language entries keep on-pack claims consistent and defensible; the language engine checks packaging copy against them.",
          "Entries are versioned and retired rather than deleted, preserving the change history.",
        ],
      },
    ],
  },
  {
    id: "partners",
    title: "Suppliers & Partners",
    icon: Users,
    summary: "Working with external suppliers and vendors.",
    articles: [
      {
        key: "guide:supplier-portal",
        title: "The Supplier Portal",
        audience: "Suppliers",
        body: [
          "Suppliers submit artwork and product details through the portal and see only their own records — one supplier's data can never leak to another.",
          "When a reviewer requests changes, the supplier is notified and re-submits a corrected version against the same package.",
        ],
      },
      {
        key: "guide:scorecards",
        title: "Vendor scorecards",
        audience: "Managers",
        body: [
          "Scorecards summarize each vendor's compliance track record so recurring issues are easy to spot and coach.",
        ],
      },
    ],
  },
  {
    id: "analytics",
    title: "Reports & Analytics",
    icon: BarChart3,
    summary: "Turning activity into insight.",
    articles: [
      {
        key: "guide:reports",
        title: "Reports",
        body: [
          "Compliance reports cover operational detail; executive reports roll the numbers up for leadership. Trend analysis and heatmaps show where risk concentrates.",
        ],
      },
      {
        key: "guide:ai-cost",
        title: "AI usage & cost",
        audience: "Admins",
        body: [
          "The AI cost dashboard tracks per-request spend, volume, model and tier mix, and success rates, so AI usage stays visible and accountable.",
        ],
      },
    ],
  },
  {
    id: "administration",
    title: "Administration",
    icon: Settings,
    summary: "Users, roles, teams, and system health.",
    articles: [
      {
        key: "guide:users-roles",
        title: "Users, roles & teams",
        audience: "Admins",
        body: [
          "Administrators manage users, change roles, and assign people to teams. Role and team changes take effect immediately and are captured in the audit trail.",
        ],
      },
      {
        key: "guide:audit",
        title: "Audit & activity",
        audience: "Admins",
        body: [
          "The Audit Center records who did what and when, as an append-only trail. The Activity Monitor shows live platform activity.",
        ],
      },
      {
        key: "guide:system-health",
        title: "System health",
        audience: "Admins",
        body: [
          "Queue & Health shows pending and stalled jobs and overall service status, so operational issues surface before they affect users.",
        ],
      },
    ],
  },
]
