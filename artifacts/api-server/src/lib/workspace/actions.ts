import type { Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  packagesTable,
  violationsTable,
  reviewTasksTable,
  reportsTable,
  specialistProfilesTable,
  packageVersionsTable,
  reviewAssignmentsTable,
  type PackageRow,
} from "@workspace/db";
import { getAuthContext, hasPermission } from "../rbac/context";
import { packageConds } from "../rbac/scope";
import { writeAudit } from "../audit";
import { assignReview, autoAssignReview } from "../reviews/engine";
import { escalateReviewNow } from "../reviews/escalation";
import { compareVersions, STANDING_DISCLAIMER } from "../ai";
import { resolveAiClientForTier } from "../ai-client";
import { trackDirectUsage } from "../ai-usage";
import { WORKLOAD_LABELS } from "../ai-orchestration";
import { logger } from "../logger";
import type { WorkspaceCitation } from "./tools";

// ---------------------------------------------------------------------------
// Workspace action layer (Phase 3)
//
// A registry of the platform ACTIONS the AI Workspace may recommend and, on the
// user's explicit approval, initiate. Every action reuses an EXISTING service
// function (assignReview, autoAssignReview, escalateReviewNow, compareVersions,
// …) plus the same RBAC/tenant scoping and audit trail the REST routes use — no
// new business logic and no privilege or tenant bypass.
//
// Two classes of action:
//   * sensitive = true  → STATE-CHANGING. Never executed inline. The model can
//     only PROPOSE it; the server persists the proposal and the user must
//     confirm before the server re-validates permissions and executes.
//   * sensitive = false → READ-ONLY / DERIVED output (summaries, drafts,
//     comparisons). Executed inline like a read tool; no gate.
//
// `supplierSafe` mirrors the read-tool layer: a supplier_user may NEVER run a
// non-supplier-safe action, regardless of permission bits. All state-changing
// actions here are internal-only (supplierSafe: false).
// ---------------------------------------------------------------------------

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ActionRecordRef = {
  kind: string;
  id: number | string;
  label: string;
  href: string | null;
};

export type ActionResult = {
  // Text appended to the conversation reflecting what happened.
  resultText: string;
  // Source/record links for the UI.
  citations: WorkspaceCitation[];
  // The primary created/updated record, if any.
  recordRef: ActionRecordRef | null;
};

// The outcome of validating + summarizing a proposed action before it is shown
// to the user for confirmation. `error` blocks the proposal from being created.
export type ActionSummary = { summary: string } | { error: string };

export type WorkspaceAction = {
  name: string;
  description: string;
  parameters: JsonSchema;
  // Permission keys the caller must ALL hold.
  requiredPerms: string[];
  // Whether a supplier_user may EVER run this action.
  supplierSafe: boolean;
  // State-changing (needs confirmation) vs read-only/derived (runs inline).
  sensitive: boolean;
  // Validate args + produce the confirmation-card summary. Only used for
  // sensitive actions (at proposal time). Reads DB to resolve human names and to
  // enforce org/tenant scope BEFORE anything is proposed.
  summarize: (req: Request, args: Record<string, unknown>) => Promise<ActionSummary>;
  // Execute via existing service logic. For sensitive actions this runs only
  // AFTER confirmation (server re-validates perms first). For non-sensitive
  // actions this runs inline during the stream.
  execute: (req: Request, args: Record<string, unknown>) => Promise<ActionResult>;
};

// --- small helpers ---------------------------------------------------------

function str(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length ? t : null;
}

function normalizePriority(raw: unknown): string {
  const v = (str(raw) ?? "").toLowerCase();
  return ["low", "medium", "high", "critical"].includes(v) ? v : "medium";
}

// Load a package the caller may access (org + supplier isolation), or null.
async function loadAccessiblePackage(
  req: Request,
  id: number,
): Promise<PackageRow | null> {
  if (!Number.isFinite(id)) return null;
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(and(eq(packagesTable.id, id), ...packageConds(req)))
    .limit(1);
  return pkg ?? null;
}

function packageCitation(pkg: {
  id: number;
  name: string;
  sku: string;
}): WorkspaceCitation {
  return {
    type: "package",
    id: pkg.id,
    label: `${pkg.name} (${pkg.sku})`,
    href: `/packages/${pkg.id}`,
  };
}

// A focused, read-only text completion for derived outputs (drafts, executive
// summaries). Reuses the shared "copilot" telemetry workload; failures surface
// as a plain message rather than throwing into the conversation.
async function runDerivedCompletion(
  organizationId: number,
  system: string,
  user: string,
): Promise<string> {
  const { client, model } = await resolveAiClientForTier("standard");
  const response = await trackDirectUsage(
    {
      workload: "copilot",
      model,
      tier: "standard",
      reviewType: WORKLOAD_LABELS.copilot,
      organizationId,
    },
    () =>
      client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_completion_tokens: 900,
      }),
  );
  return String(response.choices[0]?.message?.content ?? "").trim();
}

async function loadFindings(packageId: number) {
  return db
    .select({
      severity: violationsTable.severity,
      engine: violationsTable.engine,
      title: violationsTable.title,
      regulationRef: violationsTable.regulationRef,
      findingClass: violationsTable.findingClass,
      status: violationsTable.status,
    })
    .from(violationsTable)
    .where(eq(violationsTable.packageId, packageId))
    .orderBy(desc(violationsTable.confidence))
    .limit(40);
}

function findingsBlock(
  findings: { severity: string | null; engine: string | null; title: string; regulationRef: string | null }[],
): string {
  if (!findings.length) return "No recorded findings.";
  return findings
    .map(
      (f) =>
        `- [${f.severity ?? "?"}] ${f.engine ?? "?"}: ${f.title}${
          f.regulationRef ? ` (${f.regulationRef})` : ""
        }`,
    )
    .join("\n");
}

// ===========================================================================
// SENSITIVE (state-changing) actions — proposal + confirmation required
// ===========================================================================

const createReview: WorkspaceAction = {
  name: "create_review",
  sensitive: true,
  supplierSafe: false,
  requiredPerms: ["packages:write"],
  description:
    "Create a compliance review for a package and auto-route it to the responsible team (least-loaded member). Use when the user wants to start a review but has not named a specific reviewer.",
  parameters: {
    type: "object",
    properties: {
      packageId: { type: "integer", description: "The package to review." },
      priority: {
        type: "string",
        description: "low | normal | high | urgent (optional).",
      },
    },
    required: ["packageId"],
    additionalProperties: false,
  },
  async summarize(req, args) {
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) return { error: "That package was not found or is not accessible to you." };
    const priority = str(args["priority"]);
    return {
      summary: `Create a review for "${pkg.name}" (SKU ${pkg.sku}) and auto-route it to the ${
        pkg.category ?? "default"
      } team${priority ? ` at ${priority} priority` : ""}.`,
    };
  },
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) throw new Error("Package not accessible.");
    const assignment = await autoAssignReview({
      organizationId: ctx.organizationId,
      packageId: pkg.id,
      category: pkg.category ?? null,
      teamName: pkg.category ?? null,
      priority: str(args["priority"]) ?? undefined,
      actorUserId: ctx.userId,
      actorName: ctx.name || ctx.email || "AI Workspace",
      packageName: pkg.name,
    });
    await writeAudit(req, {
      action: "Review created via AI Workspace",
      entityType: "review_assignment",
      entityId: assignment.id,
      packageId: pkg.id,
      detail: `Auto-routed review created for "${pkg.name}"`,
    });
    const ref = packageCitation(pkg);
    return {
      resultText: `Created a review for "${pkg.name}" and routed it to the ${
        pkg.category ?? "default"
      } team.`,
      citations: [ref],
      recordRef: { ...ref, kind: "package" },
    };
  },
};

const assignReviewer: WorkspaceAction = {
  name: "assign_reviewer",
  sensitive: true,
  supplierSafe: false,
  requiredPerms: ["packages:write"],
  description:
    "Assign a specific specialist (from the specialist directory) as the reviewer for a package. Call list_specialists first to get the specialistId. Restarts the SLA clock for the new owner.",
  parameters: {
    type: "object",
    properties: {
      packageId: { type: "integer", description: "The package to assign." },
      specialistId: {
        type: "integer",
        description: "The specialist directory id (from list_specialists) to assign as reviewer.",
      },
      priority: { type: "string", description: "low | normal | high | urgent (optional)." },
    },
    required: ["packageId", "specialistId"],
    additionalProperties: false,
  },
  async summarize(req, args) {
    const ctx = getAuthContext(req);
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) return { error: "That package was not found or is not accessible to you." };
    const [spec] = await db
      .select({ name: specialistProfilesTable.name, userId: specialistProfilesTable.userId })
      .from(specialistProfilesTable)
      .where(
        and(
          eq(specialistProfilesTable.id, Number(args["specialistId"])),
          eq(specialistProfilesTable.organizationId, ctx.organizationId),
        ),
      )
      .limit(1);
    if (!spec) return { error: "That specialist was not found in your directory." };
    if (spec.userId == null)
      return {
        error: `${spec.name} is a directory-only profile with no login account, so they cannot be assigned a review. Pick a specialist linked to a user.`,
      };
    return { summary: `Assign the review of "${pkg.name}" (SKU ${pkg.sku}) to ${spec.name}.` };
  },
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) throw new Error("Package not accessible.");
    const [spec] = await db
      .select({ name: specialistProfilesTable.name, userId: specialistProfilesTable.userId })
      .from(specialistProfilesTable)
      .where(
        and(
          eq(specialistProfilesTable.id, Number(args["specialistId"])),
          eq(specialistProfilesTable.organizationId, ctx.organizationId),
        ),
      )
      .limit(1);
    if (!spec || spec.userId == null)
      throw new Error("Specialist not assignable.");
    const assignment = await assignReview({
      organizationId: ctx.organizationId,
      packageId: pkg.id,
      assigneeUserId: spec.userId,
      priority: str(args["priority"]) ?? undefined,
      actorUserId: ctx.userId,
      actorName: ctx.name || ctx.email || "AI Workspace",
      packageName: pkg.name,
      reason: "Assigned via AI Workspace",
    });
    await writeAudit(req, {
      action: "Reviewer assigned via AI Workspace",
      entityType: "review_assignment",
      entityId: assignment.id,
      packageId: pkg.id,
      detail: `Assigned "${pkg.name}" review to ${spec.name}`,
    });
    const ref = packageCitation(pkg);
    return {
      resultText: `Assigned the review of "${pkg.name}" to ${spec.name}.`,
      citations: [ref],
      recordRef: { ...ref, kind: "package" },
    };
  },
};

const escalateReview: WorkspaceAction = {
  name: "escalate_review",
  sensitive: true,
  supplierSafe: false,
  requiredPerms: ["packages:write"],
  description:
    "Escalate a package's active review up one tier (Manager → Director → Leadership), notifying the accountable people. Use when a review is stuck or urgent.",
  parameters: {
    type: "object",
    properties: {
      packageId: { type: "integer", description: "The package whose review to escalate." },
      reason: { type: "string", description: "Why it is being escalated (optional)." },
    },
    required: ["packageId"],
    additionalProperties: false,
  },
  async summarize(req, args) {
    const ctx = getAuthContext(req);
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) return { error: "That package was not found or is not accessible to you." };
    const [assignment] = await db
      .select({ escalationLevel: reviewAssignmentsTable.escalationLevel, status: reviewAssignmentsTable.status })
      .from(reviewAssignmentsTable)
      .where(
        and(
          eq(reviewAssignmentsTable.packageId, pkg.id),
          eq(reviewAssignmentsTable.organizationId, ctx.organizationId),
        ),
      )
      .limit(1);
    if (!assignment)
      return { error: `"${pkg.name}" has no active review to escalate. Create or assign a review first.` };
    const reason = str(args["reason"]);
    return {
      summary: `Escalate the review of "${pkg.name}" (SKU ${pkg.sku}) up one tier${
        reason ? `. Reason: ${reason}` : ""
      }.`,
    };
  },
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) throw new Error("Package not accessible.");
    const result = await escalateReviewNow({
      organizationId: ctx.organizationId,
      packageId: pkg.id,
      actorUserId: ctx.userId,
      actorName: ctx.name || ctx.email || "AI Workspace",
      reason: str(args["reason"]),
    });
    const ref = packageCitation(pkg);
    if (!result.escalated) {
      const why =
        result.reason === "no_active_assignment"
          ? "there is no active review to escalate"
          : "it is already at the highest escalation tier";
      return {
        resultText: `Could not escalate "${pkg.name}" — ${why}.`,
        citations: [ref],
        recordRef: null,
      };
    }
    await writeAudit(req, {
      action: "Review escalated via AI Workspace",
      entityType: "review_assignment",
      packageId: pkg.id,
      detail: `Escalated "${pkg.name}" to ${result.label}`,
    });
    return {
      resultText: `Escalated the review of "${pkg.name}" to ${result.label}.`,
      citations: [ref],
      recordRef: { ...ref, kind: "package" },
    };
  },
};

const createTask: WorkspaceAction = {
  name: "create_task",
  sensitive: true,
  supplierSafe: false,
  requiredPerms: ["packages:write"],
  description:
    "Create a manual review task on a package (title, optional description, priority). Use to capture a follow-up or to-do on a package.",
  parameters: {
    type: "object",
    properties: {
      packageId: { type: "integer", description: "The package the task is on." },
      title: { type: "string", description: "Short task title." },
      description: { type: "string", description: "Optional detail." },
      priority: { type: "string", description: "low | medium | high | critical (default medium)." },
    },
    required: ["packageId", "title"],
    additionalProperties: false,
  },
  async summarize(req, args) {
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) return { error: "That package was not found or is not accessible to you." };
    const title = str(args["title"]);
    if (!title) return { error: "A task title is required." };
    return {
      summary: `Create a ${normalizePriority(args["priority"])}-priority task "${title}" on "${pkg.name}" (SKU ${pkg.sku}).`,
    };
  },
  async execute(req, args) {
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) throw new Error("Package not accessible.");
    const title = str(args["title"]);
    if (!title) throw new Error("Task title is required.");
    const [task] = await db
      .insert(reviewTasksTable)
      .values({
        packageId: pkg.id,
        title,
        description: str(args["description"]),
        priority: normalizePriority(args["priority"]),
        status: "open",
        source: "manual",
      })
      .returning({ id: reviewTasksTable.id });
    await writeAudit(req, {
      action: "Task created via AI Workspace",
      entityType: "review_task",
      entityId: task?.id ?? null,
      packageId: pkg.id,
      detail: `Created task "${title}" on "${pkg.name}"`,
    });
    const ref = packageCitation(pkg);
    return {
      resultText: `Created the task "${title}" on "${pkg.name}".`,
      citations: [ref],
      recordRef: { ...ref, kind: "package" },
    };
  },
};

const generateReport: WorkspaceAction = {
  name: "generate_report",
  sensitive: true,
  supplierSafe: false,
  requiredPerms: ["reports:write"],
  description:
    "Generate and save a compliance report for a package (a findings summary recorded in Reports). Use when the user asks to produce or file a report.",
  parameters: {
    type: "object",
    properties: {
      packageId: { type: "integer", description: "The package to report on." },
      title: { type: "string", description: "Optional report title." },
      summary: { type: "string", description: "Optional summary text; auto-composed from findings if omitted." },
    },
    required: ["packageId"],
    additionalProperties: false,
  },
  async summarize(req, args) {
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) return { error: "That package was not found or is not accessible to you." };
    return {
      summary: `Generate and save a compliance report for "${pkg.name}" (SKU ${pkg.sku}).`,
    };
  },
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg) throw new Error("Package not accessible.");
    const findings = await loadFindings(pkg.id);
    const title = str(args["title"]) ?? `Compliance Report — ${pkg.name}`;
    const summary =
      str(args["summary"]) ??
      `Compliance status ${pkg.complianceStatus ?? "?"} (grade ${pkg.grade ?? "?"}, risk ${
        pkg.riskScore ?? "?"
      }). Findings — critical ${pkg.criticalCount ?? 0}, major ${pkg.majorCount ?? 0}, minor ${
        pkg.minorCount ?? 0
      }.\n\n${findingsBlock(findings)}`;
    const [report] = await db
      .insert(reportsTable)
      .values({
        organizationId: ctx.organizationId,
        packageId: pkg.id,
        title,
        type: "Compliance",
        format: "Summary",
        summary,
      })
      .returning({ id: reportsTable.id });
    await writeAudit(req, {
      action: "Report generated via AI Workspace",
      entityType: "report",
      entityId: report?.id ?? null,
      packageId: pkg.id,
      detail: `Generated compliance report "${title}"`,
    });
    const ref: ActionRecordRef = {
      kind: "report",
      id: report?.id ?? pkg.id,
      label: title,
      href: `/reports`,
    };
    return {
      resultText: `Generated the compliance report "${title}" for "${pkg.name}". Find it in Reports.`,
      citations: [{ type: "report", id: ref.id, label: title, href: "/reports" }],
      recordRef: ref,
    };
  },
};

// ===========================================================================
// NON-SENSITIVE (read-only / derived) actions — run inline, no confirmation
// ===========================================================================

const summarizeFindings: WorkspaceAction = {
  name: "summarize_findings",
  sensitive: false,
  supplierSafe: true,
  requiredPerms: ["violations:read"],
  description:
    "Summarize the compliance findings on a package (counts by severity plus the key issues). Read-only.",
  parameters: {
    type: "object",
    properties: { packageId: { type: "integer" } },
    required: ["packageId"],
    additionalProperties: false,
  },
  async summarize() {
    return { summary: "Summarize findings." };
  },
  async execute(req, args) {
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg)
      return { resultText: "That package is not accessible to you.", citations: [], recordRef: null };
    const findings = await loadFindings(pkg.id);
    const text = [
      `Findings for "${pkg.name}" (SKU ${pkg.sku}) — status ${pkg.complianceStatus ?? "?"}, grade ${
        pkg.grade ?? "?"
      }.`,
      `Counts: critical ${pkg.criticalCount ?? 0}, major ${pkg.majorCount ?? 0}, minor ${
        pkg.minorCount ?? 0
      }.`,
      "",
      findingsBlock(findings),
    ].join("\n");
    return { resultText: text, citations: [packageCitation(pkg)], recordRef: null };
  },
};

const draftApprovalNotes: WorkspaceAction = {
  name: "draft_approval_notes",
  sensitive: false,
  supplierSafe: true,
  requiredPerms: ["packages:read"],
  description:
    "Draft reviewer approval/decision notes for a package based on its current findings. Produces DRAFT text only — nothing is submitted or saved.",
  parameters: {
    type: "object",
    properties: { packageId: { type: "integer" } },
    required: ["packageId"],
    additionalProperties: false,
  },
  async summarize() {
    return { summary: "Draft approval notes." };
  },
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg)
      return { resultText: "That package is not accessible to you.", citations: [], recordRef: null };
    const findings = await loadFindings(pkg.id);
    try {
      const draft = await runDerivedCompletion(
        ctx.organizationId,
        `You are a packaging compliance reviewer drafting internal approval/decision notes. Write clear, professional notes a reviewer can edit before submitting. Reference the concrete findings. Do NOT state uncertain findings as definitive violations. Do not use emojis. Keep it under 180 words.`,
        `Package "${pkg.name}" (SKU ${pkg.sku}).\nCompliance status: ${
          pkg.complianceStatus ?? "?"
        } (grade ${pkg.grade ?? "?"}).\nFindings:\n${findingsBlock(findings)}\n\nDraft the approval/decision notes.`,
      );
      const text = `Draft approval notes for "${pkg.name}" (review and edit before submitting):\n\n${
        draft || "Could not generate a draft."
      }\n\n${STANDING_DISCLAIMER}`;
      return { resultText: text, citations: [packageCitation(pkg)], recordRef: null };
    } catch (err) {
      logger.warn({ err }, "workspace action draft_approval_notes failed");
      return {
        resultText: "I could not draft approval notes right now. Please try again.",
        citations: [packageCitation(pkg)],
        recordRef: null,
      };
    }
  },
};

const compareVersionsAction: WorkspaceAction = {
  name: "compare_versions",
  sensitive: false,
  supplierSafe: true,
  requiredPerms: ["packages:read"],
  description:
    "Compare two versions of a package's copy and list the compliance-relevant changes. Defaults to the two most recent versions. Read-only.",
  parameters: {
    type: "object",
    properties: {
      packageId: { type: "integer" },
      versionAId: { type: "integer", description: "Optional older version id." },
      versionBId: { type: "integer", description: "Optional newer version id." },
    },
    required: ["packageId"],
    additionalProperties: false,
  },
  async summarize() {
    return { summary: "Compare versions." };
  },
  async execute(req, args) {
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg)
      return { resultText: "That package is not accessible to you.", citations: [], recordRef: null };
    const versions = await db
      .select({
        id: packageVersionsTable.id,
        versionNumber: packageVersionsTable.versionNumber,
        label: packageVersionsTable.label,
        extractedText: packageVersionsTable.extractedText,
      })
      .from(packageVersionsTable)
      .where(eq(packageVersionsTable.packageId, pkg.id))
      .orderBy(desc(packageVersionsTable.versionNumber));
    if (versions.length < 2)
      return {
        resultText: `"${pkg.name}" has fewer than two versions, so there is nothing to compare.`,
        citations: [packageCitation(pkg)],
        recordRef: null,
      };
    const aId = Number(args["versionAId"]);
    const bId = Number(args["versionBId"]);
    const vB = versions.find((v) => v.id === bId) ?? versions[0];
    const vA = versions.find((v) => v.id === aId) ?? versions.find((v) => v.id !== vB.id)!;
    try {
      const cmp = await compareVersions(
        pkg.name,
        vA.label ?? `v${vA.versionNumber}`,
        vA.extractedText ?? "",
        vB.label ?? `v${vB.versionNumber}`,
        vB.extractedText ?? "",
      );
      const changeLines = cmp.changes
        .filter((c) => c.changeType !== "unchanged")
        .map(
          (c) =>
            `- [${c.changeType}] ${c.field ?? c.category}: ${c.before ?? "—"} → ${c.after ?? "—"}${
              c.note ? ` (${c.note})` : ""
            }`,
        )
        .join("\n");
      const text = `Comparing "${pkg.name}" ${vA.label ?? `v${vA.versionNumber}`} → ${
        vB.label ?? `v${vB.versionNumber}`
      }:\n${cmp.summary}\n\n${changeLines || "No compliance-significant changes."}`;
      return { resultText: text, citations: [packageCitation(pkg)], recordRef: null };
    } catch (err) {
      logger.warn({ err }, "workspace action compare_versions failed");
      return {
        resultText: "I could not compare versions right now. Please try again.",
        citations: [packageCitation(pkg)],
        recordRef: null,
      };
    }
  },
};

const executiveSummary: WorkspaceAction = {
  name: "prepare_executive_summary",
  sensitive: false,
  supplierSafe: true,
  requiredPerms: ["packages:read"],
  description:
    "Prepare a short executive summary of a package's compliance posture for leadership. Read-only; nothing is saved.",
  parameters: {
    type: "object",
    properties: { packageId: { type: "integer" } },
    required: ["packageId"],
    additionalProperties: false,
  },
  async summarize() {
    return { summary: "Prepare an executive summary." };
  },
  async execute(req, args) {
    const ctx = getAuthContext(req);
    const pkg = await loadAccessiblePackage(req, Number(args["packageId"]));
    if (!pkg)
      return { resultText: "That package is not accessible to you.", citations: [], recordRef: null };
    const findings = await loadFindings(pkg.id);
    try {
      const summary = await runDerivedCompletion(
        ctx.organizationId,
        `You write concise executive summaries of packaging compliance status for leadership. Lead with the bottom line, then the top risks and the recommended next step. Do not state uncertain findings as definitive. Do not use emojis. Under 150 words.`,
        `Package "${pkg.name}" (SKU ${pkg.sku}).\nStatus ${pkg.complianceStatus ?? "?"}, grade ${
          pkg.grade ?? "?"
        }, risk ${pkg.riskScore ?? "?"}.\nCounts — critical ${pkg.criticalCount ?? 0}, major ${
          pkg.majorCount ?? 0
        }, minor ${pkg.minorCount ?? 0}.\nFindings:\n${findingsBlock(findings)}`,
      );
      const text = `Executive summary — "${pkg.name}":\n\n${
        summary || "Could not generate a summary."
      }`;
      return { resultText: text, citations: [packageCitation(pkg)], recordRef: null };
    } catch (err) {
      logger.warn({ err }, "workspace action prepare_executive_summary failed");
      return {
        resultText: "I could not prepare an executive summary right now. Please try again.",
        citations: [packageCitation(pkg)],
        recordRef: null,
      };
    }
  },
};

// ---------------------------------------------------------------------------

const ALL_ACTIONS: WorkspaceAction[] = [
  // sensitive
  createReview,
  assignReviewer,
  escalateReview,
  createTask,
  generateReport,
  // non-sensitive
  summarizeFindings,
  draftApprovalNotes,
  compareVersionsAction,
  executiveSummary,
];

// Actions the caller may be OFFERED: they must hold every required permission,
// and a supplier_user only ever sees supplier-safe actions. This mirrors the
// read-tool gate; the confirm endpoint re-checks permissions independently.
export function availableActionsFor(req: Request): WorkspaceAction[] {
  const isSupplier = getAuthContext(req).roleKey === "supplier_user";
  return ALL_ACTIONS.filter(
    (a) =>
      a.requiredPerms.every((p) => hasPermission(req, p)) &&
      (!isSupplier || a.supplierSafe),
  );
}

export function findAction(name: string): WorkspaceAction | undefined {
  return ALL_ACTIONS.find((a) => a.name === name);
}

// Authoritative permission re-check used by the confirm endpoint (defense in
// depth): the caller must currently hold every required perm AND not be a
// supplier for a non-supplier-safe action.
export function callerMayRunAction(req: Request, action: WorkspaceAction): boolean {
  const isSupplier = getAuthContext(req).roleKey === "supplier_user";
  if (isSupplier && !action.supplierSafe) return false;
  return action.requiredPerms.every((p) => hasPermission(req, p));
}

export function actionStatusLabel(name: string): string {
  const map: Record<string, string> = {
    create_review: "Preparing a review",
    assign_reviewer: "Preparing an assignment",
    escalate_review: "Preparing an escalation",
    create_task: "Preparing a task",
    generate_report: "Preparing a report",
    summarize_findings: "Summarizing findings",
    draft_approval_notes: "Drafting approval notes",
    compare_versions: "Comparing versions",
    prepare_executive_summary: "Preparing an executive summary",
  };
  return map[name] ?? "Working on that";
}
