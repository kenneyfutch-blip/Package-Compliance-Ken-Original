import type { OcrData, Regulation, PackageRow } from "@workspace/db";
import { resolveAiClient } from "./ai-client";

export type AnalyzedViolation = {
  severity: "critical" | "major" | "minor" | "informational";
  engine: string;
  title: string;
  description: string;
  regulationRef: string | null;
  recommendation: string | null;
  detectedText: string | null;
  suggestedText: string | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
};

export type AnalysisResult = {
  category: string;
  grade: string;
  riskScore: number;
  complianceStatus: string;
  summary: string;
  ocr: OcrData;
  recommendations: string[];
  violations: AnalyzedViolation[];
};

function safeParse(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return {};
      }
    }
    return {};
  }
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (Number.isNaN(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

const VALID_SEVERITY = new Set([
  "critical",
  "major",
  "minor",
  "informational",
]);

export async function analyzePackaging(
  pkg: PackageRow,
  regulations: Regulation[],
): Promise<AnalysisResult> {
  const regContext = regulations
    .map(
      (r) =>
        `- [${r.agency} ${r.ruleCode}] ${r.title} (${r.category})${r.section ? ` §${r.section}` : ""}: ${r.summary}`,
    )
    .join("\n");

  const system = `You are an expert retail packaging compliance analyst for a major US discount retailer (Dollar Tree). You review product packaging artwork copy BEFORE production. You are precise, conservative, and cite specific regulations. Respond ONLY with valid minified JSON. Do not use emojis.

You must run ALL of these detection engines and label each violation's "engine" with the matching category:
1. "Spelling & Grammar" — misspellings, grammar, subject-verb agreement, punctuation, typography (e.g. "Ingrediants"->"Ingredients", "Nutriton"->"Nutrition", "Refridgerate"->"Refrigerate").
2. "Contextual Language" — words that are spelled correctly but wrong for the context, using reasoning about the product category (e.g. "Hair Die"->"Hair Dye", "Big Summer Sail"->"Big Summer Sale", their/there/they're). Always explain the reasoning in the description.
3. "FDA" — FDA food/cosmetic/drug labeling requirements (Nutrition Facts, ingredient lists, allergen declarations, net contents, Drug Facts, cosmetic warnings).
4. "EPA" — EPA/FIFRA requirements for pesticides, disinfectants, and antimicrobials (EPA registration number, signal words, precautionary statements, directions for use).
5. "Missing Disclosures & Warnings" — required warnings/disclosures that are absent (choking hazard, prop 65, flammability, keep out of reach of children, allergen "Contains" statements, country of origin).
6. "Packaging Formatting" — formatting/layout compliance: required type sizes, principal display panel placement, contrast/legibility, required panels present, net quantity placement.
7. "Dollar Tree Standards" — internal Dollar Tree packaging standards: consistent brand presentation, required $1.25/price legends where applicable, barcode/UPC presence and placement, supplier and item number, no unapproved third-party trademarks, approved claim language.
8. "Category Regulation" — product-category-specific regulatory violations based on the declared category and product type (e.g. CPSC toy safety age grading, USDA labeling, textile fiber content/care labels, children's product tracking labels).

Marketing CLAIM detection: whenever you detect a marketing claim (e.g. "Kills 99.9% of Germs", "Organic", "Natural", "Safe", "Chemical Free", "Eco Friendly", "Clinically Proven", "Doctor Recommended"), create a violation and, in the description, state which authority should review it (Potential EPA Review / Potential FDA Review / Potential FTC Review / Potential Legal Review).`;

  const user = `Analyze this product packaging for compliance issues.

PRODUCT METADATA:
- Name: ${pkg.name}
- Brand: ${pkg.brand}
- Vendor: ${pkg.vendor}
- SKU: ${pkg.sku}
- Declared category: ${pkg.category}
- Product type: ${pkg.productType ?? "unknown"}
- Package type: ${pkg.packageType ?? "unknown"}
- Country of sale: ${pkg.country ?? "USA"}
- Manufacturing region: ${pkg.manufacturingRegion ?? "unknown"}
- Net weight: ${pkg.netWeight ?? "unknown"}

PACKAGING ARTWORK TEXT (extracted copy):
"""
${pkg.extractedText ?? "(no artwork text provided; infer typical requirements for this product category and flag missing mandatory elements)"}
"""

APPLICABLE REGULATIONS KNOWLEDGE BASE:
${regContext || "(none provided; rely on standard US packaging regulations)"}

Perform:
1. OCR field extraction: pull structured fields from the artwork text.
2. Compliance engines: FDA/EPA/CPSC/FTC/USDA regulatory checks, spelling, grammar, contextual language, and marketing claims substantiation. Flag missing mandatory elements (net contents, ingredients, warnings, country of origin, allergen statements, nutrition facts, hazard/precautionary statements, EPA registration where applicable).
3. For each issue produce a violation with severity (critical|major|minor|informational), the engine name, a concise title, a description, the offending detectedText (or null if it is a missing element), a suggestedText fix (or null), a recommendation, and a regulationRef citing the agency + rule code/section when possible.
4. For each violation, provide an approximate normalized bounding box {x,y,w,h} with values between 0 and 1 indicating where on the artwork the issue likely appears (top area for branding/claims, middle for ingredients, bottom for net weight/manufacturer). Spread boxes out; do not overlap them all.
5. Assign an overall letter grade (A-F), a riskScore 0-100 (higher = riskier), and a complianceStatus of "Passed", "Failed", or "Needs Review". Critical violations must push toward Failed and high risk.
6. Detect the best-fit product category.
7. Provide 3-6 prioritized recommendations and a 1-2 sentence executive summary.

Respond with JSON of shape:
{"category":string,"grade":string,"riskScore":number,"complianceStatus":string,"summary":string,"ocr":{"productName":string|null,"ingredients":string|null,"directions":string|null,"warnings":string|null,"claims":string[],"marketingCopy":string|null,"nutritionFacts":string|null,"allergenStatements":string|null,"netWeight":string|null,"countryOfOrigin":string|null,"manufacturerInfo":string|null,"expirationDate":string|null,"epaRegistrationNumbers":string|null,"hazardStatements":string|null},"recommendations":string[],"violations":[{"severity":string,"engine":string,"title":string,"description":string,"regulationRef":string|null,"recommendation":string|null,"detectedText":string|null,"suggestedText":string|null,"bbox":{"x":number,"y":number,"w":number,"h":number}|null}]}`;

  const { client, model } = await resolveAiClient();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  });

  const parsed = safeParse(response.choices[0]?.message?.content ?? "{}");

  const violations: AnalyzedViolation[] = Array.isArray(parsed.violations)
    ? parsed.violations.map((v: any) => {
        const severity = VALID_SEVERITY.has(v?.severity)
          ? v.severity
          : "minor";
        let bbox = null;
        if (
          v?.bbox &&
          typeof v.bbox.x === "number" &&
          typeof v.bbox.y === "number"
        ) {
          bbox = {
            x: Math.max(0, Math.min(1, v.bbox.x)),
            y: Math.max(0, Math.min(1, v.bbox.y)),
            w: Math.max(0.02, Math.min(1, v.bbox.w ?? 0.2)),
            h: Math.max(0.02, Math.min(1, v.bbox.h ?? 0.1)),
          };
        }
        return {
          severity,
          engine: String(v?.engine ?? "Internal"),
          title: String(v?.title ?? "Compliance issue"),
          description: String(v?.description ?? ""),
          regulationRef: v?.regulationRef ?? null,
          recommendation: v?.recommendation ?? null,
          detectedText: v?.detectedText ?? null,
          suggestedText: v?.suggestedText ?? null,
          bbox,
        };
      })
    : [];

  const ocr: OcrData = {
    productName: parsed?.ocr?.productName ?? null,
    ingredients: parsed?.ocr?.ingredients ?? null,
    directions: parsed?.ocr?.directions ?? null,
    warnings: parsed?.ocr?.warnings ?? null,
    claims: Array.isArray(parsed?.ocr?.claims) ? parsed.ocr.claims : [],
    marketingCopy: parsed?.ocr?.marketingCopy ?? null,
    nutritionFacts: parsed?.ocr?.nutritionFacts ?? null,
    allergenStatements: parsed?.ocr?.allergenStatements ?? null,
    netWeight: parsed?.ocr?.netWeight ?? null,
    countryOfOrigin: parsed?.ocr?.countryOfOrigin ?? null,
    manufacturerInfo: parsed?.ocr?.manufacturerInfo ?? null,
    expirationDate: parsed?.ocr?.expirationDate ?? null,
    epaRegistrationNumbers: parsed?.ocr?.epaRegistrationNumbers ?? null,
    hazardStatements: parsed?.ocr?.hazardStatements ?? null,
  };

  return {
    category: String(parsed?.category ?? pkg.category ?? "Uncategorized"),
    grade: String(parsed?.grade ?? "C"),
    riskScore: clampScore(parsed?.riskScore),
    complianceStatus: ["Passed", "Failed", "Needs Review"].includes(
      parsed?.complianceStatus,
    )
      ? parsed.complianceStatus
      : "Needs Review",
    summary: String(parsed?.summary ?? ""),
    ocr,
    recommendations: Array.isArray(parsed?.recommendations)
      ? parsed.recommendations.map((r: any) => String(r))
      : [],
    violations,
  };
}

export type CopilotCitation = {
  source: string;
  section: string | null;
  text: string | null;
};

export async function askCompliancePilot(
  pkg: PackageRow,
  violations: { severity: string; engine: string; title: string; description: string; regulationRef: string | null }[],
  regulations: Regulation[],
  question: string,
): Promise<{ answer: string; citations: CopilotCitation[] }> {
  const violationContext = violations
    .map(
      (v) =>
        `- [${v.severity.toUpperCase()} / ${v.engine}] ${v.title}: ${v.description}${v.regulationRef ? ` (Ref: ${v.regulationRef})` : ""}`,
    )
    .join("\n");

  const regContext = regulations
    .map(
      (r) =>
        `- [${r.agency} ${r.ruleCode}]${r.section ? ` §${r.section}` : ""} ${r.title}: ${r.summary}`,
    )
    .join("\n");

  const system = `You are an AI Compliance Copilot embedded in a packaging compliance review tool. You help reviewers understand why packaging failed, how to fix it, and which regulations apply. Be specific, actionable, and cite regulations. Keep answers concise (under 200 words). Respond ONLY with valid minified JSON: {"answer":string,"citations":[{"source":string,"section":string|null,"text":string|null}]}. Do not use emojis.`;

  const user = `PACKAGE: ${pkg.name} (${pkg.brand}), category ${pkg.category}, grade ${pkg.grade ?? "N/A"}, risk ${pkg.riskScore ?? "N/A"}.
Executive summary: ${pkg.summary ?? "N/A"}

DETECTED VIOLATIONS:
${violationContext || "(none)"}

APPLICABLE REGULATIONS:
${regContext || "(none)"}

REVIEWER QUESTION: ${question}

Answer the question using the context above. Cite the specific regulations you rely on in the citations array.`;

  const { client, model } = await resolveAiClient();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2048,
  });

  const parsed = safeParse(response.choices[0]?.message?.content ?? "{}");
  return {
    answer: String(parsed?.answer ?? "I could not generate an answer."),
    citations: Array.isArray(parsed?.citations)
      ? parsed.citations.map((c: any) => ({
          source: String(c?.source ?? "Regulation"),
          section: c?.section ?? null,
          text: c?.text ?? null,
        }))
      : [],
  };
}
