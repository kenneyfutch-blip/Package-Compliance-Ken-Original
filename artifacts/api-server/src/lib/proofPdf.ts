import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string | null | undefined, fallback: RGB): RGB {
  if (!hex) return fallback;
  const m = hex.replace("#", "");
  if (m.length !== 6) return fallback;
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  if ([r, g, b].some((n) => Number.isNaN(n))) return fallback;
  return { r, g, b };
}

const INK: RGB = { r: 0.12, g: 0.14, b: 0.18 };
const MUTED: RGB = { r: 0.42, g: 0.45, b: 0.5 };
const COBALT: RGB = { r: 0.05, g: 0.36, b: 0.92 };

export type ProofAnnotation = {
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  color: string | null;
  text: string | null;
  source: string;
  priority: string;
  status: string;
  author: string;
  severity: string | null;
  confidence: number | null;
  regulationRef: string | null;
  suggestedFix: string | null;
};

export type ProofViolation = {
  title: string;
  description: string;
  severity: string;
  findingClass: string;
  engine: string;
  regulationRef: string | null;
  recommendation: string | null;
  suggestedText: string | null;
  detectedText: string | null;
  claimFlags: string[];
  confidence: number | null;
};

export type ProofInput = {
  pkg: {
    name: string;
    sku: string;
    brand: string;
    grade: string | null;
    riskScore: number | null;
    complianceStatus: string;
    approvalStatus: string;
    summary: string | null;
  };
  artwork: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  annotations: ProofAnnotation[];
  violations: ProofViolation[];
  scorecard: {
    criticalCount: number;
    majorCount: number;
    minorCount: number;
    passedCount: number;
    recommendationCount: number;
    openComments: number;
    openTasks: number;
    readiness: string;
    readinessScore: number;
    recommendation: string;
  };
};

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function generateProofPdf(input: ProofInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 48;

  // ---- Cover / summary page -------------------------------------------------
  let page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: rgb(COBALT.r, COBALT.g, COBALT.b) });
  page.drawText("Annotated Compliance Proof", {
    x: M,
    y: H - 52,
    size: 20,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(`${input.pkg.name} — ${input.pkg.brand}`, {
    x: M,
    y: H - 74,
    size: 12,
    font,
    color: rgb(1, 1, 1),
  });

  let y = H - 120;
  const meta = [
    `SKU: ${input.pkg.sku}`,
    `Grade: ${input.pkg.grade ?? "N/A"}   Risk: ${input.pkg.riskScore ?? "N/A"}`,
    `Compliance: ${input.pkg.complianceStatus}   Approval: ${input.pkg.approvalStatus}`,
    `Readiness: ${input.scorecard.readiness} (${input.scorecard.readinessScore}/100)`,
  ];
  for (const line of meta) {
    page.drawText(line, { x: M, y, size: 11, font, color: rgb(INK.r, INK.g, INK.b) });
    y -= 18;
  }

  y -= 10;
  page.drawText("Findings summary", { x: M, y, size: 13, font: bold, color: rgb(INK.r, INK.g, INK.b) });
  y -= 22;
  const counts: Array<[string, number, string]> = [
    ["Critical", input.scorecard.criticalCount, "#ef4444"],
    ["Major", input.scorecard.majorCount, "#f59e0b"],
    ["Minor", input.scorecard.minorCount, "#eab308"],
    ["Passed", input.scorecard.passedCount, "#22c55e"],
    ["Recommendations", input.scorecard.recommendationCount, "#8b5cf6"],
    ["Open comments", input.scorecard.openComments, "#3b82f6"],
    ["Open tasks", input.scorecard.openTasks, "#6366f1"],
  ];
  for (const [label, count, color] of counts) {
    const c = hexToRgb(color, INK);
    page.drawCircle({ x: M + 5, y: y + 3, size: 4, color: rgb(c.r, c.g, c.b) });
    page.drawText(`${label}: ${count}`, { x: M + 16, y, size: 11, font, color: rgb(INK.r, INK.g, INK.b) });
    y -= 18;
  }

  y -= 8;
  page.drawText("Recommendation", { x: M, y, size: 13, font: bold, color: rgb(INK.r, INK.g, INK.b) });
  y -= 18;
  for (const line of wrap(input.scorecard.recommendation, font, 11, W - 2 * M)) {
    page.drawText(line, { x: M, y, size: 11, font, color: rgb(MUTED.r, MUTED.g, MUTED.b) });
    y -= 16;
  }
  if (input.pkg.summary) {
    y -= 8;
    page.drawText("Executive summary", { x: M, y, size: 13, font: bold, color: rgb(INK.r, INK.g, INK.b) });
    y -= 18;
    for (const line of wrap(input.pkg.summary, font, 11, W - 2 * M)) {
      page.drawText(line, { x: M, y, size: 11, font, color: rgb(MUTED.r, MUTED.g, MUTED.b) });
      y -= 16;
    }
  }

  // ---- Artwork page with markers -------------------------------------------
  const placed = input.annotations.filter((a) => a.x !== null && a.y !== null);
  if (input.artwork) {
    const art = doc.addPage([W, H]);
    art.drawText("Marked-up artwork", { x: M, y: H - 40, size: 14, font: bold, color: rgb(INK.r, INK.g, INK.b) });
    let img;
    try {
      img =
        input.artwork.type === "png"
          ? await doc.embedPng(input.artwork.bytes)
          : await doc.embedJpg(input.artwork.bytes);
    } catch {
      img = null;
    }
    if (img) {
      const maxW = W - 2 * M;
      const maxH = H - 140;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (W - dw) / 2;
      const dy = H - 70 - dh;
      art.drawImage(img, { x: dx, y: dy, width: dw, height: dh });
      art.drawRectangle({ x: dx, y: dy, width: dw, height: dh, borderColor: rgb(0.8, 0.82, 0.85), borderWidth: 1 });

      placed.forEach((a, i) => {
        const c = hexToRgb(a.color, { r: 0.9, g: 0.2, b: 0.2 });
        const px = dx + (a.x ?? 0) * dw;
        // PDF y is bottom-up; annotation y is top-down normalized.
        const py = dy + dh - (a.y ?? 0) * dh;
        if (a.w && a.h) {
          art.drawRectangle({
            x: px,
            y: py - a.h * dh,
            width: a.w * dw,
            height: a.h * dh,
            borderColor: rgb(c.r, c.g, c.b),
            borderWidth: 1.5,
          });
        }
        art.drawCircle({ x: px, y: py, size: 8, color: rgb(c.r, c.g, c.b) });
        art.drawText(String(i + 1), {
          x: px - (i + 1 >= 10 ? 5 : 2.5),
          y: py - 3.5,
          size: 8,
          font: bold,
          color: rgb(1, 1, 1),
        });
      });
    } else {
      art.drawText("(Artwork could not be rendered in this format.)", {
        x: M,
        y: H - 80,
        size: 11,
        font,
        color: rgb(MUTED.r, MUTED.g, MUTED.b),
      });
    }
  }

  // ---- Findings + comments pages -------------------------------------------
  page = doc.addPage([W, H]);
  y = H - 48;
  const ensure = (needed: number) => {
    if (y - needed < M) {
      page = doc.addPage([W, H]);
      y = H - 48;
    }
  };

  page.drawText("Findings", { x: M, y, size: 14, font: bold, color: rgb(INK.r, INK.g, INK.b) });
  y -= 24;

  if (input.violations.length === 0) {
    page.drawText("No findings recorded.", { x: M, y, size: 11, font, color: rgb(MUTED.r, MUTED.g, MUTED.b) });
    y -= 18;
  }
  input.violations.forEach((v, i) => {
    ensure(64);
    const dot = hexToRgb(
      v.findingClass === "passed"
        ? "#22c55e"
        : v.findingClass === "warning"
          ? "#f59e0b"
          : v.findingClass === "recommendation"
            ? "#8b5cf6"
            : "#ef4444",
      INK,
    );
    page.drawCircle({ x: M + 4, y: y + 3, size: 4, color: rgb(dot.r, dot.g, dot.b) });
    const header = `${i + 1}. [${v.severity.toUpperCase()} / ${v.engine}] ${v.title}`;
    for (const line of wrap(header, bold, 11, W - 2 * M - 16)) {
      page.drawText(line, { x: M + 16, y, size: 11, font: bold, color: rgb(INK.r, INK.g, INK.b) });
      y -= 15;
      ensure(30);
    }
    for (const line of wrap(v.description, font, 10, W - 2 * M - 16)) {
      page.drawText(line, { x: M + 16, y, size: 10, font, color: rgb(MUTED.r, MUTED.g, MUTED.b) });
      y -= 13;
      ensure(30);
    }
    const extra: string[] = [];
    if (v.regulationRef) extra.push(`Ref: ${v.regulationRef}`);
    if (v.confidence !== null) extra.push(`Confidence: ${v.confidence}%`);
    if (v.claimFlags.length) extra.push(`Review: ${v.claimFlags.join(", ")}`);
    if (extra.length) {
      page.drawText(extra.join("   "), { x: M + 16, y, size: 9, font, color: rgb(COBALT.r, COBALT.g, COBALT.b) });
      y -= 13;
    }
    const fix = v.suggestedText ?? v.recommendation;
    if (fix) {
      for (const line of wrap(`Fix: ${fix}`, font, 10, W - 2 * M - 16)) {
        page.drawText(line, { x: M + 16, y, size: 10, font, color: rgb(0.1, 0.5, 0.3) });
        y -= 13;
        ensure(24);
      }
    }
    y -= 8;
  });

  // Human comments
  const comments = input.annotations.filter((a) => a.source === "human");
  if (comments.length) {
    ensure(40);
    y -= 6;
    page.drawText("Reviewer comments", { x: M, y, size: 14, font: bold, color: rgb(INK.r, INK.g, INK.b) });
    y -= 22;
    comments.forEach((a, i) => {
      ensure(40);
      const head = `${i + 1}. ${a.author} — ${a.priority} / ${a.status}`;
      page.drawText(head, { x: M, y, size: 10, font: bold, color: rgb(INK.r, INK.g, INK.b) });
      y -= 14;
      for (const line of wrap(a.text ?? "", font, 10, W - 2 * M)) {
        page.drawText(line, { x: M, y, size: 10, font, color: rgb(MUTED.r, MUTED.g, MUTED.b) });
        y -= 13;
        ensure(24);
      }
      y -= 6;
    });
  }

  return doc.save();
}
