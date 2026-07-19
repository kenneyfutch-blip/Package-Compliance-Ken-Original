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

  // ── Audit history ───────────────────────────────────────────────────
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
