// Line-based text diff for SOP version comparison.
//
// Produces aligned side-by-side rows (left = older version, right = newer) with a
// per-row classification so the UI can highlight what changed between two SOP
// document versions. A run of removed lines immediately followed by added lines
// is paired up into "changed" rows (a line was edited) with any surplus rendered
// as pure additions/removals — this reads far better side-by-side than emitting
// separate remove/add blocks.

export type SopDiffRowType = "unchanged" | "added" | "removed" | "changed";

export interface SopDiffRow {
  type: SopDiffRowType;
  left: string | null;
  right: string | null;
}

export interface SopDiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

interface Op {
  type: "eq" | "del" | "ins";
  line: string;
}

// Normalize document text into comparable lines. Blank lines are collapsed so
// whitespace churn between versions doesn't drown out real content changes.
function toLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""));
}

// Classic LCS dynamic-programming diff over lines.
function lcsDiff(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", line: a[i]! });
      i++;
    } else {
      ops.push({ type: "ins", line: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", line: a[i++]! });
  while (j < m) ops.push({ type: "ins", line: b[j++]! });
  return ops;
}

export function diffSopText(
  oldText: string | null | undefined,
  newText: string | null | undefined,
): { rows: SopDiffRow[]; summary: SopDiffSummary } {
  const a = toLines(oldText ?? "");
  const b = toLines(newText ?? "");
  const ops = lcsDiff(a, b);

  const rows: SopDiffRow[] = [];
  const summary: SopDiffSummary = { added: 0, removed: 0, changed: 0, unchanged: 0 };

  let delBuf: string[] = [];
  let insBuf: string[] = [];

  const flush = () => {
    const paired = Math.min(delBuf.length, insBuf.length);
    for (let k = 0; k < paired; k++) {
      rows.push({ type: "changed", left: delBuf[k]!, right: insBuf[k]! });
      summary.changed++;
    }
    for (let k = paired; k < delBuf.length; k++) {
      rows.push({ type: "removed", left: delBuf[k]!, right: null });
      summary.removed++;
    }
    for (let k = paired; k < insBuf.length; k++) {
      rows.push({ type: "added", left: null, right: insBuf[k]! });
      summary.added++;
    }
    delBuf = [];
    insBuf = [];
  };

  for (const op of ops) {
    if (op.type === "del") {
      delBuf.push(op.line);
    } else if (op.type === "ins") {
      insBuf.push(op.line);
    } else {
      flush();
      rows.push({ type: "unchanged", left: op.line, right: op.line });
      summary.unchanged++;
    }
  }
  flush();

  return { rows, summary };
}
