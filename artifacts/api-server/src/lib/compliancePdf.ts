// Compliance report PDF — the "real" report generated from a package's actual
// AI analysis results (findings/violations), so the Reports page always hands
// back a downloadable document rather than a bare database row.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

type RGB = { r: number; g: number; b: number };
const INK: RGB = { r: 0.12, g: 0.14, b: 0.18 };
const MUTED: RGB = { r: 0.42, g: 0.45, b: 0.5 };
const COBALT: RGB = { r: 0.05, g: 0.36, b: 0.92 };

function sevColor(sev: string): RGB {
  const s = sev.toLowerCase();
  if (s === "critical") return { r: 0.94, g: 0.27, b: 0.27 };
  if (s === "major" || s === "high") return { r: 0.96, g: 0.62, b: 0.04 };
  if (s === "minor" || s === "medium" || s === "low") return { r: 0.92, g: 0.78, b: 0.03 };
  return { r: 0.13, g: 0.77, b: 0.37 };
}

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

export type ComplianceReportFinding = {
  title: string;
  description: string;
  severity: string;
  engine: string;
  status: string;
  regulationRef: string | null;
  recommendation: string | null;
  suggestedText: string | null;
  detectedText: string | null;
  confidence: number | null;
  humanReviewRecommended: boolean;
  disclaimer: string | null;
};

export type ComplianceReportInput = {
  title: string;
  generatedBy: string;
  generatedAt: Date;
  pkg: {
    name: string;
    sku: string;
    brand: string;
    vendor: string | null;
    category: string | null;
    grade: string | null;
    riskScore: number | null;
    complianceStatus: string;
    approvalStatus: string;
    summary: string | null;
  };
  findings: ComplianceReportFinding[];
};

export async function generateCompliancePdf(input: ComplianceReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 48;

  let page = doc.addPage([W, H]);
  let y = H - 48;
  const ensure = (needed: number) => {
    if (y - needed < M) {
      page = doc.addPage([W, H]);
      y = H - 48;
    }
  };

  // Header band
  page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: rgb(COBALT.r, COBALT.g, COBALT.b) });
  page.drawText("Compliance Report", { x: M, y: H - 46, size: 20, font: bold, color: rgb(1, 1, 1) });
  for (const line of wrap(input.title, font, 12, W - 2 * M).slice(0, 2)) {
    page.drawText(line, { x: M, y: H - 68, size: 12, font, color: rgb(1, 1, 1) });
  }
  page.drawText(
    `Generated ${input.generatedAt.toLocaleDateString("en-US")} by ${input.generatedBy}`,
    { x: M, y: H - 86, size: 9, font, color: rgb(0.85, 0.9, 1) },
  );
  y = H - 124;

  // Package metadata
  const meta = [
    `Package: ${input.pkg.name}${input.pkg.brand ? ` — ${input.pkg.brand}` : ""}`,
    `SKU: ${input.pkg.sku || "N/A"}   Vendor: ${input.pkg.vendor || "N/A"}   Category: ${input.pkg.category || "N/A"}`,
    `Grade: ${input.pkg.grade ?? "N/A"}   Risk score: ${input.pkg.riskScore ?? "N/A"}`,
    `Compliance: ${input.pkg.complianceStatus}   Approval: ${input.pkg.approvalStatus}`,
  ];
  for (const line of meta) {
    page.drawText(line, { x: M, y, size: 11, font, color: rgb(INK.r, INK.g, INK.b) });
    y -= 17;
  }

  // Severity summary from the actual findings
  const counts = new Map<string, number>();
  for (const f of input.findings) {
    const key = f.severity || "Other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  y -= 8;
  page.drawText("Findings summary", { x: M, y, size: 13, font: bold, color: rgb(INK.r, INK.g, INK.b) });
  y -= 20;
  if (input.findings.length === 0) {
    page.drawText("No findings recorded for this package.", { x: M, y, size: 11, font, color: rgb(MUTED.r, MUTED.g, MUTED.b) });
    y -= 17;
  } else {
    for (const [sev, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      const c = sevColor(sev);
      page.drawCircle({ x: M + 5, y: y + 3, size: 4, color: rgb(c.r, c.g, c.b) });
      page.drawText(`${sev}: ${n}`, { x: M + 16, y, size: 11, font, color: rgb(INK.r, INK.g, INK.b) });
      y -= 17;
    }
    page.drawText(`Total findings: ${input.findings.length}`, { x: M, y, size: 11, font: bold, color: rgb(INK.r, INK.g, INK.b) });
    y -= 17;
  }

  if (input.pkg.summary) {
    y -= 8;
    ensure(60);
    page.drawText("Executive summary", { x: M, y, size: 13, font: bold, color: rgb(INK.r, INK.g, INK.b) });
    y -= 18;
    for (const line of wrap(input.pkg.summary, font, 11, W - 2 * M)) {
      ensure(20);
      page.drawText(line, { x: M, y, size: 11, font, color: rgb(MUTED.r, MUTED.g, MUTED.b) });
      y -= 15;
    }
  }

  // Detailed findings
  y -= 12;
  ensure(48);
  page.drawText("Detailed findings", { x: M, y, size: 14, font: bold, color: rgb(INK.r, INK.g, INK.b) });
  y -= 24;

  input.findings.forEach((v, i) => {
    ensure(70);
    const c = sevColor(v.severity);
    page.drawCircle({ x: M + 4, y: y + 3, size: 4, color: rgb(c.r, c.g, c.b) });
    const header = `${i + 1}. [${(v.severity || "N/A").toUpperCase()} / ${v.engine}] ${v.title}`;
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
    if (v.detectedText) {
      for (const line of wrap(`Detected: "${v.detectedText}"`, font, 10, W - 2 * M - 16)) {
        page.drawText(line, { x: M + 16, y, size: 10, font, color: rgb(INK.r, INK.g, INK.b) });
        y -= 13;
        ensure(24);
      }
    }
    const extra: string[] = [`Status: ${v.status}`];
    if (v.regulationRef) extra.push(`Ref: ${v.regulationRef}`);
    if (v.confidence !== null) extra.push(`Confidence: ${Math.round(v.confidence)}%`);
    if (v.humanReviewRecommended) extra.push("Human review recommended");
    page.drawText(extra.join("   "), { x: M + 16, y, size: 9, font, color: rgb(COBALT.r, COBALT.g, COBALT.b) });
    y -= 13;
    const fix = v.suggestedText ?? v.recommendation;
    if (fix) {
      for (const line of wrap(`Fix: ${fix}`, font, 10, W - 2 * M - 16)) {
        page.drawText(line, { x: M + 16, y, size: 10, font, color: rgb(0.1, 0.5, 0.3) });
        y -= 13;
        ensure(24);
      }
    }
    if (v.disclaimer) {
      for (const line of wrap(`Note: ${v.disclaimer}`, font, 9, W - 2 * M - 16)) {
        page.drawText(line, { x: M + 16, y, size: 9, font, color: rgb(MUTED.r, MUTED.g, MUTED.b) });
        y -= 12;
        ensure(24);
      }
    }
    y -= 8;
  });

  return doc.save();
}
