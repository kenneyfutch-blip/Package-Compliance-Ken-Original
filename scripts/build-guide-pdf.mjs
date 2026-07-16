// Builds the "Packaging Compliance AI — Team Guide" PDF with screenshots.
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

const SHOTS = path.join(root, "attached_assets/guide_shots");
const OUT = path.join(root, "attached_assets/Packaging-Compliance-AI-Team-Guide.pdf");

const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const GREEN = rgb(0.086, 0.639, 0.29); // brand green-600
const DARK = rgb(0.09, 0.11, 0.1);
const GRAY = rgb(0.38, 0.42, 0.4);
const LIGHT = rgb(0.93, 0.96, 0.94);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

function wrap(text, f, size, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (f.widthOfTextAtSize(t, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
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
    page.drawText("Packaging Compliance AI — Team Guide", { x: MARGIN, y: PAGE_H - 30, size: 8, font, color: GRAY });
    page.drawText(String(pageNum), { x: PAGE_W - MARGIN - 10, y: 24, size: 8, font, color: GRAY });
    page.drawLine({ start: { x: MARGIN, y: PAGE_H - 38 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 38 }, thickness: 0.5, color: LIGHT });
    y = PAGE_H - 64;
  }
}
function need(h) { if (y - h < MARGIN) newPage(); }
function heading(text, size = 17) {
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
  const maxW = CONTENT_W - indent;
  const lines = wrap(text, font, size, maxW);
  for (const [i, l] of lines.entries()) {
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
  // draw head bold then wrap rest
  const headTxt = head + (rest ? " — " : "");
  const headW = bold.widthOfTextAtSize(headTxt, size);
  page.drawText(headTxt, { x: MARGIN + indent, y: y - size, size, font: bold, color: DARK });
  if (rest) {
    let remaining = rest;
    // first line continues after head
    let firstW = maxW - headW;
    const words = remaining.split(/\s+/);
    let line = "";
    let x = MARGIN + indent + headW;
    let first = true;
    const flush = () => {
      if (!first) { need(lh + 2); }
      page.drawText(line, { x, y: y - size, size, font, color: DARK });
      y -= lh;
      x = MARGIN + indent;
      first = false;
      line = "";
    };
    for (const w of words) {
      const t = line ? line + " " + w : w;
      const avail = first ? firstW : maxW;
      if (font.widthOfTextAtSize(t, size) > avail && line) flush();
      line = line ? line + " " + w : w;
      if (first && font.widthOfTextAtSize(line, size) > firstW && !line.includes(" ")) {
        // single long word won't fit after head; move to next line
        flush();
      }
    }
    if (line) { if (!first) need(lh + 2); page.drawText(line, { x, y: y - size, size, font, color: DARK }); y -= lh; }
  } else {
    y -= lh;
  }
  y -= 3;
}
async function shot(file, caption) {
  const bytes = fs.readFileSync(path.join(SHOTS, file));
  const img = await doc.embedJpg(bytes);
  const w = CONTENT_W;
  const h = (img.height / img.width) * w;
  need(h + 26);
  page.drawRectangle({ x: MARGIN - 1, y: y - h - 1, width: w + 2, height: h + 2, borderColor: rgb(0.8, 0.84, 0.81), borderWidth: 1 });
  page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
  y -= h + 6;
  if (caption) {
    page.drawText(caption, { x: MARGIN, y: y - 8, size: 8, font, color: GRAY });
    y -= 20;
  } else y -= 10;
}

// ---------- Cover ----------
newPage();
page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.04, 0.07, 0.05) });
page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: GREEN });
page.drawText("DOLLAR TREE", { x: MARGIN, y: PAGE_H - 120, size: 13, font: bold, color: GREEN });
page.drawText("Packaging Compliance AI", { x: MARGIN, y: PAGE_H - 175, size: 32, font: bold, color: rgb(1, 1, 1) });
page.drawText("Team Guide & Capability Overview", { x: MARGIN, y: PAGE_H - 205, size: 15, font, color: rgb(0.8, 0.85, 0.82) });
const coverLines = [
  "Catch compliance issues before they reach the shelf.",
  "",
  "This guide introduces the internal AI platform that reads packaging artwork,",
  "checks it against federal regulations and Dollar Tree standards, and routes",
  "every review to the right specialist.",
];
let cy = PAGE_H - 280;
for (const l of coverLines) {
  page.drawText(l, { x: MARGIN, y: cy, size: 11.5, font, color: rgb(0.75, 0.8, 0.77) });
  cy -= 20;
}
page.drawText("July 2026  ·  Internal use", { x: MARGIN, y: 80, size: 10, font, color: rgb(0.55, 0.6, 0.57) });

// ---------- 1. What it is ----------
newPage();
heading("1. What is Packaging Compliance AI?");
para("Packaging Compliance AI is our internal platform for reviewing packaging artwork before it goes to print. You upload a label or package design, and the AI reads every word on it, checks it against FDA, FTC, EPA, CPSC, USDA and Prop 65 requirements plus our own internal standards, and hands you a prioritized list of findings with suggested fixes and regulation citations.");
para("It replaces the slow parts of a compliance review — hunting through regulations, retyping label copy, comparing versions by eye — while keeping every decision in human hands. The AI flags and explains; a reviewer approves, revises, or rejects.");
sub("What it does for you");
bullet("Speed", "a full first-pass compliance read of a package takes minutes, not hours.");
bullet("Coverage", "every package gets the same systematic check across claims, warnings, ingredient labeling, country-of-origin, allergens, and marketing language.");
bullet("Traceability", "each finding cites the regulation behind it, every decision is logged, and annotated proof PDFs can be exported for vendors.");
bullet("One place to work", "reviews, regulations, vendor history, SOPs, approved language, and team workload all live in a single app.");
sub("Important guardrail");
para("AI findings are assistance, not legal determinations. Low-confidence findings are always presented as items to verify, never as definitive violations, and final approval always rests with a human reviewer.");
await shot("home.jpg", "The sign-in page — use your Dollar Tree account.");

// ---------- 2. Getting around ----------
newPage();
heading("2. Getting around: the Command Center");
para("After signing in you land on the Command Center dashboard. It shows your review volume, pass rate, critical violations needing action, language-quality scores, 30-day compliance trends, and the lowest-performing vendors — all scoped to what your role lets you see.");
bullet("Left sidebar", "My Work (dashboard, reviews, tasks, notifications), Packages, AI tools, Suppliers, Operations, Resources, and Training.");
bullet("Top bar", "global search across packages, SKUs and vendors; Analytics, Team Management, and Administration menus; the green New Package button; and Ask AI.");
bullet("Favorites", "click the star icon to pin the tools you use most to your own quick-access list.");
bullet("Dark mode", "the moon icon toggles light and dark themes.");
await shot("dashboard.jpg", "Command Center — your live compliance overview.");

// ---------- 3. Uploading ----------
newPage();
heading("3. Submitting artwork: New Package");
para("Everything starts with a package record. Click New Package and drag in your artwork — PNG, JPG and PDF render as interactive proofs; AI and INDD files are tracked as attachments. Files up to 100 MB are supported.");
bullet("Package metadata", "SKU, UPC, product name, brand, vendor, category and country. The category drives which regulations the AI checks and which team the review routes to.");
bullet("Artwork text", "optional — paste label copy if you have it. Otherwise the built-in document AI extracts the text straight from the artwork with OCR.");
bullet("Duplicate guard", "if a SKU or UPC already exists you get a warning before a second record is created.");
bullet("What happens next", "the package enters AI Review automatically: text extraction, regulation matching, claims audit and language review all run in the background, and the package lands in Needs Review with its findings ready.");
await shot("upload.jpg", "Upload Package — drag in artwork and fill in the product identifiers.");

// ---------- 4. Review workspace ----------
newPage();
heading("4. The Review Workspace");
para("Open any package to enter the Review Workspace — the heart of the tool. The left side shows the artwork proof with annotation tools; the right side holds tabbed panels for everything the AI found and everything your team has said or done.");
bullet("Grade, risk & readiness", "an at-a-glance compliance grade (A–F), a 0–100 risk score, and a readiness status (Approved / Needs Revision / Rejected).");
bullet("Document AI tab", "the OCR-extracted text of the artwork, so you can search and copy label copy without retyping.");
bullet("Findings tab", "each AI finding with severity, confidence, the exact text it detected, the regulation it cites, and a suggested correction you can copy.");
bullet("Proof annotations", "pin comments directly on the artwork, draw shapes, and toggle AI pins vs. reviewer pins. Versions are compared side by side when a vendor sends revised art.");
bullet("Comments & Tasks", "threaded discussion and actionable follow-ups tied to the package.");
bullet("Decisions", "Approve, Revise, or Reject with a decision note. Every decision is recorded with your name and timestamp in the audit trail.");
bullet("Deep Analysis", "escalates the package to the heavier reasoning AI tier for a more thorough pass when something looks risky.");
bullet("Export Proof", "produces an annotated PDF with all findings and comments — ready to send to the vendor.");
await shot("review.jpg", "Review Workspace — artwork proof, AI findings, and the approval decision in one screen.");

// ---------- 5. AI analysis ----------
newPage();
heading("5. What the AI actually checks");
para("Several specialized engines run on every package. Their combined output is what you see in Findings, and each engine also has its own center under the AI section of the sidebar for cross-package views.");
bullet("Violations Center", "every compliance finding across all packages, prioritized by severity, filterable by agency and category, each with a suggested fix and a jump straight into the review.");
bullet("Claims Compliance", "marketing and efficacy claims (\u0022kills 99.9% of germs\u0022, \u0022BPA free\u0022, \u0022made in USA\u0022) audited against FTC, EPA and FDA substantiation rules. High-risk claims escalate to the deeper AI tier automatically.");
bullet("Language Review", "a six-layer copy check — spelling, grammar, context, regulatory wording, marketing tone and brand terms — rolled into the package quality score you see on the dashboard.");
bullet("Compliance Heatmaps", "visual clustering of where risk concentrates across categories and vendors.");
bullet("Compliance Memory", "institutional knowledge: the system recalls similar past findings and fixes and feeds them into new analyses, so lessons learned stick.");
bullet("Fix suggestions", "AI-suggested corrections are clearly marked, and uncertain findings are labeled for human verification rather than presented as violations.");
await shot("violations.jpg", "Violations Center — every finding across all packages, prioritized by severity.");

// ---------- 6. AI Workspace ----------
newPage();
heading("6. The AI Workspace & Ask AI");
para("Beyond automated package analysis, you can talk to the platform directly. The AI Workspace is a chat environment staffed by AI specialists — each a persona tuned for a different job, with access to live, permission-scoped platform data.");
bullet("AI specialists", "a General Assistant for everyday questions, a Compliance Analyst for package and findings data, a Regulatory Expert for rule interpretation, and more. Pick one from the chips at the top.");
bullet("Grounded answers", "specialists query the platform's real data — your packages, findings, vendors, regulations — and cite their sources in the reply. They only see what your role allows.");
bullet("Attachments", "drop a PDF or text file into the chat to ask questions about it.");
bullet("Conversations", "chats are saved, searchable, and can be favorited.");
bullet("Ask AI side panel", "from any page, the black Ask AI button opens a slide-in assistant that answers questions and links you to the right tool without losing your place.");
await shot("ai-workspace.jpg", "AI Workspace — chat with a specialist grounded in live platform data.");

// ---------- 7. Regulatory knowledge ----------
newPage();
heading("7. Regulatory knowledge, built in");
para("The same regulatory content the AI checks against is available to you as a reference library — no more hunting across agency websites.");
bullet("Regulatory Knowledge Base", "searchable FDA, FTC, EPA, CPSC and USDA rules with plain-English summaries, section numbers, and links to full text. Synced weekly from the federal eCFR.");
bullet("FDA Recalls & Sources", "live enforcement actions and recall data from openFDA, filterable by product category.");
bullet("Regulatory Updates", "a feed of recent changes to the synced rules.");
bullet("Resource Center", "one hub for regulatory libraries, internal standards & SOPs, the policy repository, uploadable SOP documents with version history and diffs, and the approved language glossary.");
bullet("Internal standards", "our own policies are first-class rules: the AI enforces them during analysis just like federal regulations, and flags conflicts with internal wording standards.");
bullet("Approved Language & Glossary", "pre-approved compliance phrasing you can search and paste, also fed into the language review engine automatically.");
await shot("regulations.jpg", "Regulatory Knowledge Base — searchable federal rules with citations.");
await shot("resources.jpg", "Resource Center — every compliance reference in one place.");

// ---------- 8. Suppliers ----------
newPage();
heading("8. Vendors & the Supplier Portal");
para("Vendor performance is tracked automatically from review outcomes, and suppliers can participate directly without seeing anything beyond their own data.");
bullet("Vendor Directory", "master list of suppliers with status lifecycle, contacts, and their linked packages.");
bullet("Vendor Scorecards", "suppliers ranked by pass rate, average risk and review volume, with their most common issue type — useful ammunition for vendor conversations.");
bullet("Supplier Portal", "external vendors get portal accounts to submit packaging and track review status. Portal users are hard-isolated: they see only their own submissions, never another vendor's data or internal operations.");
bullet("Submissions review", "vendor submissions flow into the internal queue for a specialist to review and convert into package records.");
await shot("scorecards.jpg", "Vendor Scorecards — supplier compliance performance, ranked.");

// ---------- 9. Team operations ----------
newPage();
heading("9. Team operations: assignments, workload & SLAs");
para("For leads and managers, the Operations section runs the review floor.");
bullet("Assignments & routing", "reviews route to teams automatically by product category, or can be assigned manually. Routing rules, review stages and an escalation matrix are all configurable.");
bullet("Workload & SLA dashboard", "live view of every reviewer's open load, utilization, overdue and escalated items, plus SLA compliance across the team.");
bullet("Escalation", "high-risk findings escalate through defined stages with full history; nothing silently stalls.");
bullet("Specialist Directory", "who covers which categories, their current load, and live presence.");
bullet("Presence & locking", "you can see who else is viewing a review, and soft locks warn you before two reviewers step on each other's work.");
bullet("Admin console", "user and role management, team membership, audit center, activity monitor, system health, and AI usage & cost dashboards.");
await shot("workload.jpg", "Workload & SLA — reviewer load and service-level performance at a glance.");

// ---------- 10. Reports ----------
newPage();
heading("10. Reports & analytics");
para("Everything the platform learns is exportable and chartable.");
bullet("Reports", "generated compliance documentation — including annotated proof PDFs — downloadable and shareable.");
bullet("Executive summaries", "high-level compliance posture for leadership.");
bullet("Trend analysis", "pass/fail rates, violation categories and vendor performance over time.");
bullet("AI usage & cost", "for administrators: exactly how much AI analysis is being used and what it costs.");
await shot("reports.jpg", "Reports — generated compliance documentation and exports.");

// ---------- 11. Training ----------
newPage();
heading("11. Learning the tool: Training & Help");
para("You don't need this PDF to be the last word — the platform teaches itself.");
bullet("Getting Started checklist", "a six-step onboarding path from first login to first completed review, with progress saved automatically.");
bullet("Interactive walkthroughs", "guided tours that highlight the actual buttons on screen.");
bullet("User guide, FAQ & Academy", "in-app reference articles, best practices and structured courses.");
bullet("Support", "a built-in contact form routes questions to the platform team.");
await shot("training.jpg", "Training & Help — onboarding checklist and guided tours.");

// ---------- 12. Roles ----------
newPage();
heading("12. Who sees what: roles & access");
para("Access is role-based. Your role controls which pages appear in your sidebar and which actions you can take — so the app may look slightly different from these screenshots depending on your permissions.");
bullet("Reviewers / specialists", "work the review queues, run AI analysis, annotate proofs, and record decisions.");
bullet("Managers", "everything reviewers can do, plus assignments, routing rules, SLAs, escalation and team dashboards.");
bullet("Administrators", "user/role management, policies, integrations, audit, usage and system health.");
bullet("Suppliers", "portal-only access to their own submissions.");
para("Every meaningful action — decisions, role changes, downloads, deletions — is written to an append-only audit trail.", { gap: 14 });
heading("Quick start (first day)", 14);
bullet("1.", "Sign in with your Dollar Tree account and open Training > Getting Started.");
bullet("2.", "Take the two-minute orientation tour.");
bullet("3.", "Upload a package (or use Load Demo Data) and watch the AI analysis land.");
bullet("4.", "Open the review, read the findings, and record a practice decision.");
bullet("5.", "Star your everyday tools and say hello to the AI Workspace.");
para(" ", { gap: 4 });
para("Questions while you explore? The Ask AI button in the top bar is the fastest way to find the right tool — it knows this entire platform.", { color: GRAY });

const bytes = await doc.save();
fs.writeFileSync(OUT, bytes);
console.log("Wrote", OUT, bytes.length, "bytes");
