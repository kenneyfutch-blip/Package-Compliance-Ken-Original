// Central definition of the enterprise permission taxonomy and the ten roles.
// This is the single source of truth consumed by the seed (to populate the
// roles/permissions/role_permissions tables) and by provisioning (to resolve a
// user's effective permissions). Route code references permission keys directly.

export interface PermissionDef {
  key: string;
  category: string;
  description: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { key: "dashboard:read", category: "dashboard", description: "View dashboards and analytics" },
  { key: "packages:read", category: "packages", description: "View packages" },
  { key: "packages:write", category: "packages", description: "Create and edit packages" },
  { key: "packages:delete", category: "packages", description: "Delete packages" },
  { key: "packages:analyze", category: "packages", description: "Run AI analysis on packages" },
  { key: "violations:read", category: "violations", description: "View violations" },
  { key: "violations:write", category: "violations", description: "Update violation status" },
  { key: "proofs:read", category: "proofs", description: "View proofs and markups" },
  { key: "proofs:write", category: "proofs", description: "Upload proofs and add markups" },
  { key: "proofs:decide", category: "proofs", description: "Approve or reject proofs" },
  { key: "suppliers:read", category: "suppliers", description: "View suppliers" },
  { key: "suppliers:write", category: "suppliers", description: "Create and edit suppliers" },
  { key: "submissions:read", category: "suppliers", description: "View supplier submissions" },
  { key: "submissions:write", category: "suppliers", description: "Submit packaging for review" },
  { key: "submissions:review", category: "suppliers", description: "Review and decide on supplier submissions" },
  { key: "reports:read", category: "reports", description: "View reports" },
  { key: "reports:write", category: "reports", description: "Generate reports" },
  { key: "regulations:read", category: "regulations", description: "View the regulation library" },
  { key: "regulations:write", category: "regulations", description: "Edit the regulation library" },
  { key: "fda:read", category: "regulations", description: "Query live FDA intelligence" },
  { key: "audit:read", category: "audit", description: "View the audit trail" },
  { key: "notifications:read", category: "notifications", description: "View notifications" },
  { key: "ai_providers:read", category: "administration", description: "View AI provider configuration" },
  { key: "ai_providers:write", category: "administration", description: "Manage AI provider configuration" },
  { key: "users:read", category: "administration", description: "View users" },
  { key: "users:write", category: "administration", description: "Manage users and role assignments" },
  { key: "teams:read", category: "administration", description: "View teams" },
  { key: "teams:write", category: "administration", description: "Manage teams" },
  { key: "org:manage", category: "administration", description: "Manage organization settings" },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);

export interface RoleDef {
  key: string;
  name: string;
  rank: number;
  description: string;
  // Either "*" for every permission or an explicit list of permission keys.
  permissions: "*" | string[];
}

export const ROLES: RoleDef[] = [
  {
    key: "platform_admin",
    name: "Platform Administrator",
    rank: 100,
    description: "Full control over the platform, users, and configuration.",
    permissions: "*",
  },
  {
    key: "compliance_director",
    name: "Compliance Director",
    rank: 90,
    description: "Oversees all compliance operations across the organization.",
    permissions: [
      "dashboard:read", "packages:read", "packages:write", "packages:delete", "packages:analyze",
      "violations:read", "violations:write", "proofs:read", "proofs:write", "proofs:decide",
      "suppliers:read", "suppliers:write", "submissions:read", "submissions:write", "submissions:review",
      "reports:read", "reports:write",
      "regulations:read", "regulations:write", "fda:read", "audit:read", "notifications:read",
      "ai_providers:read", "users:read", "users:write", "teams:read", "teams:write",
    ],
  },
  {
    key: "compliance_manager",
    name: "Compliance Manager",
    rank: 80,
    description: "Manages review workflows and the compliance team.",
    permissions: [
      "dashboard:read", "packages:read", "packages:write", "packages:analyze",
      "violations:read", "violations:write", "proofs:read", "proofs:write", "proofs:decide",
      "suppliers:read", "suppliers:write", "submissions:read", "submissions:write", "submissions:review",
      "reports:read", "reports:write",
      "regulations:read", "fda:read", "audit:read", "notifications:read",
      "users:read", "teams:read",
    ],
  },
  {
    key: "compliance_specialist",
    name: "Compliance Specialist",
    rank: 70,
    description: "Reviews packaging and resolves compliance findings.",
    permissions: [
      "dashboard:read", "packages:read", "packages:write", "packages:analyze",
      "violations:read", "violations:write", "proofs:read", "proofs:write", "proofs:decide",
      "suppliers:read", "submissions:read", "submissions:review", "reports:read", "reports:write",
      "regulations:read", "fda:read", "audit:read", "notifications:read",
    ],
  },
  {
    key: "packaging_manager",
    name: "Packaging Manager",
    rank: 60,
    description: "Manages packaging submissions and coordinates with suppliers.",
    permissions: [
      "dashboard:read", "packages:read", "packages:write",
      "violations:read", "proofs:read", "proofs:write",
      "suppliers:read", "reports:read", "regulations:read", "fda:read", "notifications:read",
    ],
  },
  {
    key: "designer",
    name: "Designer",
    rank: 50,
    description: "Uploads artwork and iterates on proofs.",
    permissions: [
      "dashboard:read", "packages:read", "packages:write",
      "violations:read", "proofs:read", "proofs:write",
      "reports:read", "regulations:read", "fda:read", "notifications:read",
    ],
  },
  {
    key: "legal_reviewer",
    name: "Legal Reviewer",
    rank: 55,
    description: "Reviews legal and regulatory aspects of packaging.",
    permissions: [
      "dashboard:read", "packages:read", "violations:read", "violations:write",
      "proofs:read", "proofs:decide", "reports:read",
      "regulations:read", "regulations:write", "fda:read", "audit:read", "notifications:read",
    ],
  },
  {
    key: "executive_viewer",
    name: "Executive Viewer",
    rank: 40,
    description: "Read-only access to dashboards and reports for leadership.",
    permissions: [
      "dashboard:read", "packages:read", "violations:read", "suppliers:read", "submissions:read",
      "reports:read", "regulations:read", "audit:read", "notifications:read",
    ],
  },
  {
    key: "supplier_user",
    name: "Supplier User",
    rank: 20,
    description: "External supplier with access limited to their own records.",
    permissions: [
      "packages:read", "proofs:read", "reports:read",
      "submissions:read", "submissions:write",
      "regulations:read", "fda:read", "notifications:read",
    ],
  },
  {
    key: "read_only",
    name: "Read Only User",
    rank: 10,
    description: "Minimal read-only access.",
    permissions: [
      "dashboard:read", "packages:read", "violations:read",
      "regulations:read", "notifications:read",
    ],
  },
];

const ROLE_BY_KEY = new Map(ROLES.map((r) => [r.key, r]));

export function getRoleDef(key: string): RoleDef | undefined {
  return ROLE_BY_KEY.get(key);
}

export function permissionsForRole(key: string): string[] {
  const role = ROLE_BY_KEY.get(key);
  if (!role) return [];
  return role.permissions === "*" ? [...ALL_PERMISSION_KEYS] : [...role.permissions];
}

export const DEFAULT_ROLE_KEY =
  process.env.DEFAULT_USER_ROLE && ROLE_BY_KEY.has(process.env.DEFAULT_USER_ROLE)
    ? process.env.DEFAULT_USER_ROLE
    : "compliance_specialist";

// Emails that should always be provisioned as Platform Administrators.
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
