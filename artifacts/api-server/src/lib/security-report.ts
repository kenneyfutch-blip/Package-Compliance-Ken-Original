// PDF generator for the security audit / posture report. Streams a pdfkit
// document built from the shared SECURITY_CONTROLS / AUDIT_HISTORY catalog so
// the downloadable report and the Security Posture admin page can never drift.
import PDFDocument from "pdfkit";
import {
  AUDIT_HISTORY,
  POSTURE_META,
  SECURITY_CONTROLS,
} from "./security-posture";

const INK = "#111827";
const MUTED = "#6b7280";
const GREEN = "#15803d";
const AMBER = "#b45309";
const RULE = "#e5e7eb";
const LINE = "#94a3b8";
const GREEN_BG = "#f0fdf4";
const GREEN_BORDER = "#bbf7d0";
const BLUE_BG = "#eff6ff";
const BLUE_BORDER = "#bfdbfe";
const AMBER_BG = "#fffbeb";
const AMBER_BORDER = "#fde68a";
const GRAY_BG = "#f8fafc";
const GRAY_BORDER = "#e2e8f0";

function diagBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  lines: string[] = [],
  fill = GRAY_BG,
  stroke = GRAY_BORDER,
  titleColor = INK,
) {
  doc.roundedRect(x, y, w, h, 6).fillAndStroke(fill, stroke);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(titleColor);
  doc.text(title, x + 4, y + 7, { width: w - 8, align: "center" });
  doc.font("Helvetica").fontSize(7).fillColor(MUTED);
  let ty = y + 19;
  for (const l of lines) {
    doc.text(l, x + 4, ty, { width: w - 8, align: "center" });
    ty += 9;
  }
}

function diagArrow(
  doc: PDFKit.PDFDocument,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label?: string,
  dashed = false,
) {
  doc.save();
  if (dashed) doc.dash(4, { space: 3 });
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(1).strokeColor(LINE).stroke();
  doc.restore();
  // Arrowhead (assumes mostly-horizontal arrows).
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const a1 = angle + Math.PI * 0.85;
  const a2 = angle - Math.PI * 0.85;
  doc
    .moveTo(x2, y2)
    .lineTo(x2 + 6 * Math.cos(a1), y2 + 6 * Math.sin(a1))
    .lineTo(x2 + 6 * Math.cos(a2), y2 + 6 * Math.sin(a2))
    .closePath()
    .fillColor(LINE)
    .fill();
  if (label) {
    doc.font("Helvetica").fontSize(6.5).fillColor(MUTED);
    doc.text(label, (x1 + x2) / 2 - 30, (y1 + y2) / 2 - 10, {
      width: 60,
      align: "center",
    });
  }
}

// Full-width technical architecture diagram, drawn with vector primitives so
// it stays sharp at any zoom. Mirrors the SVG diagram on the admin page.
function drawArchitectureDiagram(doc: PDFKit.PDFDocument, x0: number, y0: number) {
  // Clients
  diagBox(doc, x0, y0 + 20, 110, 56, "Browser (Employees)", [
    "React 19 + Vite",
    "Clerk session (httpOnly)",
    "No tokens in storage/URLs",
  ], BLUE_BG, BLUE_BORDER);
  diagBox(doc, x0, y0 + 170, 110, 44, "External AI Agents", [
    "MCP clients",
    "Bearer tokens (revocable)",
  ], AMBER_BG, AMBER_BORDER);

  // API security boundary
  const bx = x0 + 150;
  doc.save();
  doc.dash(5, { space: 3 });
  doc.roundedRect(bx, y0, 190, 236, 8).lineWidth(1).strokeColor(GREEN).stroke();
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GREEN);
  doc.text("Express 5 API — security boundary", bx, y0 + 6, { width: 190, align: "center" });
  diagBox(doc, bx + 12, y0 + 20, 166, 22, "Helmet headers · Rate limiting", [], GREEN_BG, GREEN_BORDER);
  diagBox(doc, bx + 12, y0 + 47, 166, 22, "requireAuth — session verification", [], GREEN_BG, GREEN_BORDER);
  diagBox(doc, bx + 12, y0 + 74, 166, 22, "RBAC — permission gates per route", [], GREEN_BG, GREEN_BORDER);
  diagBox(doc, bx + 12, y0 + 101, 166, 22, "Tenancy scoping — org + supplier", [], GREEN_BG, GREEN_BORDER);
  diagBox(doc, bx + 12, y0 + 128, 166, 34, "Route handlers", [
    "Ownership checks · append-only audit",
  ]);
  diagBox(doc, bx + 12, y0 + 168, 166, 44, "MCP Gateway", [
    "Own bearer auth · read-only tools",
    "same RBAC + tenancy scoping",
  ], AMBER_BG, AMBER_BORDER);

  // Backends
  const rx = bx + 230;
  diagBox(doc, rx, y0 + 8, 120, 44, "PostgreSQL", [
    "Org-scoped rows · Drizzle",
    "AI keys AES-256-GCM",
  ]);
  diagBox(doc, rx, y0 + 64, 120, 44, "Object Storage", [
    "Presigned upload URLs",
    "Ownership check on serve",
  ]);
  diagBox(doc, rx, y0 + 120, 120, 44, "AI Providers (LLMs)", [
    "SSRF-validated base URLs",
    "Prompt-injection fencing",
  ]);
  diagBox(doc, rx, y0 + 176, 120, 44, "Background Worker", [
    "Durable job queue",
    "AI analysis · routing",
  ]);

  // Flows
  diagArrow(doc, x0 + 110, y0 + 48, bx - 3, y0 + 48, "HTTPS");
  diagArrow(doc, x0 + 110, y0 + 192, bx + 9, y0 + 192, "HTTPS + token");
  diagArrow(doc, bx + 190, y0 + 30, rx - 3, y0 + 30);
  diagArrow(doc, bx + 190, y0 + 86, rx - 3, y0 + 86);
  diagArrow(doc, bx + 190, y0 + 142, rx - 3, y0 + 142);
  diagArrow(doc, bx + 190, y0 + 198, rx - 3, y0 + 198, undefined, true);
}

// Horizontal request-security-pipeline diagram.
function drawPipelineDiagram(doc: PDFKit.PDFDocument, x0: number, y0: number, totalWidth: number) {
  const steps: Array<[string, string]> = [
    ["Request", "any /api call"],
    ["Rate limit", "per user / IP"],
    ["Authenticate", "verified session"],
    ["Authorize", "permission key"],
    ["Scope", "org + supplier"],
    ["Data", "owned rows only"],
  ];
  const gap = 14;
  const w = (totalWidth - gap * (steps.length - 1)) / steps.length;
  steps.forEach(([title, sub], i) => {
    const x = x0 + i * (w + gap);
    const last = i === steps.length - 1;
    diagBox(
      doc,
      x,
      y0,
      w,
      34,
      title,
      [sub],
      last ? GREEN_BG : GRAY_BG,
      last ? GREEN_BORDER : GRAY_BORDER,
      last ? GREEN : INK,
    );
    if (!last) diagArrow(doc, x + w, y0 + 17, x + w + gap - 2, y0 + 17);
  });
}

export function buildSecurityReportPdf(): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: {
      Title: `${POSTURE_META.productName} — Security Audit & Posture Report`,
      Author: POSTURE_META.owner,
    },
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const generated = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rule = () => {
    doc.moveDown(0.4);
    doc
      .strokeColor(RULE)
      .lineWidth(1)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + pageWidth, doc.y)
      .stroke();
    doc.moveDown(0.6);
  };

  const heading = (text: string) => {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(text);
    rule();
  };

  // ── Title block ─────────────────────────────────────────────────────
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(22).text(POSTURE_META.productName);
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(14).fillColor(MUTED).text("Security Audit & Posture Report");
  doc.moveDown(0.8);
  doc.fontSize(10).fillColor(MUTED);
  doc.text(`Generated: ${generated}`);
  doc.text(`Owner: ${POSTURE_META.owner}`);
  doc.text(`Classification: ${POSTURE_META.classification}`);
  doc.text(`Technology stack: ${POSTURE_META.stack}`);
  doc.moveDown(1);

  // ── Executive summary ───────────────────────────────────────────────
  heading("Executive Summary");
  const latest = AUDIT_HISTORY[0];
  doc.font("Helvetica").fontSize(10.5).fillColor(INK);
  doc.text(
    `The most recent security audit (${latest ? latest.date : "n/a"}) covered authentication and authorization across the entire application and found ${latest ? latest.criticalFindings : 0} critical and ${latest ? latest.highFindings : 0} high-severity vulnerabilities. ${latest ? latest.outcome : ""}`,
    { lineGap: 2 },
  );
  doc.moveDown(0.5);
  const enforced = SECURITY_CONTROLS.filter((c) => c.status === "enforced").length;
  const accepted = SECURITY_CONTROLS.filter((c) => c.status === "accepted-risk").length;
  doc.text(
    `The platform maintains ${enforced} enforced security controls across authentication, authorization and tenancy, application hardening, AI safety, and audit/operations, with ${accepted} formally accepted risk${accepted === 1 ? "" : "s"} documented below.`,
    { lineGap: 2 },
  );
  doc.moveDown(1);

  // ── Architecture diagrams ───────────────────────────────────────────
  doc.addPage();
  heading("System Architecture");
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(
    "All traffic enters through a single Express security boundary. Every layer inside the boundary must pass before a request reaches data or storage.",
    { lineGap: 2 },
  );
  doc.moveDown(0.6);
  let diagY = doc.y;
  drawArchitectureDiagram(doc, doc.page.margins.left, diagY);
  doc.x = doc.page.margins.left;
  doc.y = diagY + 260;

  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Request Security Pipeline");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(
    "Every API request passes each layer in order; a failure at any layer stops the request before it reaches data.",
    { lineGap: 2 },
  );
  doc.moveDown(0.6);
  diagY = doc.y;
  drawPipelineDiagram(doc, doc.page.margins.left, diagY, pageWidth);
  doc.x = doc.page.margins.left;
  doc.y = diagY + 55;

  // ── Audit history ───────────────────────────────────────────────────
  doc.addPage();
  heading("Audit History");
  for (const audit of AUDIT_HISTORY) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(`${audit.date} — ${audit.outcome}`);
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`Scope: ${audit.scope}`, { lineGap: 2 });
    doc.moveDown(0.3);
    doc.fillColor(INK).fontSize(10);
    doc.text(
      `Findings: ${audit.criticalFindings} critical, ${audit.highFindings} high.`,
    );
    doc.moveDown(0.2);
    for (const note of audit.notes) {
      doc.text(`•  ${note}`, { indent: 10, lineGap: 2 });
    }
    doc.moveDown(0.8);
  }

  // ── Controls by category ────────────────────────────────────────────
  heading("Security Controls");
  const categories = [...new Set(SECURITY_CONTROLS.map((c) => c.category))];
  for (const category of categories) {
    if (doc.y > doc.page.height - 180) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(category);
    doc.moveDown(0.4);
    for (const control of SECURITY_CONTROLS.filter((c) => c.category === category)) {
      if (doc.y > doc.page.height - 130) doc.addPage();
      const statusLabel = control.status === "enforced" ? "ENFORCED" : "ACCEPTED RISK";
      const statusColor = control.status === "enforced" ? GREEN : AMBER;
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(control.name, { continued: true });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(statusColor).text(`   ${statusLabel}`);
      doc.moveDown(0.15);
      doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(control.description, { lineGap: 1.5 });
      doc.moveDown(0.55);
    }
    doc.moveDown(0.4);
  }

  // ── Footer note ─────────────────────────────────────────────────────
  if (doc.y > doc.page.height - 140) doc.addPage();
  rule();
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      "This report is generated from the platform's live security-posture catalog. The same catalog powers the Security Posture page in the Administration section, which additionally shows real-time system health. Update the catalog when controls change or new audit rounds complete.",
      { lineGap: 2 },
    );

  doc.end();
  return doc;
}
