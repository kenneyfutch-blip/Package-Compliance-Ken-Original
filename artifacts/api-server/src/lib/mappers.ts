import type {
  PackageRow,
  ViolationRow,
  Regulation,
  Supplier,
  AuditEventRow,
  NotificationRow,
  ReportRow,
  UserRow,
} from "@workspace/db";

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
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
    reviewer: p.reviewer,
    artworkUrl: p.artworkUrl,
    summary: p.summary,
    criticalCount: p.criticalCount,
    majorCount: p.majorCount,
    minorCount: p.minorCount,
    analyzedAt: iso(p.analyzedAt),
    createdAt: iso(p.createdAt)!,
    updatedAt: iso(p.updatedAt)!,
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
    status: v.status,
    createdAt: iso(v.createdAt)!,
  };
}

export function mapPackageDetail(
  p: PackageRow,
  violations: ViolationRow[],
  regulations: Regulation[],
) {
  return {
    ...mapPackage(p),
    extractedText: p.extractedText,
    ocr: p.ocr ?? null,
    recommendations: p.recommendations ?? [],
    violations: violations.map(mapViolation),
    regulations: regulations.map(mapRegulation),
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
    contactEmail: s.contactEmail,
    country: s.country,
    complianceScore: s.complianceScore,
    packagesReviewed: s.packagesReviewed,
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
