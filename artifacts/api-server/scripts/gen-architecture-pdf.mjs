// Generates a one-page landscape architecture / wiring diagram PDF for the
// Packaging Compliance AI platform. Standalone: run with `node` from anywhere
// (pdf-lib resolves from artifacts/api-server).
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---- palette -------------------------------------------------------------
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0, 0.478, 0.2); // Dollar Tree green
const GREEN_LIGHT = rgb(0.55, 0.8, 0.62);
const INK = rgb(0.13, 0.15, 0.18);
const MUTED = rgb(0.42, 0.46, 0.5);
const CARD = rgb(0.97, 0.98, 0.97);
const CARD_BORDER = rgb(0.82, 0.86, 0.83);
const TIER = rgb(0.94, 0.965, 0.95);
const TIER_BORDER = rgb(0.72, 0.82, 0.75);

const PAGE_W = 792; // US Letter landscape
const PAGE_H = 612;
const MARGIN = 40;

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const page = doc.addPage([PAGE_W, PAGE_H]);

// ---- helpers -------------------------------------------------------------
function text(s, x, y, size, f = font, color = INK) {
  page.drawText(s, { x, y, size, font: f, color });
}
function centerText(s, cx, y, size, f = font, color = INK) {
  const w = f.widthOfTextAtSize(s, size);
  page.drawText(s, { x: cx - w / 2, y, size, font: f, color });
}
function box(x, y, w, h, { fill = CARD, border = CARD_BORDER, bw = 1, r = 6 } = {}) {
  page.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: border, borderWidth: bw, ...(r ? { } : {}) });
}
// vertical connector with arrowhead pointing down
function arrowDown(x, yTop, yBot, color = GREEN, label) {
  page.drawLine({ start: { x, y: yTop }, end: { x, y: yBot }, thickness: 1.4, color });
  page.drawLine({ start: { x, y: yBot }, end: { x: x - 4, y: yBot + 6 }, thickness: 1.4, color });
  page.drawLine({ start: { x, y: yBot }, end: { x: x + 4, y: yBot + 6 }, thickness: 1.4, color });
  if (label) {
    const w = font.widthOfTextAtSize(label, 7);
    page.drawRectangle({ x: x + 6, y: (yTop + yBot) / 2 - 4, width: w + 6, height: 12, color: WHITE });
    text(label, x + 9, (yTop + yBot) / 2 - 1, 7, font, MUTED);
  }
}
// horizontal double-headed connector
function arrowH(xL, xR, y, color = GREEN, label) {
  page.drawLine({ start: { x: xL, y }, end: { x: xR, y }, thickness: 1.4, color });
  page.drawLine({ start: { x: xR, y }, end: { x: xR - 6, y: y + 4 }, thickness: 1.4, color });
  page.drawLine({ start: { x: xR, y }, end: { x: xR - 6, y: y - 4 }, thickness: 1.4, color });
  page.drawLine({ start: { x: xL, y }, end: { x: xL + 6, y: y + 4 }, thickness: 1.4, color });
  page.drawLine({ start: { x: xL, y }, end: { x: xL + 6, y: y - 4 }, thickness: 1.4, color });
  if (label) {
    const w = font.widthOfTextAtSize(label, 7);
    page.drawRectangle({ x: (xL + xR) / 2 - w / 2 - 3, y: y + 4, width: w + 6, height: 11, color: WHITE });
    centerText(label, (xL + xR) / 2, y + 6, 7, font, MUTED);
  }
}
// wraps a list of chip labels inside a tier box
function chips(items, x, y, maxW, size = 8.5) {
  let cx = x, cy = y;
  const padX = 7, gap = 6, h = 15;
  for (const it of items) {
    const w = font.widthOfTextAtSize(it, size) + padX * 2;
    if (cx + w > x + maxW) { cx = x; cy -= h + 6; }
    page.drawRectangle({ x: cx, y: cy - h + 4, width: w, height: h, color: WHITE, borderColor: GREEN_LIGHT, borderWidth: 0.8 });
    text(it, cx + padX, cy - h + 8, size, font, INK);
    cx += w + gap;
  }
  return cy; // lowest y used
}

// ---- header --------------------------------------------------------------
const HEAD_H = 66;
page.drawRectangle({ x: 0, y: PAGE_H - HEAD_H, width: PAGE_W, height: HEAD_H, color: BLACK });
page.drawRectangle({ x: 0, y: PAGE_H - HEAD_H - 3, width: PAGE_W, height: 3, color: GREEN });
text("Packaging Compliance AI", MARGIN, PAGE_H - 30, 18, bold, WHITE);
text("Technical Architecture & Wiring Diagram", MARGIN, PAGE_H - 48, 10.5, font, GREEN_LIGHT);

// logo, right-aligned (its black bg blends with the header)
try {
  const logo = await doc.embedPng(readFileSync("attached_assets/dt-logo-2.png"));
  const lh = 40, lw = (logo.width / logo.height) * lh;
  page.drawImage(logo, { x: PAGE_W - MARGIN - lw, y: PAGE_H - HEAD_H / 2 - lh / 2, width: lw, height: lh });
} catch { /* logo optional */ }

// ---- layout regions ------------------------------------------------------
const leftX = MARGIN;             // 40
const leftW = 552;                // tiers region width
const clerkX = leftX + leftW + 16; // right column
const clerkW = PAGE_W - MARGIN - clerkX;

// Client tier
const clientY = 458, clientH = 74;
box(leftX, clientY, leftW, clientH, { fill: TIER, border: TIER_BORDER, bw: 1.2 });
text("CLIENT  \u2014  Web Browser (SPA)", leftX + 12, clientY + clientH - 18, 11, bold, GREEN);
text("React 19 + Vite  \u00b7  wouter routing  \u00b7  Tailwind v4 + shadcn/Radix UI", leftX + 12, clientY + clientH - 33, 8.5, font, MUTED);
chips(["TanStack Query", "Clerk React", "Uppy uploads", "Recharts", "pdf.js", "driver.js tours", "Framer Motion"], leftX + 12, clientY + 26, leftW - 24, 8);

// API tier
const apiY = 330, apiH = 86;
box(leftX, apiY, leftW, apiH, { fill: TIER, border: TIER_BORDER, bw: 1.2 });
text("APPLICATION SERVER", leftX + 12, apiY + apiH - 18, 11, bold, GREEN);
text("Express 5 (Node) \u00b7 bundled with esbuild \u00bb dist/index.mjs \u00b7 pino logging", leftX + 12, apiY + apiH - 33, 8.5, font, MUTED);
chips(["Clerk auth middleware", "RBAC + multi-tenant scoping", "helmet", "rate-limit", "CORS", "40+ route modules", "durable job queue"], leftX + 12, apiY + 30, leftW - 24, 8);

// Clerk (cross-cutting auth) column on the right
box(clerkX, apiY, clerkW, clientY + clientH - apiY, { fill: CARD, border: GREEN_LIGHT, bw: 1.2 });
centerText("Clerk", clerkX + clerkW / 2, clientY + clientH - 22, 12, bold, GREEN);
centerText("Managed", clerkX + clerkW / 2, clientY + clientH - 38, 8.5, font, MUTED);
centerText("Auth Tenant", clerkX + clerkW / 2, clientY + clientH - 50, 8.5, font, MUTED);
centerText("OIDC + PKCE", clerkX + clerkW / 2, apiY + 46, 8, font, INK);
centerText("sessions \u00b7 orgs", clerkX + clerkW / 2, apiY + 32, 8, font, INK);
centerText("role provisioning", clerkX + clerkW / 2, apiY + 18, 8, font, INK);

// ---- service row (backends) ---------------------------------------------
const svcY = 150, svcH = 132;
const svcN = 4, svcGap = 14;
const svcW = (leftW - (svcN - 1) * svcGap) / svcN;
const services = [
  {
    t: "PostgreSQL 17",
    s: "+ pgvector",
    lines: ["Drizzle ORM", "typed schema + push", "audit / job queue", "semantic embeddings"],
  },
  {
    t: "Object Storage",
    s: "App Storage (GCS)",
    lines: ["presigned uploads", "artwork + SOP files", "owner-scoped ACL", "IDOR-guarded serve"],
  },
  {
    t: "AI Integrations",
    s: "OpenAI proxy",
    lines: ["compliance engine", "Document AI / OCR", "language + claims", "tiered orchestration"],
  },
  {
    t: "External APIs",
    s: "regulatory data",
    lines: ["openFDA (server key)", "eCFR weekly sync", "curated CFR parts", "fail-safe recall"],
  },
];
services.forEach((sv, i) => {
  const x = leftX + i * (svcW + svcGap);
  box(x, svcY, svcW, svcH, { fill: CARD, border: CARD_BORDER, bw: 1 });
  page.drawRectangle({ x, y: svcY + svcH - 5, width: svcW, height: 5, color: GREEN });
  centerText(sv.t, x + svcW / 2, svcY + svcH - 24, 10.5, bold, INK);
  centerText(sv.s, x + svcW / 2, svcY + svcH - 38, 8.5, font, GREEN);
  let ly = svcY + svcH - 58;
  for (const ln of sv.lines) {
    text("\u2022", x + 12, ly, 8.5, font, GREEN);
    text(ln, x + 22, ly, 8.5, font, INK);
    ly -= 15;
  }
});

// ---- connectors ----------------------------------------------------------
const midX = leftX + leftW / 2;
arrowDown(midX, clientY, apiY + apiH, GREEN, "HTTPS / JSON  \u00b7  orval typed client");
// client & api both wire to Clerk
arrowH(leftX + leftW, clerkX, clientY + clientH / 2, GREEN, "auth");
arrowH(leftX + leftW, clerkX, apiY + 24, GREEN);
// api to each service
services.forEach((_, i) => {
  const x = leftX + i * (svcW + svcGap) + svcW / 2;
  arrowDown(x, apiY, svcY + svcH, GREEN);
});

// ---- build / codegen footnote -------------------------------------------
const fnY = 108;
text("BUILD & TOOLING", leftX, fnY, 8.5, bold, GREEN);
text("pnpm monorepo (workspaces + catalog) \u00b7 esbuild server bundle \u00b7 orval: OpenAPI \u00bb typed React client + zod \u00b7 TypeScript project references \u00b7 Vite HMR",
  leftX, fnY - 13, 8, font, MUTED);
text("SHARED LIBS", leftX, fnY - 32, 8.5, bold, GREEN);
text("@workspace/db (Drizzle schema) \u00b7 @workspace/api-zod (contract) \u00b7 @workspace/api-client-react \u00b7 @workspace/object-storage-web \u00b7 @workspace/integrations-openai",
  leftX, fnY - 45, 8, font, MUTED);

// footer
page.drawLine({ start: { x: MARGIN, y: 40 }, end: { x: PAGE_W - MARGIN, y: 40 }, thickness: 0.7, color: CARD_BORDER });
text("Packaging Compliance AI \u2014 platform architecture", MARGIN, 28, 8, font, MUTED);
const rf = "Generated for portfolio reference";
text(rf, PAGE_W - MARGIN - font.widthOfTextAtSize(rf, 8), 28, 8, font, MUTED);

// ---- write ---------------------------------------------------------------
const bytes = await doc.save();
mkdirSync("attached_assets", { recursive: true });
const OUT = "attached_assets/Packaging-Compliance-AI-Architecture.pdf";
writeFileSync(OUT, bytes);
console.log(`WROTE ${OUT} ${bytes.length} bytes`);
