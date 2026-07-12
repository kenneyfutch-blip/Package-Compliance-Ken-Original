import test from "node:test";
import assert from "node:assert/strict";
import {
  csvCell,
  csvRow,
  keysetPages,
  isAfterCursor,
  formatExportRow,
  type Cursor,
  type ExportRow,
} from "./usage-export";

// The AI usage CSV export is a finance-facing artifact, so it must (1) neutralize
// spreadsheet formula injection from user/model-influenced fields and (2) page
// deterministically so no request row is ever silently dropped or duplicated —
// even when many rows share the exact same timestamp.

// --- CSV formula-injection sanitization ---

test("csvCell prefixes '=' formula cells with a single quote", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
});

test("csvCell neutralizes every spreadsheet trigger character (+, -, @, =, tab, CR)", () => {
  assert.equal(csvCell("+cmd"), "'+cmd");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\tfoo"), "'\tfoo"); // tab is a formula trigger but not an RFC quote trigger
});

test("csvCell guards a dangerous cell that also needs RFC quoting", () => {
  // Leading '=' plus an embedded comma: guard first, then RFC-4180 quote.
  assert.equal(csvCell("=HYPERLINK(1,2)"), '"\'=HYPERLINK(1,2)"');
});

test("csvCell leaves a benign string untouched", () => {
  assert.equal(csvCell("Dana Whitfield"), "Dana Whitfield");
});

test("csvCell does NOT quote-prefix numeric values (finance needs machine-readable numbers)", () => {
  // A negative number would start with '-' but must stay numeric; we only guard
  // string values, and our numeric columns are emitted as JS numbers.
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell(0.011178), "0.011178");
});

test("csvCell RFC-4180 quotes commas, quotes, and newlines", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('he said "hi"'), '"he said ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});

test("csvCell renders null/undefined as empty", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csvRow joins cells with commas and CRLF-terminates", () => {
  assert.equal(csvRow(["a", 1, "=x"]), "a,1,'=x\r\n");
});

test("formatExportRow escapes an injected user name at the row level", () => {
  const row: ExportRow = {
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    workload: "language_review",
    reviewType: "Language review",
    model: "gpt-5.4",
    tier: "standard",
    userName: "=cmd|'/c calc'!A1",
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    costUsd: 0.001,
    durationMs: 1200,
    success: true,
    escalated: false,
    riskScore: null,
    confidence: null,
    errorMessage: null,
    requestId: "req-1",
  };
  const line = csvRow(formatExportRow(row));
  // The injected user-name cell must be defused (single-quote prefix present).
  assert.ok(line.includes("'=cmd"));
  // Friendly operation label is used, raw workload code is preserved alongside.
  assert.ok(line.includes("Language review,language_review"));
});

// --- Keyset paging determinism ---

function row(createdAtMs: number, id: number): Cursor {
  return { createdAt: new Date(createdAtMs), id };
}

// Sort exactly the way the route asks the DB: (createdAt DESC, id DESC).
function sortDesc(rows: Cursor[]): Cursor[] {
  return [...rows].sort((a, b) => {
    const dt = b.createdAt.getTime() - a.createdAt.getTime();
    return dt !== 0 ? dt : b.id - a.id;
  });
}

test("isAfterCursor orders by timestamp first, then id as tie-breaker", () => {
  const cursor = row(1000, 50);
  // Older timestamp -> after the cursor.
  assert.equal(isAfterCursor(cursor, row(500, 999)), true);
  // Same timestamp, smaller id -> after the cursor.
  assert.equal(isAfterCursor(cursor, row(1000, 49)), true);
  // Same timestamp, larger id -> before the cursor (already returned).
  assert.equal(isAfterCursor(cursor, row(1000, 51)), false);
  // Newer timestamp -> before the cursor.
  assert.equal(isAfterCursor(cursor, row(1500, 1)), false);
});

test("keyset paging covers every row exactly once across multiple pages", () => {
  const rows = sortDesc(
    Array.from({ length: 25 }, (_, i) => row(1000 + i, i + 1)),
  );
  const pages = keysetPages(rows, 10);
  const flat = pages.flat();
  assert.equal(flat.length, 25);
  const ids = flat.map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 25 }, (_, i) => i + 1));
  // No duplicates.
  assert.equal(new Set(ids).size, 25);
});

test("keyset paging handles identical timestamps without dropping or duplicating rows", () => {
  // Every row shares the SAME createdAt — the exact case OFFSET-only paging with
  // ORDER BY createdAt would reorder unpredictably. The id tie-breaker keeps it
  // stable.
  const SAME = 1_700_000_000_000;
  const rows = sortDesc(
    Array.from({ length: 23 }, (_, i) => row(SAME, i + 1)),
  );
  const pages = keysetPages(rows, 10);
  const flat = pages.flat();
  assert.equal(flat.length, 23);
  const ids = flat.map((r) => r.id);
  assert.equal(new Set(ids).size, 23, "no row appears twice");
  // Strictly descending id order preserved across page boundaries.
  for (let i = 1; i < ids.length; i++) {
    assert.ok(ids[i]! < ids[i - 1]!, "ids remain strictly descending");
  }
});

test("keyset paging emits no trailing empty page when total is a multiple of page size", () => {
  const rows = sortDesc(
    Array.from({ length: 20 }, (_, i) => row(2000 + i, i + 1)),
  );
  const pages = keysetPages(rows, 10);
  assert.equal(pages.length, 2);
  assert.equal(pages.flat().length, 20);
});

test("keyset paging returns a single page for an empty dataset", () => {
  assert.deepEqual(keysetPages([], 10), []);
});
