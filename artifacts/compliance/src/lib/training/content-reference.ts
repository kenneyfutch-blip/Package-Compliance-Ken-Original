import type { FaqCategory, GlossaryTerm, ReleaseNote } from "./content-types"

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    category: "Getting Started",
    items: [
      {
        q: "Why is my dashboard empty?",
        a: "My Dashboard and My Work are scoped to you personally. Empty cards mean nothing is currently assigned to you — not that something is broken. Once a package is assigned to you it appears here.",
      },
      {
        q: "How do I change what I see in the sidebar?",
        a: "The sidebar reflects your role's permissions. You can't add tools you lack access to, but you can star tools to pin them to the favorites menu, and collapse sections you don't use.",
      },
      {
        q: "What do the different roles mean?",
        a: "Roles range from Platform Administrator and Compliance Director down to Designer, Supplier User, and Read Only. Each grants a specific set of permissions. See the User Guide → Getting Started for the full breakdown.",
      },
    ],
  },
  {
    category: "Packages & Uploads",
    items: [
      {
        q: "Which file types can I upload?",
        a: "Artwork files including PDF, Adobe Illustrator (.ai), InDesign (.indd), and common image formats. There is a maximum file size; oversized files show a friendly error rather than failing silently.",
      },
      {
        q: "I got a duplicate warning — what should I do?",
        a: "The SKU or UPC matches an existing package. SKUs and UPCs aren't strictly unique, so the warning is a soft guard. Confirm this is genuinely a new package before choosing to proceed.",
      },
      {
        q: "Why can't I run analysis right after uploading?",
        a: "Text extraction needs to finish first. Once Document AI has pulled the on-pack text, analysis has something to work against.",
      },
    ],
  },
  {
    category: "AI & Analysis",
    items: [
      {
        q: "How much should I trust an AI finding?",
        a: "Treat findings as a thorough first pass, not a final verdict. Each finding shows a confidence level, and low-confidence or uncertain items are flagged for review rather than presented as definitive violations. The final decision is always yours.",
      },
      {
        q: "Why did a finding change after I re-ran analysis?",
        a: "Analysis reflects the current regulations, internal standards, and AI model. When any of those change, re-running produces updated results — that's expected and keeps findings fresh.",
      },
      {
        q: "What does severity mean versus confidence?",
        a: "Severity is how serious the issue would be if real (e.g. critical vs. minor). Confidence is how sure the engine is that it found a real issue. A finding can be high-severity but low-confidence, which is exactly when human review matters most.",
      },
    ],
  },
  {
    category: "Reviews",
    items: [
      {
        q: "Can two people review the same package at once?",
        a: "You'll see reviewer presence and a soft lock warning if someone else is already in a package. The platform also prevents two reviewers from silently overwriting each other's decision.",
      },
      {
        q: "How are review deadlines set?",
        a: "Deadlines default from the package's priority SLA — Critical 12h, High 24h, Normal 48h, Low 96h from assignment. A manager can override the due date when assigning a single package.",
      },
      {
        q: "What happens if a review goes overdue?",
        a: "Overdue reviews are flagged as at-risk or breached on the Workload & SLA view and escalate automatically so they don't stall.",
      },
    ],
  },
  {
    category: "Suppliers",
    items: [
      {
        q: "Can suppliers see each other's data?",
        a: "No. Supplier Users only ever see their own packages and submissions. Isolation between suppliers is enforced on the server, not just hidden in the UI.",
      },
      {
        q: "How does a supplier fix a rejected package?",
        a: "The supplier is notified of the required changes and uploads a corrected version against the same package, which keeps the version history intact.",
      },
    ],
  },
  {
    category: "Account & Access",
    items: [
      {
        q: "I see 'No access' on a page — why?",
        a: "Your role doesn't include the permission that page requires. Ask an administrator to review your role assignment if you believe you should have access.",
      },
      {
        q: "How do I get my role or team changed?",
        a: "Administrators manage roles and team assignments. File a support request from Contact Support if you're not sure who to ask.",
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Platform Glossary — terms specific to using the platform (distinct from the
// approved-language/compliance glossary under Resources).
// ---------------------------------------------------------------------------

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: "Package",
    definition:
      "The core record for a single piece of product packaging under review — its artwork, extracted text, findings, reviews, and decision.",
    category: "Core",
    related: ["Extraction", "Review"],
  },
  {
    term: "Extraction",
    definition:
      "The automatic reading of on-pack text (and its position) from uploaded artwork, performed by Document AI so analysis and reviewers can work against the actual copy.",
    category: "Core",
  },
  {
    term: "Finding",
    definition:
      "A single potential compliance issue the AI engine surfaces, with a severity, confidence, the exact on-pack text, a suggested fix, and a citation.",
    category: "AI & Analysis",
    related: ["Severity", "Confidence", "Citation"],
  },
  {
    term: "Severity",
    definition:
      "How serious a finding would be if confirmed — for example critical, high, medium, or minor.",
    category: "AI & Analysis",
    related: ["Finding", "Confidence"],
  },
  {
    term: "Confidence",
    definition:
      "How sure the AI engine is that a finding is real. Low-confidence findings are flagged for human review, never presented as definitive violations.",
    category: "AI & Analysis",
    related: ["Finding", "Severity"],
  },
  {
    term: "Citation",
    definition:
      "The specific regulation, standard, or approved-language entry a finding maps to, linked so you can verify it.",
    category: "AI & Analysis",
    related: ["Finding", "Regulation"],
  },
  {
    term: "Violation",
    definition:
      "A finding that has been confirmed as a genuine compliance issue requiring correction.",
    category: "AI & Analysis",
    related: ["Finding"],
  },
  {
    term: "Review",
    definition:
      "The human step where a reviewer works through a package's findings and records an approve or reject decision.",
    category: "Reviews",
    related: ["Reviewer presence", "SLA"],
  },
  {
    term: "Reviewer presence",
    definition:
      "A live indicator of who else is currently viewing or working a package, paired with a soft lock that warns before overlapping work.",
    category: "Reviews",
    related: ["Review", "Soft lock"],
  },
  {
    term: "Soft lock",
    definition:
      "An advisory lock that warns a second reviewer that a package is already being worked, without hard-blocking them.",
    category: "Reviews",
    related: ["Reviewer presence"],
  },
  {
    term: "SLA",
    definition:
      "Service-level agreement — the time window a review should be completed in, derived from the package's priority (Critical 12h, High 24h, Normal 48h, Low 96h).",
    category: "Reviews",
    related: ["Escalation", "Workload"],
  },
  {
    term: "Escalation",
    definition:
      "The automatic bump an overdue review receives so it gets attention rather than stalling.",
    category: "Reviews",
    related: ["SLA"],
  },
  {
    term: "Workload",
    definition:
      "The number and weight of reviews assigned to a person or team, used to balance new assignments.",
    category: "Team Management",
    related: ["SLA", "Assignment"],
  },
  {
    term: "Assignment",
    definition:
      "Routing a package to a team and reviewer, by category and capacity, with a deadline.",
    category: "Team Management",
    related: ["Workload", "SLA"],
  },
  {
    term: "Regulation",
    definition:
      "A government rule (FDA, EPA, CPSC, FTC, or state) in the knowledge base that packaging is checked against.",
    category: "Regulatory",
    related: ["Internal standard", "Citation"],
  },
  {
    term: "Internal standard",
    definition:
      "A company-specific policy or standard that participates in reviews with the same authority as a government regulation.",
    category: "Regulatory",
    related: ["Regulation", "SOP"],
  },
  {
    term: "SOP",
    definition:
      "Standard operating procedure — a documented internal process, versioned and comparable, with lapse warnings for its owner.",
    category: "Regulatory",
    related: ["Internal standard"],
  },
  {
    term: "Approved language",
    definition:
      "Pre-vetted on-pack wording for claims and statements that keeps copy consistent and legally defensible.",
    category: "Language",
    related: ["Glossary"],
  },
  {
    term: "Role",
    definition:
      "The named set of permissions assigned to a user (e.g. Compliance Specialist, Designer, Supplier User) that controls what they can see and do.",
    category: "Administration",
    related: ["Permission"],
  },
  {
    term: "Permission",
    definition:
      "A specific capability (like 'view packages' or 'manage users') that a role grants. Both navigation and server actions are gated on permissions.",
    category: "Administration",
    related: ["Role"],
  },
  {
    term: "Audit trail",
    definition:
      "The append-only record of who did what and when across the platform, used for accountability and compliance evidence.",
    category: "Administration",
  },
  {
    term: "Supplier User",
    definition:
      "An external user whose access is limited to their own supplier's packages and submissions.",
    category: "Suppliers",
    related: ["Supplier Portal"],
  },
  {
    term: "Supplier Portal",
    definition:
      "The scoped area where suppliers submit packaging and respond to review feedback without seeing anyone else's data.",
    category: "Suppliers",
    related: ["Supplier User"],
  },
]

// ---------------------------------------------------------------------------
// Release Notes
// ---------------------------------------------------------------------------

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "2.6",
    date: "July 2026",
    title: "Training Center & in-platform support",
    summary:
      "A complete learning hub and a functional support inbox, built right into the platform.",
    changes: [
      { type: "feature", text: "New Training & Help section: Getting Started, User Guide, Interactive Walkthroughs, Video Tutorials, Best Practices, Compliance Academy, FAQ, Release Notes, and Platform Glossary." },
      { type: "feature", text: "Live in-app product tours that highlight real parts of the workspace." },
      { type: "feature", text: "Per-user learning progress that persists across devices." },
      { type: "feature", text: "Contact Support files a real request, notifies admins in-app, and gives admins an inbox to respond." },
    ],
  },
  {
    version: "2.5",
    date: "June 2026",
    title: "Review deadlines & assignment polish",
    summary:
      "More control over review timing and clearer assignment workflows.",
    changes: [
      { type: "feature", text: "Manual due-date override when assigning a single review, on top of the priority SLA default." },
      { type: "improvement", text: "Clearer SLA status (at-risk vs. breached) on the Workload & SLA view." },
      { type: "fix", text: "Corrected an edge case where editing an assignment could shift its deadline unintentionally." },
    ],
  },
  {
    version: "2.4",
    date: "May 2026",
    title: "AI accuracy & guardrails",
    summary:
      "Findings you can trust, with human judgment kept firmly in the loop.",
    changes: [
      { type: "improvement", text: "Low-confidence and uncertain findings are now clearly surfaced for review rather than shown as definitive violations." },
      { type: "improvement", text: "Higher-risk packages escalate to a stronger reasoning model automatically." },
      { type: "fix", text: "The Findings panel no longer displays suggested corrections for dismissed items." },
    ],
  },
  {
    version: "2.3",
    date: "April 2026",
    title: "Resource Center & internal standards",
    summary:
      "One place for every reference, with company standards treated as first-class rules.",
    changes: [
      { type: "feature", text: "Unified Resource Center bringing regulations, internal SOPs, policies, and the glossary together." },
      { type: "feature", text: "Internal standards participate in reviews with the same authority as government regulations." },
      { type: "improvement", text: "SOP owners are warned before a procedure's effective date lapses." },
    ],
  },
  {
    version: "2.2",
    date: "March 2026",
    title: "Scale & reliability",
    summary: "Faster pages and steadier performance as usage grows.",
    changes: [
      { type: "improvement", text: "Faster list pages with consistent pagination that never drops or duplicates rows." },
      { type: "improvement", text: "Caching for AI and dashboard results to keep heavy pages responsive." },
      { type: "fix", text: "Hardened the health heartbeat so a database hiccup can't crash the process." },
    ],
  },
]
