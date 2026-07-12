import type {
  ChecklistStep,
  Walkthrough,
  VideoTutorial,
  BestPractice,
  AcademyCourse,
} from "./content-types"

// ---------------------------------------------------------------------------
// Getting Started — onboarding checklist
// ---------------------------------------------------------------------------

export const GETTING_STARTED_CHECKLIST: ChecklistStep[] = [
  {
    key: "checklist:tour",
    title: "Take the platform orientation tour",
    description:
      "A two-minute guided sweep of the sidebar, search, favorites, and notifications so you know where everything lives.",
    cta: "Launch tour",
  },
  {
    key: "checklist:profile",
    title: "Review your profile and role",
    description:
      "Confirm your name, team, and role are correct. Your role controls what you can see and do across the platform.",
    href: "/account",
    cta: "Open account",
  },
  {
    key: "checklist:upload",
    title: "Create your first package",
    description:
      "Upload artwork or packaging copy to create a package record — the unit everything else revolves around.",
    href: "/upload",
    cta: "New package",
  },
  {
    key: "checklist:analyze",
    title: "Run an AI compliance analysis",
    description:
      "Let the AI engine scan a package against federal regulations, internal standards, and approved language, then read the findings.",
    href: "/ai/violations",
    cta: "View violations",
  },
  {
    key: "checklist:review",
    title: "Complete a review and record a decision",
    description:
      "Work a package through the review workspace and approve or reject it with documented reasoning.",
    href: "/reviews",
    cta: "My reviews",
  },
  {
    key: "checklist:favorites",
    title: "Star the tools you use most",
    description:
      "Hover any sidebar item and click the star. Your favorites appear in the top-bar menu for one-click access.",
  },
]

// ---------------------------------------------------------------------------
// Interactive Walkthroughs — illustrated step-by-step guides. A few also expose
// a live in-app tour via liveTourId (see lib/training/tours.ts).
// ---------------------------------------------------------------------------

export const WALKTHROUGHS: Walkthrough[] = [
  {
    key: "guide:platform-orientation",
    title: "Platform orientation",
    description:
      "Get oriented in the workspace: navigation, search, favorites, and notifications.",
    audience: "Everyone",
    estMinutes: 2,
    liveTourId: "platform-orientation",
    steps: [
      {
        title: "Scan the sidebar",
        detail:
          "The left sidebar groups every tool into labeled sections — My Work, Compliance, Products, Partners, Analytics, and Training & Help. Sections expand and collapse to keep the list short.",
      },
      {
        title: "Use global search",
        detail:
          "The search box in the top bar jumps you straight to any package, SKU, or vendor from anywhere in the app.",
      },
      {
        title: "Set up favorites",
        detail:
          "Hover a sidebar item and click the star to pin it. Pinned tools appear in the star menu in the top bar.",
      },
      {
        title: "Check notifications",
        detail:
          "The bell shows review assignments, SLA warnings, and support replies. The dot means you have unread items.",
      },
    ],
  },
  {
    key: "guide:first-review",
    title: "Complete your first review",
    description:
      "Take a package from assigned to a documented approve/reject decision.",
    audience: "Reviewers",
    estMinutes: 6,
    relatedHref: "/reviews",
    liveTourId: "finding-your-work",
    steps: [
      {
        title: "Open My Reviews",
        detail:
          "Start in the My Work section and open My Reviews to see packages assigned to you, ordered by urgency and due date.",
      },
      {
        title: "Enter the review workspace",
        detail:
          "Click a package to open the review workspace. The artwork, extracted text, AI findings, and regulation references are all on one screen.",
      },
      {
        title: "Work the findings",
        detail:
          "Go through each AI finding. Confirm real issues, dismiss false positives with a note, and add your own findings where needed.",
      },
      {
        title: "Record a decision",
        detail:
          "When you're done, approve or reject the package. Rejections require a reason so the supplier knows exactly what to fix.",
      },
    ],
  },
  {
    key: "guide:upload-package",
    title: "Upload and set up a package",
    description:
      "Create a clean package record so AI analysis and reviews have everything they need.",
    audience: "Designers, Packaging Managers",
    estMinutes: 4,
    relatedHref: "/upload",
    steps: [
      {
        title: "Open New Package",
        detail:
          "Use the New Package button in the top bar or the Home section. Upload artwork files (PDF, AI, INDD, or images).",
      },
      {
        title: "Fill in the essentials",
        detail:
          "Add the product name, SKU/UPC, category, and the supplier. Category drives which regulations apply, so pick carefully.",
      },
      {
        title: "Watch for duplicate warnings",
        detail:
          "If the SKU or UPC already exists, you'll see a soft warning. Confirm it's genuinely a new package before overriding.",
      },
      {
        title: "Let extraction run",
        detail:
          "Document AI extracts the on-pack text automatically. Once it finishes, the package is ready for AI analysis and review.",
      },
    ],
  },
  {
    key: "guide:ai-analysis",
    title: "Run and read AI analysis",
    description:
      "Understand how the AI engine flags issues and how much to trust each finding.",
    audience: "Reviewers, Managers",
    estMinutes: 5,
    relatedHref: "/ai/violations",
    steps: [
      {
        title: "Trigger analysis",
        detail:
          "Analysis runs on upload and can be re-run from the package. It checks federal regulations, internal standards, approved language, and marketing claims.",
      },
      {
        title: "Read the finding cards",
        detail:
          "Each finding shows severity, the rule it maps to, the exact on-pack text, and a suggested fix. Citations link to the source regulation.",
      },
      {
        title: "Weigh confidence",
        detail:
          "Findings carry a confidence level. Low-confidence or uncertain items are flagged as needs-review, never as definitive violations — always apply human judgment.",
      },
      {
        title: "Act on findings",
        detail:
          "Confirm, dismiss, or convert findings into required fixes. Your decisions feed the package's review record and audit trail.",
      },
    ],
  },
  {
    key: "guide:assign-reviews",
    title: "Assign and balance reviews",
    description:
      "Route work to the right team and reviewer with sensible deadlines.",
    audience: "Managers",
    estMinutes: 4,
    relatedHref: "/admin/queue",
    steps: [
      {
        title: "Open the assignment queue",
        detail:
          "From Team Management → Assignments, see unassigned and in-flight packages across your teams.",
      },
      {
        title: "Assign by category and workload",
        detail:
          "Packages route to the team that owns their category. Pick a reviewer with capacity — current workload is shown inline.",
      },
      {
        title: "Set a deadline",
        detail:
          "Deadlines default from the priority SLA (Critical 12h, High 24h, Normal 48h, Low 96h). Override the due date on the single-assign dialog when needed.",
      },
      {
        title: "Track SLA and escalation",
        detail:
          "Workload & SLA shows at-risk and breached items. Overdue reviews escalate automatically so nothing stalls.",
      },
    ],
  },
  {
    key: "guide:supplier-submission",
    title: "Submit packaging as a supplier",
    description:
      "How external suppliers submit artwork and respond to review feedback.",
    audience: "Suppliers",
    estMinutes: 3,
    relatedHref: "/suppliers/portal",
    steps: [
      {
        title: "Open the Supplier Portal",
        detail:
          "The portal shows only your own submissions and packages — you never see other suppliers' data.",
      },
      {
        title: "Submit a package",
        detail:
          "Upload artwork and provide the product details. Your submission enters the review queue automatically.",
      },
      {
        title: "Respond to feedback",
        detail:
          "If a reviewer requests changes, you'll be notified. Upload a corrected version against the same package to keep the history intact.",
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Video Tutorials — outlines now; drop videoUrl in later to enable players.
// ---------------------------------------------------------------------------

export const VIDEO_TUTORIALS: VideoTutorial[] = [
  {
    key: "video:welcome",
    title: "Welcome to Packaging Compliance AI",
    description: "A 3-minute overview of what the platform does and who uses it.",
    duration: "3:00",
    level: "Beginner",
    category: "Getting Started",
    outline: [
      "What packaging compliance means and why it matters",
      "The lifecycle of a package: upload → analyze → review → decision",
      "Who does what: designers, reviewers, managers, suppliers",
      "A tour of the main workspace",
    ],
  },
  {
    key: "video:first-package",
    title: "Uploading your first package",
    description: "Create a package record and understand each field.",
    duration: "4:30",
    level: "Beginner",
    category: "Packages",
    outline: [
      "Starting a new package from artwork files",
      "Choosing the right product category",
      "Handling duplicate SKU/UPC warnings",
      "What text extraction does behind the scenes",
    ],
  },
  {
    key: "video:reading-ai",
    title: "Reading AI compliance findings",
    description: "Make sense of severity, citations, and confidence.",
    duration: "6:15",
    level: "Intermediate",
    category: "AI & Analysis",
    outline: [
      "How the AI engine maps text to regulations",
      "Severity vs. confidence — what each means",
      "Why uncertain findings are never shown as violations",
      "Confirming, dismissing, and converting findings to fixes",
    ],
  },
  {
    key: "video:review-workspace",
    title: "Working the review workspace",
    description: "The reviewer's day-to-day, end to end.",
    duration: "7:40",
    level: "Intermediate",
    category: "Reviews",
    outline: [
      "Navigating artwork, text, and findings together",
      "Adding your own findings and annotations",
      "Recording an approve/reject decision with reasoning",
      "Reviewer presence and soft review locks",
    ],
  },
  {
    key: "video:assign-workload",
    title: "Assigning reviews and balancing workload",
    description: "For managers routing work across teams.",
    duration: "5:50",
    level: "Advanced",
    category: "Team Management",
    outline: [
      "Category-to-team routing",
      "Reading reviewer workload before assigning",
      "Setting and overriding deadlines",
      "SLA tracking and automatic escalation",
    ],
  },
  {
    key: "video:regulations",
    title: "Using the regulatory knowledge base",
    description: "Find and apply the rules that govern your products.",
    duration: "5:10",
    level: "Intermediate",
    category: "Regulatory",
    outline: [
      "Searching federal regulations by product category",
      "Live FDA recall and source intelligence",
      "How internal SOPs and standards sit alongside federal rules",
      "Tracking regulatory updates",
    ],
  },
  {
    key: "video:approved-language",
    title: "Approved language and the glossary",
    description: "Keep on-pack claims consistent and defensible.",
    duration: "4:20",
    level: "Intermediate",
    category: "Language",
    outline: [
      "What approved language is and why it's enforced",
      "How the language engine checks claims",
      "Adding and retiring approved entries",
    ],
  },
  {
    key: "video:reports",
    title: "Reports and executive dashboards",
    description: "Turn review activity into insight for leadership.",
    duration: "6:00",
    level: "Advanced",
    category: "Analytics",
    outline: [
      "Compliance reports vs. executive reports",
      "Reading trend analysis and heatmaps",
      "Vendor scorecards and where the numbers come from",
    ],
  },
]

// ---------------------------------------------------------------------------
// Best Practices
// ---------------------------------------------------------------------------

export const BEST_PRACTICES: BestPractice[] = [
  {
    key: "bp:consistent-reviews",
    title: "Run consistent, defensible reviews",
    category: "Reviewing",
    summary:
      "Consistency is what makes a compliance program hold up under scrutiny.",
    tips: [
      "Work findings top to bottom — never skip a severity tier without a note.",
      "Document why you dismissed a finding, not just that you dismissed it.",
      "Treat AI findings as a starting point; the final call is always yours.",
      "Reject with specific, actionable reasons so suppliers can fix it once.",
    ],
  },
  {
    key: "bp:clean-packages",
    title: "Set up clean package records",
    category: "Packages",
    summary:
      "Good inputs make every downstream step faster and more accurate.",
    tips: [
      "Pick the most specific product category — it drives which rules apply.",
      "Link packages to suppliers by record, not by typing a name.",
      "Resolve duplicate warnings before overriding them.",
      "Wait for text extraction to finish before running analysis.",
    ],
  },
  {
    key: "bp:trust-ai",
    title: "Use AI findings wisely",
    category: "AI & Analysis",
    summary:
      "The engine is fast and thorough, but human judgment is the safeguard.",
    tips: [
      "Read the citation before acting on a finding — verify it maps to the text.",
      "Give low-confidence findings a closer human look; never auto-approve them.",
      "Re-run analysis after the underlying model or regulations change.",
      "Feed confirmed fixes back so the record and audit trail stay accurate.",
    ],
  },
  {
    key: "bp:workload",
    title: "Keep the queue healthy",
    category: "Team Management",
    summary: "Balanced workloads and clear deadlines prevent SLA breaches.",
    tips: [
      "Assign by capacity, not just by category — check current workload.",
      "Set realistic deadlines; override the SLA default when a package warrants it.",
      "Watch the at-risk list daily so escalations are the exception.",
      "Rebalance when a reviewer is out rather than letting items age.",
    ],
  },
  {
    key: "bp:language",
    title: "Standardize on-pack language",
    category: "Language",
    summary:
      "Approved language keeps claims consistent and legally defensible.",
    tips: [
      "Prefer approved-language entries over ad-hoc wording for claims.",
      "Retire outdated entries instead of deleting them to preserve history.",
      "Escalate novel or high-risk claims to legal review.",
    ],
  },
  {
    key: "bp:suppliers",
    title: "Work well with suppliers",
    category: "Suppliers",
    summary: "Clear feedback loops shorten the correction cycle.",
    tips: [
      "Give one consolidated, specific list of required changes.",
      "Ask suppliers to re-submit against the same package to keep versions linked.",
      "Use vendor scorecards to spot recurring issues and coach proactively.",
    ],
  },
]

// ---------------------------------------------------------------------------
// Compliance Academy — structured courses with progress
// ---------------------------------------------------------------------------

export const ACADEMY_COURSES: AcademyCourse[] = [
  {
    key: "academy:foundations",
    title: "Compliance Foundations",
    description:
      "The vocabulary and workflow every user needs before touching a review.",
    level: "Foundational",
    estMinutes: 25,
    lessons: [
      {
        title: "What packaging compliance is",
        points: [
          "The regulatory landscape: FDA, EPA, CPSC, FTC, and state rules",
          "Why non-compliant packaging is a business and legal risk",
          "The role of internal standards alongside government regulations",
        ],
      },
      {
        title: "The package lifecycle",
        points: [
          "Upload and extraction",
          "AI analysis against rules and approved language",
          "Human review and decision",
          "Audit trail and reporting",
        ],
      },
      {
        title: "Roles and responsibilities",
        points: [
          "Designers and packaging managers",
          "Reviewers, legal reviewers, and directors",
          "External suppliers and their boundaries",
        ],
      },
    ],
  },
  {
    key: "academy:reviewing",
    title: "Effective Reviewing",
    description:
      "Turn AI findings into fast, consistent, defensible decisions.",
    level: "Intermediate",
    estMinutes: 35,
    lessons: [
      {
        title: "Anatomy of a finding",
        points: [
          "Severity, confidence, and citation",
          "Distinguishing true issues from false positives",
          "When to add your own findings",
        ],
      },
      {
        title: "Making a decision",
        points: [
          "Approve vs. reject vs. request changes",
          "Writing actionable rejection reasons",
          "Documenting dismissals for the audit trail",
        ],
      },
      {
        title: "Collaboration and locking",
        points: [
          "Reviewer presence and soft review locks",
          "Avoiding two people overwriting each other",
          "Handing off a partially reviewed package",
        ],
      },
    ],
  },
  {
    key: "academy:regulatory",
    title: "Regulatory Knowledge",
    description:
      "Find, interpret, and apply the rules that govern your products.",
    level: "Intermediate",
    estMinutes: 30,
    lessons: [
      {
        title: "The knowledge base",
        points: [
          "Searching regulations by category",
          "Reading a regulation and its citations",
          "Live FDA recalls and sources",
        ],
      },
      {
        title: "Internal standards & SOPs",
        points: [
          "How company standards participate in reviews",
          "SOP documents and version history",
          "Keeping procedures current before they lapse",
        ],
      },
    ],
  },
  {
    key: "academy:manager",
    title: "Managing a Compliance Team",
    description:
      "Route work, hold SLAs, and read the numbers that matter.",
    level: "Advanced",
    estMinutes: 40,
    lessons: [
      {
        title: "Assignment & workload",
        points: [
          "Category-to-team routing",
          "Balancing by capacity",
          "Deadlines, SLAs, and escalation",
        ],
      },
      {
        title: "Reporting & insight",
        points: [
          "Compliance and executive reports",
          "Trend analysis and heatmaps",
          "Vendor scorecards",
        ],
      },
      {
        title: "Administration",
        points: [
          "Roles, permissions, and team assignments",
          "Audit center and activity monitoring",
          "AI provider and cost oversight",
        ],
      },
    ],
  },
]
