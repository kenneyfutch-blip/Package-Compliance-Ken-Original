// Builds the "How We Work — Specialist Process Guide" PDF (companion to the Team Guide).
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const pdfLibPath = fs
  .readdirSync(path.join(root, "node_modules/.pnpm"))
  .find((d) => d.startsWith("pdf-lib@"));
const { PDFDocument, StandardFonts, rgb } = await import(
  url.pathToFileURL(path.join(root, "node_modules/.pnpm", pdfLibPath, "node_modules/pdf-lib/dist/pdf-lib.esm.js")).href
);

const OUT = path.join(root, "attached_assets/Packaging-Compliance-AI-Process-Guide.pdf");
const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const GREEN = rgb(0.086, 0.639, 0.29);
const DARK = rgb(0.09, 0.11, 0.1);
const GRAY = rgb(0.38, 0.42, 0.4);
const LIGHT = rgb(0.93, 0.96, 0.94);
const AMBER = rgb(0.7, 0.45, 0.05);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

function wrap(text, f, size, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (f.widthOfTextAtSize(t, size) > maxW && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

let page, y, pageNum = 0;
function newPage() {
  page = doc.addPage([PAGE_W, PAGE_H]);
  pageNum++;
  y = PAGE_H - MARGIN;
  if (pageNum > 1) {
    page.drawText("Packaging Compliance AI — How We Work", { x: MARGIN, y: PAGE_H - 30, size: 8, font, color: GRAY });
    page.drawText(String(pageNum), { x: PAGE_W - MARGIN - 10, y: 24, size: 8, font, color: GRAY });
    page.drawLine({ start: { x: MARGIN, y: PAGE_H - 38 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 38 }, thickness: 0.5, color: LIGHT });
    y = PAGE_H - 64;
  }
}
function need(h) { if (y - h < MARGIN) newPage(); }
function heading(text, size = 16) {
  need(size + 22);
  page.drawRectangle({ x: MARGIN, y: y - size + 3, width: 4, height: size + 2, color: GREEN });
  page.drawText(text, { x: MARGIN + 12, y: y - size + 6, size, font: bold, color: DARK });
  y -= size + 16;
}
function sub(text) {
  need(30);
  page.drawText(text, { x: MARGIN, y: y - 11, size: 11.5, font: bold, color: DARK });
  y -= 26;
}
function para(text, opts = {}) {
  const size = opts.size ?? 9.8;
  const lh = size * 1.45;
  const indent = opts.indent ?? 0;
  const lines = wrap(text, font, size, CONTENT_W - indent);
  for (const l of lines) {
    need(lh + 2);
    page.drawText(l, { x: MARGIN + indent, y: y - size, size, font, color: opts.color ?? DARK });
    y -= lh;
  }
  y -= opts.gap ?? 6;
}
function bullet(head, rest) {
  const size = 9.8, lh = size * 1.45;
  need(lh * 2);
  page.drawCircle({ x: MARGIN + 5, y: y - size + 3.2, size: 1.7, color: GREEN });
  const indent = 14;
  const maxW = CONTENT_W - indent;
  const headTxt = head + (rest ? " — " : "");
  const headW = bold.widthOfTextAtSize(headTxt, size);
  page.drawText(headTxt, { x: MARGIN + indent, y: y - size, size, font: bold, color: DARK });
  if (rest) {
    const words = rest.split(/\s+/);
    let line = "", x = MARGIN + indent + headW, first = true;
    const flush = () => {
      page.drawText(line, { x, y: y - size, size, font, color: DARK });
      y -= lh; x = MARGIN + indent; first = false; line = "";
      need(lh + 2);
    };
    for (const w of words) {
      const t = line ? line + " " + w : w;
      const avail = first ? maxW - headW : maxW;
      if (font.widthOfTextAtSize(t, size) > avail && line) flush();
      line = line ? line + " " + w : w;
    }
    if (line) { page.drawText(line, { x, y: y - size, size, font, color: DARK }); y -= lh; }
  } else y -= lh;
  y -= 3;
}
function callout(title, text) {
  const size = 9.5, lh = size * 1.5;
  const lines = wrap(text, font, size, CONTENT_W - 28);
  const h = 30 + lines.length * lh;
  need(h + 10);
  page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, color: rgb(0.99, 0.97, 0.92), borderColor: rgb(0.9, 0.8, 0.6), borderWidth: 0.8 });
  page.drawText(title, { x: MARGIN + 14, y: y - 20, size: 9.5, font: bold, color: AMBER });
  let ty = y - 34;
  for (const l of lines) {
    page.drawText(l, { x: MARGIN + 14, y: ty, size, font, color: DARK });
    ty -= lh;
  }
  y -= h + 12;
}

// ---------- Cover ----------
newPage();
page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.04, 0.07, 0.05) });
page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: GREEN });
page.drawText("DOLLAR TREE", { x: MARGIN, y: PAGE_H - 120, size: 13, font: bold, color: GREEN });
page.drawText("How We Work", { x: MARGIN, y: PAGE_H - 175, size: 32, font: bold, color: rgb(1, 1, 1) });
page.drawText("Specialist Process Guide for Packaging Compliance AI", { x: MARGIN, y: PAGE_H - 205, size: 15, font, color: rgb(0.8, 0.85, 0.82) });
const coverLines = [
  "The Team Guide explains what the platform can do.",
  "This guide explains how our team uses it: queue discipline, decision",
  "rules, when to escalate, and how we talk to vendors.",
];
let cy = PAGE_H - 280;
for (const l of coverLines) {
  page.drawText(l, { x: MARGIN, y: cy, size: 11.5, font, color: rgb(0.75, 0.8, 0.77) });
  cy -= 20;
}
page.drawText("July 2026  ·  Internal use  ·  Companion to the Team Guide", { x: MARGIN, y: 80, size: 10, font, color: rgb(0.55, 0.6, 0.57) });

// ---------- 1. Daily rhythm ----------
newPage();
heading("1. Your daily rhythm");
para("Start and end every day in My Work. The platform tracks assignments, due dates and escalations for you — your job is to work them in the right order.");
sub("Work your queue in this order");
bullet("1. Overdue reviews", "anything past its SLA date comes first, no exceptions.");
bullet("2. Escalated items", "reviews escalated to you carry findings someone already judged serious.");
bullet("3. High-risk queue", "packages with Critical findings or risk scores in the red.");
bullet("4. Oldest assigned first", "then work the rest of My Reviews oldest-first so nothing quietly ages out.");
sub("Daily habits");
bullet("Check My Notifications", "at the start of each session — mentions, status changes and new assignments land there.");
bullet("Clear My Tasks", "before picking up new reviews; open tasks are commitments you've already made.");
bullet("Record decisions same-day", "if you've finished reading a package, record the decision. A finished-but-undecided review is invisible work.");
callout("Rule of thumb", "If a package will sit with you for more than a day, say why — either a comment on the package or a task assigned to whoever you're waiting on. Silence is how reviews get lost.");

// ---------- 2. Reading AI findings ----------
newPage();
heading("2. How to read AI findings");
para("The AI is a first-pass reader, not a decision-maker. Treat its output the way you'd treat a thorough junior analyst: usually right, always worth verifying on anything that matters.");
bullet("Verify Critical and Major findings yourself", "open the cited regulation (one click from the finding) and confirm the rule actually applies to this product and claim.");
bullet("Check the detected text on the artwork", "make sure the finding points at real label copy, not an OCR misread. The proof pin shows you where the AI was looking.");
bullet("Low-confidence findings are questions, not violations", "the platform labels uncertain findings for human review. Answer the question — confirm or dismiss with a note — rather than passing them through.");
bullet("Dismissals need a reason", "when you dismiss a finding, write one line on why. That note feeds Compliance Memory and stops the same false positive from wasting the next reviewer's time.");
bullet("Suggested fixes are drafts", "check them against Approved Language before sending wording to a vendor. If approved phrasing exists for the situation, use it verbatim.");
callout("Never do this", "Never approve a package on the AI grade alone, and never tell a vendor 'the AI flagged it' as the whole justification. Every finding we act on should be traceable to a regulation, an internal standard, or approved language.");

// ---------- 3. Deep Analysis ----------
heading("3. When to run Deep Analysis");
para("Deep Analysis runs the package through the heavier reasoning AI tier. It is slower and costs more, so use it deliberately — not as a second opinion on everything.");
sub("Run it when");
bullet("The product is regulated territory", "disinfectants and pesticides (EPA), food and supplements (FDA), children's products (CPSC), or anything with health or efficacy claims.");
bullet("The standard pass looks wrong", "findings feel off, contradictory, or suspiciously clean for a crowded label.");
bullet("You're about to reject", "a rejection is expensive for the vendor; make sure the case is as strong and complete as it can be.");
sub("Skip it when");
bullet("Simple artwork, clean pass", "a basic package with no claims and no findings doesn't need a second, slower read.");
bullet("The issue is already obvious", "if you can see the violation and cite the rule, decide — don't run more analysis to confirm what you know.");

// ---------- 4. Decisions ----------
newPage();
heading("4. Decision rules");
para("Three outcomes exist: Approve, Revise, Reject. Every decision needs a decision note — one or two sentences is fine. The note is what the audit trail, the vendor conversation, and future reviewers rely on.");
sub("Approve");
bullet("All Critical and Major findings resolved or dismissed with reasons", "no exceptions for Critical.");
bullet("Claims substantiated", "every efficacy or origin claim either has support or has been removed from the artwork.");
bullet("You'd put your name on it", "because you are — approvals are recorded with your name and timestamp.");
sub("Revise (the default outcome)");
bullet("Fixable problems", "wrong wording, missing required elements, formatting issues. List exactly what must change; copy suggested fixes or approved language into the note or annotations.");
bullet("Export the annotated proof", "so the vendor sees each issue pinned on their own artwork, with the required correction next to it.");
sub("Reject");
bullet("Reserve for fundamental problems", "unsubstantiatable claims central to the product, prohibited ingredients or content, or repeated failure to fix the same Critical issues.");
bullet("Second set of eyes", "before rejecting, flag a manager or senior specialist in the comments. Rejections trigger vendor escalations — the case needs to be airtight.");
callout("Severity floor", "A package with an unresolved Critical finding can never be Approved, whatever the deadline pressure. If the business needs it faster, escalate — don't lower the bar.");

// ---------- 5. Escalation ----------
newPage();
heading("5. When and how to escalate");
para("Escalation is a normal tool, not an admission of failure. Use it early rather than sitting on something you're unsure about.");
bullet("Regulatory ambiguity", "you and the cited regulation genuinely don't resolve the question — escalate to the Regulatory lead rather than guessing.");
bullet("SLA at risk", "you can see you won't make the date. Escalating two days early beats explaining two days late.");
bullet("Vendor pushback on a Critical finding", "if a vendor disputes a Critical or legal-risk finding, that conversation moves up a level; don't negotiate compliance one-on-one.");
bullet("Cross-category products", "if a package straddles categories (e.g. a food item with a toy inside), escalate so routing puts both specialties on it.");
para("Use the platform's escalation action on the review itself — not a hallway conversation — so the escalation, its reason, and its resolution are all on the record.", { gap: 12 });

heading("6. Working with vendors");
bullet("Everything through the platform", "vendor-facing feedback goes out as the exported annotated proof plus the decision note. No side-channel spreadsheets or marked-up email screenshots.");
bullet("Use Approved Language", "when telling a vendor what wording to use, pull it from the Approved Language glossary so every vendor hears the same phrasing.");
bullet("Be specific and finite", "a Revise decision should read like a checklist the vendor can complete in one round. 'Fix compliance issues' is not feedback.");
bullet("New versions, fresh eyes", "when revised artwork arrives, add it as a new version and re-run analysis. Compare versions side by side; confirm each requested fix landed before looking at anything new.");
bullet("Supplier portal data is theirs alone", "never share one vendor's findings, scores or artwork with another vendor, in any form.");

// ---------- 7. Collaboration ----------
newPage();
heading("7. Working alongside each other");
bullet("Respect the lock", "if a review shows another specialist active on it, don't record decisions over them — comment or ping instead.");
bullet("Comments are the record", "decisions and disagreements about a package belong in its comment thread, where the next person can find them — not in chat apps.");
bullet("Tasks over memory", "if something needs doing later or by someone else, create a task on the package. Assigned tasks survive vacations; mental notes don't.");
bullet("Feed Compliance Memory", "good dismissal notes and clear decision notes make the AI and the team smarter on the next similar package. Write them like you're helping future-you.");
para(" ", { gap: 2 });

heading("8. Quick reference");
sub("Before you approve — 30-second checklist");
bullet("1.", "All Critical/Major findings resolved or dismissed with written reasons.");
bullet("2.", "Claims checked against substantiation; origin and warning statements present where required.");
bullet("3.", "Wording matches Approved Language where it exists.");
bullet("4.", "Decision note written — what you checked and why it passes.");
sub("Who to go to");
bullet("Tool questions", "Ask AI (top bar) or Training > FAQ.");
bullet("Regulatory interpretation", "escalate on the review to the Regulatory lead.");
bullet("Access or role problems", "your manager or a platform administrator via Training > Contact Support.");
bullet("Bugs or odd AI behavior", "Training > Contact Support, with the package number.");
para(" ", { gap: 4 });
para("This guide sets the floor, not the ceiling. When your judgment says a package needs more scrutiny than the process requires — follow your judgment, and leave a note explaining why.", { color: GRAY });

const bytes = await doc.save();
fs.writeFileSync(OUT, bytes);
console.log("Wrote", OUT, bytes.length, "bytes");
