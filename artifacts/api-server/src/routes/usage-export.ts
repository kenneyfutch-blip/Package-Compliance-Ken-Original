// Pure helpers for the AI usage CSV export (`GET /ai-usage/export`). Kept in a
// separate, DB-free module so the CSV formatting and keyset-paging logic can be
// unit-tested without a database.

// Friendly workload labels for the CSV export (mirrors the client
// OPERATION_LABELS so the finance-facing file is readable).
export const WORKLOAD_LABELS: Record<string, string> = {
  packaging_analysis: "Packaging analysis",
  language_review: "Language review",
  copilot: "Compliance copilot",
  ocr: "Artwork OCR",
  field_extraction: "Metadata extraction",
  version_compare: "Version comparison",
};

// How many rows to pull from the DB per page while streaming the export, so a
// large date range never materializes the whole ledger in memory at once.
export const EXPORT_PAGE_SIZE = 1000;

export const EXPORT_COLUMNS = [
  "Timestamp (UTC)",
  "Operation",
  "Operation code",
  "Review type",
  "Model",
  "Tier",
  "User",
  "Prompt tokens",
  "Completion tokens",
  "Total tokens",
  "Estimated cost (USD)",
  "Duration (ms)",
  "Status",
  "Escalated",
  "Risk score",
  "Confidence",
  "Error message",
  "Request ID",
] as const;

// Leading characters that make a spreadsheet treat a cell as a formula. A cell
// that begins with one of these is a CSV-injection vector when opened in
// Excel/Google Sheets.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

// Serialize a single CSV field.
//   1. Neutralize spreadsheet formula injection: any *text* value that starts
//      with a formula trigger is prefixed with a single quote so it renders as
//      literal text. Numbers are emitted as-is (our numeric columns are produced
//      as JS numbers and are always non-negative, so they never start with a
//      trigger and must stay machine-readable for finance).
//   2. RFC 4180 quoting: wrap in quotes and double embedded quotes whenever the
//      value contains a comma, quote, CR, or LF.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value !== "number" && FORMULA_TRIGGER.test(s)) {
    s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

// Row shape (subset) an export row must supply to be formatted.
export interface ExportRow {
  createdAt: Date | string;
  workload: string;
  reviewType: string | null;
  model: string;
  tier: string | null;
  userName: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  success: boolean;
  escalated: boolean;
  riskScore: number | null;
  confidence: number | null;
  errorMessage: string | null;
  requestId: string;
}

// Map a ledger row to the ordered cell values matching EXPORT_COLUMNS.
export function formatExportRow(r: ExportRow): unknown[] {
  return [
    r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    WORKLOAD_LABELS[r.workload] ?? r.workload,
    r.workload,
    r.reviewType,
    r.model,
    r.tier ?? "",
    r.userName ?? "",
    r.promptTokens,
    r.completionTokens,
    r.totalTokens,
    r.costUsd,
    r.durationMs,
    r.success ? "success" : "error",
    r.escalated ? "yes" : "no",
    r.riskScore ?? "",
    r.confidence ?? "",
    r.errorMessage ?? "",
    r.requestId,
  ];
}

// Keyset (seek) pagination cursor. Ordering is (createdAt DESC, id DESC); id is
// the unique tie-breaker so rows sharing a createdAt are never skipped or
// duplicated across pages, and concurrent inserts during the export can't shift
// a row onto a page we've already read (as OFFSET paging would).
export interface Cursor {
  createdAt: Date;
  id: number;
}

// True when `row` sorts strictly after `cursor` under (createdAt DESC, id DESC),
// i.e. `row` belongs on a page after the one that ended at `cursor`.
export function isAfterCursor(cursor: Cursor, row: Cursor): boolean {
  const rt = row.createdAt.getTime();
  const ct = cursor.createdAt.getTime();
  if (rt !== ct) return rt < ct;
  return row.id < cursor.id;
}

// Pure in-memory model of the DB keyset scan, used by tests to prove that paging
// covers every row exactly once even when timestamps collide. `sorted` must
// already be in (createdAt DESC, id DESC) order — the same order the route asks
// the database for.
export function keysetPages<T extends Cursor>(
  sorted: readonly T[],
  pageSize: number,
): T[][] {
  const pages: T[][] = [];
  let cursor: Cursor | null = null;
  for (;;) {
    const active: Cursor | null = cursor;
    const remaining: readonly T[] =
      active === null ? sorted : sorted.filter((r) => isAfterCursor(active, r));
    const page: T[] = remaining.slice(0, pageSize);
    if (page.length === 0) break;
    pages.push(page);
    const last: T = page[page.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
    if (page.length < pageSize) break;
  }
  return pages;
}
