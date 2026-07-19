// Security posture catalog — the single source of truth for the controls the
// platform enforces, referenced by the Security Posture admin page and the
// downloadable PDF audit report. Content is maintained by hand: update it when
// a control is added, changed, or an audit round completes.

export type ControlStatus = "enforced" | "accepted-risk";

export type SecurityControl = {
  id: string;
  category: string;
  name: string;
  status: ControlStatus;
  description: string;
};

export type AuditRecord = {
  date: string; // ISO date
  scope: string;
  outcome: string;
  criticalFindings: number;
  highFindings: number;
  notes: string[];
};

export const SECURITY_CONTROLS: SecurityControl[] = [
  // ── Authentication ────────────────────────────────────────────────────
  {
    id: "auth-global-guard",
    category: "Authentication",
    name: "Global backend auth guard",
    status: "enforced",
    description:
      "Every /api route is protected by server-side session verification (Clerk). The only unauthenticated endpoints are static health checks and the MCP gateway, which enforces its own bearer-token auth with full tenant isolation.",
  },
  {
    id: "auth-employee-gate",
    category: "Authentication",
    name: "Employees-only access",
    status: "enforced",
    description:
      "Sign-in is restricted to approved corporate email domains via a server-side 403 gate; non-allowed accounts are rejected and purged on confirmed non-allowed email.",
  },
  {
    id: "auth-session-cookies",
    category: "Authentication",
    name: "No tokens in URLs or browser storage",
    status: "enforced",
    description:
      "Sessions live in httpOnly cookies managed by the identity provider SDK. No JWTs or session values are stored in localStorage/sessionStorage or passed in URL query parameters. Upload URLs are short-lived presigned storage URLs, not credentials.",
  },
  // ── Authorization & tenancy ───────────────────────────────────────────
  {
    id: "authz-rbac",
    category: "Authorization & Tenancy",
    name: "Role-based access control",
    status: "enforced",
    description:
      "Fine-grained permission keys (e.g. packages:read, org:manage) gate every route server-side and every navigation item client-side from a single shared mapping, so UI and API can never drift.",
  },
  {
    id: "authz-org-scope",
    category: "Authorization & Tenancy",
    name: "Organization data scoping",
    status: "enforced",
    description:
      "All identity and tenancy values (user, organization, supplier) derive exclusively from the verified server session — never from request bodies or query strings. Every data query filters by the caller's organization.",
  },
  {
    id: "authz-supplier-isolation",
    category: "Authorization & Tenancy",
    name: "Supplier isolation",
    status: "enforced",
    description:
      "Supplier accounts are restricted to their own supplier's records via mandatory scoping helpers; supplier IDs are forced server-side and cannot be spoofed by the client.",
  },
  {
    id: "authz-mutation-ownership",
    category: "Authorization & Tenancy",
    name: "Ownership checks on all mutations",
    status: "enforced",
    description:
      "Every update and delete verifies the record belongs to the caller's organization (returning 404 otherwise) before writing. File and thumbnail serving verify object ownership before streaming bytes.",
  },
  {
    id: "authz-int-ids",
    category: "Authorization & Tenancy",
    name: "Sequential integer IDs (accepted risk)",
    status: "accepted-risk",
    description:
      "Resource URLs use auto-increment integer IDs. Enumeration is harmless because every fetch-by-id also enforces organization scoping (guessing a foreign ID returns 404). Accepted for this internal single-company tool; UUID migration deemed churn without security gain.",
  },
  // ── Application hardening ─────────────────────────────────────────────
  {
    id: "hard-rate-limit",
    category: "Application Hardening",
    name: "API rate limiting",
    status: "enforced",
    description:
      "Per-user (falling back to per-IP) rate limiting on API routes, with a second layer on the external MCP gateway.",
  },
  {
    id: "hard-uploads",
    category: "Application Hardening",
    name: "Upload validation & stored-XSS defense",
    status: "enforced",
    description:
      "Uploads are validated by extension allowlist with size limits. Stored-XSS is neutralized at serve time (content-type / disposition hardening), not just at upload, so hostile files can never execute in the app origin.",
  },
  {
    id: "hard-headers",
    category: "Application Hardening",
    name: "Security headers",
    status: "enforced",
    description: "Helmet-managed HTTP security headers on all responses.",
  },
  {
    id: "hard-ssrf",
    category: "Application Hardening",
    name: "SSRF validation on outbound URLs",
    status: "enforced",
    description:
      "Administrator-configured AI provider base URLs are validated against SSRF (no private/internal address targets) before the server will call them.",
  },
  // ── AI safety ─────────────────────────────────────────────────────────
  {
    id: "ai-prompt-injection",
    category: "AI Safety",
    name: "Prompt-injection hardening",
    status: "enforced",
    description:
      "Every LLM call fences untrusted document/user-supplied data with explicit boundaries and an untrusted-data directive, so extracted artwork text cannot steer the model.",
  },
  {
    id: "ai-guardrails",
    category: "AI Safety",
    name: "Legal guardrails on AI findings",
    status: "enforced",
    description:
      "Low-confidence or uncertain AI compliance findings are deterministically prevented (in code, not prompts) from being surfaced as definitive violations.",
  },
  {
    id: "ai-key-encryption",
    category: "AI Safety",
    name: "Encrypted AI provider keys",
    status: "enforced",
    description:
      "Third-party AI API keys are encrypted at rest (AES-256-GCM) and never returned to any client; only the last four characters are shown for identification.",
  },
  {
    id: "ai-workspace-tenancy",
    category: "AI Safety",
    name: "Grounded AI tool tenancy",
    status: "enforced",
    description:
      "The AI workspace and external MCP gateway share one read-only tool registry as the single security boundary: tools are permission-offered AND query-scoped to the caller's organization/supplier.",
  },
  // ── Audit & operations ────────────────────────────────────────────────
  {
    id: "ops-audit-trail",
    category: "Audit & Operations",
    name: "Append-only audit trail",
    status: "enforced",
    description:
      "Security-relevant actions (role changes, finding updates, deletions, MCP tool calls) are written to an append-only audit ledger with before/after detail; older events archive rather than delete.",
  },
  {
    id: "ops-soft-delete",
    category: "Audit & Operations",
    name: "Soft delete with locked purge window",
    status: "enforced",
    description:
      "Package deletion is a recoverable trash state with a 30-day locked purge; storage objects are reference-counted before removal.",
  },
  {
    id: "ops-secrets",
    category: "Audit & Operations",
    name: "Managed secrets",
    status: "enforced",
    description:
      "All credentials (database, identity, AI, storage) live in platform-managed environment secrets — never in source control or client bundles.",
  },
];

export const AUDIT_HISTORY: AuditRecord[] = [
  {
    date: "2026-07-19",
    scope:
      "Full authentication & authorization audit: IDOR/ownership on every route, backend auth middleware coverage, client-side token storage, tokens in URLs, client-trusted identity values, mutation ownership, ID enumeration, unauthenticated endpoints, and file-serving access control.",
    outcome: "Passed — zero vulnerabilities requiring fixes.",
    criticalFindings: 0,
    highFindings: 0,
    notes: [
      "All flagged candidates were verified against source and confirmed safe by design.",
      "AI provider settings are intentionally global (company-wide configuration) and admin-permission gated — not a tenancy gap.",
      "Sequential integer IDs recorded as an accepted risk; org scoping neutralizes enumeration.",
      "Load-test auth bypass confirmed hard-disabled in production and secret-gated in development.",
    ],
  },
];

export const POSTURE_META = {
  productName: "Packaging Compliance AI",
  owner: "Dollar Tree — Packaging Compliance",
  classification: "Internal",
  stack:
    "React 19 + Vite web client, Express 5 API, PostgreSQL (Drizzle ORM), Clerk authentication, Replit deployment",
};
