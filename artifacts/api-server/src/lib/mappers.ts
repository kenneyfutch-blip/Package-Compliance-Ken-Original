import type {
  PackageRow,
  ViolationRow,
  Regulation,
  Supplier,
  AuditEventRow,
  NotificationRow,
  ReportRow,
  UserRow,
  DocumentExtractionRow,
  ReviewAssignmentRow,
  ReviewHistoryRow,
  TeamRow,
  JobRow,
  SupplierContactRow,
  SupplierSubmissionRow,
  SupplierScorecardRow,
  SupplierStatusHistoryRow,
  PackageVersionRow,
  AnnotationRow,
  CommentReplyRow,
  ReviewTaskRow,
  ApprovalDecisionRow,
} from "@workspace/db";
import { slaStatusFor } from "./reviews/engine";

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

export function mapReviewAssignment(
  a: ReviewAssignmentRow,
  extra?: {
    teamName?: string | null;
    assigneeName?: string | null;
    backupName?: string | null;
    managerName?: string | null;
  },
) {
  return {
    id: a.id,
    packageId: a.packageId,
    teamId: a.teamId,
    teamName: extra?.teamName ?? null,
    assigneeUserId: a.assigneeUserId,
    assigneeName: extra?.assigneeName ?? null,
    backupUserId: a.backupUserId,
    backupName: extra?.backupName ?? null,
    managerUserId: a.managerUserId,
    managerName: extra?.managerName ?? null,
    status: a.status,
    priority: a.priority,
    slaHours: a.slaHours,
    slaStatus: slaStatusFor(a),
    escalationLevel: a.escalationLevel,
    autoRouted: a.autoRouted,
    assignedAt: iso(a.assignedAt),
    dueAt: iso(a.dueAt),
    startedAt: iso(a.startedAt),
    completedAt: iso(a.completedAt),
    lastEscalatedAt: iso(a.lastEscalatedAt),
    // Last time ownership meaningfully changed — surfaced in the ownership
    // indicator so reviewers can see how fresh the assignment state is.
    lastActivityAt: iso(a.updatedAt),
    createdAt: iso(a.createdAt)!,
    updatedAt: iso(a.updatedAt)!,
  };
}

export function mapReviewHistory(h: ReviewHistoryRow) {
  return {
    id: h.id,
    packageId: h.packageId,
    assignmentId: h.assignmentId,
    action: h.action,
    fromTeamId: h.fromTeamId,
    toTeamId: h.toTeamId,
    fromUserId: h.fromUserId,
    toUserId: h.toUserId,
    actorUserId: h.actorUserId,
    actorName: h.actorName,
    detail: h.detail,
    reason: h.reason,
    comments: h.comments,
    escalationLevel: h.escalationLevel,
    createdAt: iso(h.createdAt)!,
  };
}

export function mapPackage(p: PackageRow) {
  return {
    id: p.id,
    sku: p.sku,
    upc: p.upc,
    name: p.name,
    brand: p.brand,
    vendor: p.vendor,
    category: p.category,
    country: p.country,
    netWeight: p.netWeight,
    dimensions: p.dimensions,
    packageType: p.packageType,
    productType: p.productType,
    manufacturingRegion: p.manufacturingRegion,
    status: p.status,
    grade: p.grade,
    riskScore: p.riskScore,
    complianceStatus: p.complianceStatus,
    approvalStatus: p.approvalStatus,
    reviewer: p.reviewer,
    artworkUrl: p.artworkUrl,
    summary: p.summary,
    complianceImpact: p.complianceImpact,
    criticalCount: p.criticalCount,
    majorCount: p.majorCount,
    minorCount: p.minorCount,
    languageScore: p.languageScore,
    languageIssueCount: p.languageIssueCount,
    languageCriticalCount: p.languageCriticalCount,
    languageAnalyzedAt: iso(p.languageAnalyzedAt),
    extractionStatus: p.extractionStatus,
    extractionConfidence: p.extractionConfidence,
    extractionEngine: p.extractionEngine,
    extractedAt: iso(p.extractedAt),
    analyzedAt: iso(p.analyzedAt),
    createdAt: iso(p.createdAt)!,
    updatedAt: iso(p.updatedAt)!,
  };
}

export function mapExtraction(e: DocumentExtractionRow) {
  return {
    id: e.id,
    packageId: e.packageId,
    proofId: e.proofId,
    version: e.version,
    status: e.status,
    engine: e.engine,
    processor: e.processor,
    sourceType: e.sourceType,
    sourceName: e.sourceName,
    sourceHash: e.sourceHash,
    text: e.text,
    pages: e.pages ?? [],
    components: e.components ?? [],
    confidence: e.confidence,
    pageCount: e.pageCount,
    error: e.error,
    processedAt: iso(e.processedAt),
    createdAt: iso(e.createdAt)!,
    updatedAt: iso(e.updatedAt)!,
  };
}

export function mapViolation(v: ViolationRow) {
  const hasBbox =
    v.bboxX !== null &&
    v.bboxY !== null &&
    v.bboxW !== null &&
    v.bboxH !== null;
  return {
    id: v.id,
    packageId: v.packageId,
    severity: v.severity,
    engine: v.engine,
    title: v.title,
    description: v.description,
    regulationRef: v.regulationRef,
    recommendation: v.recommendation,
    detectedText: v.detectedText,
    suggestedText: v.suggestedText,
    bbox: hasBbox
      ? { x: v.bboxX!, y: v.bboxY!, w: v.bboxW!, h: v.bboxH! }
      : null,
    page: v.page,
    confidence: v.confidence,
    findingClass: v.findingClass,
    claimFlags: v.claimFlags ?? [],
    status: v.status,
    createdAt: iso(v.createdAt)!,
  };
}

export function mapPackageVersion(v: PackageVersionRow) {
  return {
    id: v.id,
    packageId: v.packageId,
    versionNumber: v.versionNumber,
    label: v.label,
    fileUrl: v.fileUrl,
    fileName: v.fileName,
    fileType: v.fileType,
    previewUrl: v.previewUrl,
    pageCount: v.pageCount,
    extractedText: v.extractedText,
    notes: v.notes,
    isCurrent: v.isCurrent,
    createdBy: v.createdBy,
    createdAt: iso(v.createdAt)!,
  };
}

export function mapCommentReply(r: CommentReplyRow) {
  return {
    id: r.id,
    annotationId: r.annotationId,
    author: r.author,
    authorRole: r.authorRole,
    text: r.text,
    source: r.source,
    mentions: r.mentions ?? [],
    createdAt: iso(r.createdAt)!,
  };
}

export function mapAnnotation(a: AnnotationRow, replies: CommentReplyRow[] = []) {
  return {
    id: a.id,
    packageId: a.packageId,
    versionId: a.versionId,
    type: a.type,
    page: a.page,
    x: a.x,
    y: a.y,
    w: a.w,
    h: a.h,
    color: a.color,
    author: a.author,
    authorRole: a.authorRole,
    text: a.text,
    priority: a.priority,
    status: a.status,
    source: a.source,
    confidence: a.confidence,
    severity: a.severity,
    regulationRef: a.regulationRef,
    suggestedFix: a.suggestedFix,
    violationId: a.violationId,
    mentions: a.mentions ?? [],
    resolvedBy: a.resolvedBy,
    resolvedAt: iso(a.resolvedAt),
    createdAt: iso(a.createdAt)!,
    replies: replies.map(mapCommentReply),
  };
}

export function mapReviewTask(t: ReviewTaskRow) {
  return {
    id: t.id,
    packageId: t.packageId,
    versionId: t.versionId,
    title: t.title,
    description: t.description,
    assignedRole: t.assignedRole,
    assignee: t.assignee,
    dueDate: t.dueDate,
    priority: t.priority,
    status: t.status,
    source: t.source,
    violationId: t.violationId,
    createdAt: iso(t.createdAt)!,
    updatedAt: iso(t.updatedAt)!,
  };
}

export function mapApprovalDecision(a: ApprovalDecisionRow) {
  return {
    id: a.id,
    packageId: a.packageId,
    versionId: a.versionId,
    decision: a.decision,
    reviewer: a.reviewer,
    reviewerRole: a.reviewerRole,
    note: a.note,
    createdAt: iso(a.createdAt)!,
  };
}

export function computeScorecard(
  p: PackageRow,
  violations: ViolationRow[],
  annotations: AnnotationRow[],
  tasks: ReviewTaskRow[],
) {
  const criticalCount = violations.filter(
    (v) =>
      v.severity === "critical" &&
      (v.findingClass === "issue" || v.findingClass === "warning"),
  ).length;
  const majorCount = violations.filter(
    (v) =>
      v.severity === "major" &&
      (v.findingClass === "issue" || v.findingClass === "warning"),
  ).length;
  const minorCount = violations.filter(
    (v) =>
      v.severity === "minor" &&
      (v.findingClass === "issue" || v.findingClass === "warning"),
  ).length;
  const passedCount = violations.filter(
    (v) => v.findingClass === "passed",
  ).length;
  const recommendationCount = violations.filter(
    (v) => v.findingClass === "recommendation",
  ).length;
  const openComments = annotations.filter(
    (a) => a.status === "open" && a.source === "human",
  ).length;
  const openTasks = tasks.filter((t) => t.status !== "done").length;
  const aiFindings = annotations.filter((a) => a.source === "ai").length;

  const readinessScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        (criticalCount * 25 +
          majorCount * 10 +
          minorCount * 3 +
          openTasks * 4 +
          openComments * 2),
    ),
  );

  let readiness: string;
  if (readinessScore >= 85) readiness = "Ready to approve";
  else if (readinessScore >= 60) readiness = "Minor fixes needed";
  else if (readinessScore >= 35) readiness = "Significant revisions";
  else readiness = "Not ready";

  let recommendation: string;
  if (criticalCount > 0) {
    recommendation =
      "Reject or request revision — critical violations must be resolved before production.";
  } else if (majorCount > 0 || openTasks > 0) {
    recommendation =
      "Approve with comments once open issues and tasks are addressed.";
  } else if (minorCount > 0 || openComments > 0) {
    recommendation = "Minor cleanup recommended; close to approval.";
  } else {
    recommendation = "Ready to approve — no blocking issues detected.";
  }

  return {
    grade: p.grade,
    riskScore: p.riskScore,
    criticalCount,
    majorCount,
    minorCount,
    passedCount,
    recommendationCount,
    openComments,
    openTasks,
    aiFindings,
    recommendation,
    readiness,
    readinessScore,
  };
}

export function mapPackageDetail(
  p: PackageRow,
  violations: ViolationRow[],
  regulations: Regulation[],
  versions: PackageVersionRow[] = [],
  annotations: AnnotationRow[] = [],
  replyMap: Map<number, CommentReplyRow[]> = new Map(),
  tasks: ReviewTaskRow[] = [],
  approvals: ApprovalDecisionRow[] = [],
) {
  const currentVersion = versions.find((v) => v.isCurrent) ?? versions[0];
  return {
    ...mapPackage(p),
    extractedText: p.extractedText,
    ocr: p.ocr ?? null,
    recommendations: p.recommendations ?? [],
    violations: violations.map(mapViolation),
    regulations: regulations.map(mapRegulation),
    currentVersionId: currentVersion?.id ?? null,
    versions: versions.map(mapPackageVersion),
    annotations: annotations.map((a) =>
      mapAnnotation(a, replyMap.get(a.id) ?? []),
    ),
    tasks: tasks.map(mapReviewTask),
    approvals: approvals.map(mapApprovalDecision),
    scorecard: computeScorecard(p, violations, annotations, tasks),
  };
}

export function mapRegulation(r: Regulation) {
  return {
    id: r.id,
    agency: r.agency,
    category: r.category,
    ruleCode: r.ruleCode,
    title: r.title,
    summary: r.summary,
    regulationText: r.regulationText,
    section: r.section,
    source: r.source,
    publicationDate: r.publicationDate,
    createdAt: iso(r.createdAt)!,
  };
}

export function mapSupplier(s: Supplier) {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    category: s.category,
    riskLevel: s.riskLevel,
    status: s.status,
    contactEmail: s.contactEmail,
    country: s.country,
    complianceScore: s.complianceScore,
    packagesReviewed: s.packagesReviewed,
    externalSource: s.externalSource,
    externalId: s.externalId,
    externalSyncedAt: iso(s.externalSyncedAt),
    createdAt: iso(s.createdAt)!,
  };
}

export function mapSupplierContact(c: SupplierContactRow) {
  return {
    id: c.id,
    supplierId: c.supplierId,
    name: c.name,
    email: c.email,
    phone: c.phone,
    title: c.title,
    isPrimary: c.isPrimary,
    createdAt: iso(c.createdAt)!,
  };
}

export function mapSupplierSubmission(
  s: SupplierSubmissionRow,
  extra?: { supplierName?: string | null },
) {
  return {
    id: s.id,
    supplierId: s.supplierId,
    supplierName: extra?.supplierName ?? null,
    packageId: s.packageId,
    submittedByUserId: s.submittedByUserId,
    submittedByName: s.submittedByName,
    title: s.title,
    category: s.category,
    notes: s.notes,
    artworkUrl: s.artworkUrl,
    status: s.status,
    reviewerUserId: s.reviewerUserId,
    reviewerName: s.reviewerName,
    reviewNotes: s.reviewNotes,
    reviewedAt: iso(s.reviewedAt),
    createdAt: iso(s.createdAt)!,
    updatedAt: iso(s.updatedAt)!,
  };
}

export function mapSupplierScorecard(s: SupplierScorecardRow) {
  return {
    id: s.id,
    supplierId: s.supplierId,
    period: s.period,
    overallScore: s.overallScore,
    qualityScore: s.qualityScore,
    complianceScore: s.complianceScore,
    timelinessScore: s.timelinessScore,
    submissionsCount: s.submissionsCount,
    approvedCount: s.approvedCount,
    rejectedCount: s.rejectedCount,
    notes: s.notes,
    recordedByName: s.recordedByName,
    createdAt: iso(s.createdAt)!,
  };
}

export function mapSupplierStatusEvent(s: SupplierStatusHistoryRow) {
  return {
    id: s.id,
    supplierId: s.supplierId,
    fromStatus: s.fromStatus,
    toStatus: s.toStatus,
    reason: s.reason,
    actorName: s.actorName,
    createdAt: iso(s.createdAt)!,
  };
}

export function mapAuditEvent(a: AuditEventRow) {
  return {
    id: a.id,
    packageId: a.packageId,
    entityType: a.entityType,
    entityId: a.entityId,
    actor: a.actor,
    action: a.action,
    detail: a.detail,
    before: a.before ?? null,
    after: a.after ?? null,
    regulationRefs: a.regulationRefs ?? [],
    createdAt: iso(a.createdAt)!,
  };
}

export function mapNotification(n: NotificationRow) {
  return {
    id: n.id,
    userId: n.userId,
    packageId: n.packageId,
    title: n.title,
    message: n.message,
    type: n.type,
    read: n.read,
    createdAt: iso(n.createdAt)!,
  };
}

export function mapReport(r: ReportRow) {
  return {
    id: r.id,
    packageId: r.packageId,
    title: r.title,
    type: r.type,
    format: r.format,
    summary: r.summary,
    // Object-storage path of the generated file, if any. The client turns this
    // into an authorized download URL; null means nothing is downloadable yet.
    objectPath: r.objectPath,
    createdAt: iso(r.createdAt)!,
  };
}

export function mapUser(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    roleKey: u.roleKey,
    status: u.status,
    active: u.active,
    createdAt: iso(u.createdAt)!,
  };
}

export function mapTeam(
  t: TeamRow,
  members: { id: number; name: string; email: string; role: string; roleKey: string }[] = [],
) {
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? null,
    memberCount: members.length,
    members,
    createdAt: iso(t.createdAt)!,
  };
}

export function mapJob(j: JobRow) {
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    priority: j.priority,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    runAt: iso(j.runAt),
    lockedAt: iso(j.lockedAt),
    lockedBy: j.lockedBy ?? null,
    lastError: j.lastError ?? null,
    dedupeKey: j.dedupeKey ?? null,
    createdAt: iso(j.createdAt)!,
    updatedAt: iso(j.updatedAt),
  };
}
