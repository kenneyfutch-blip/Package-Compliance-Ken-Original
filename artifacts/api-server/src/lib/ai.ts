import type { OcrData, Regulation, PackageRow } from "@workspace/db";
import { resolveAiClientForTier } from "./ai-client";
import {
  runTiered,
  readUsage,
  type AiOrchestration,
} from "./ai-orchestration";

export type FindingClass = "issue" | "warning" | "passed" | "recommendation";

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
  findingClass: FindingClass;
  confidence: number | null;
  claimFlags: string[];
  page: number;
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
  orchestration?: AiOrchestration;
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

const VALID_CLASS = new Set(["issue", "warning", "passed", "recommendation"]);
const VALID_FLAGS = new Set(["EPA", "FDA", "FTC", "Legal"]);

/** Proof marker color for a finding class. */
export function findingClassColor(cls: FindingClass): string {
  switch (cls) {
    case "passed":
      return "#22c55e"; // green
    case "warning":
      return "#f59e0b"; // yellow
    case "recommendation":
      return "#8b5cf6"; // purple
    case "issue":
    default:
      return "#ef4444"; // red
  }
}

/** Map a severity to an annotation/task priority. */
export function priorityFromSeverity(severity: string): string {
  switch (severity) {
    case "critical":
      return "critical";
    case "major":
      return "high";
    case "minor":
      return "medium";
    default:
      return "low";
  }
}

export async function analyzePackaging(
  pkg: PackageRow,
  regulations: Regulation[],
  priorKnowledge?: string,
  internalStandards?: string,
  cfrRegulations?: string,
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
9. "Internal Standard" — company-specific internal policies and standards (packaging, brand, supplier, legal, artwork, marketing) that are provided in the INTERNAL COMPANY STANDARDS section below. These carry EQUAL authority to government regulations: when the packaging violates one of the provided internal policies, raise a violation labeled engine "Internal Standard". Only raise Internal Standard violations for policies explicitly provided below — never invent internal policies.

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
${
  priorKnowledge && priorKnowledge.trim()
    ? `\nINSTITUTIONAL COMPLIANCE MEMORY (how reviewers resolved similar findings on past packages — use this to stay consistent with precedent, prefer the same regulation citations and fixes when the same issue recurs, but still analyze this package on its own merits):\n${priorKnowledge}\n`
    : ""
}${
  internalStandards && internalStandards.trim()
    ? `\nINTERNAL COMPANY STANDARDS (internal Dollar Tree policies uploaded by compliance managers — these carry EQUAL authority to FDA/EPA/eCFR regulations. Evaluate the packaging against EACH policy below; when the packaging violates one, produce a finding with engine "Internal Standard", severity matching the policy, detectedText for the offending copy/element (or null if a required element is missing), regulationRef set to the policy Source, and cite the specific policy name in the description. Internal compliance can FAIL even when external regulatory compliance passes.):\n${internalStandards}\n`
    : ""
}${
  cfrRegulations && cfrRegulations.trim()
    ? `\nAPPLICABLE eCFR REGULATIONS (verbatim sections from the live Electronic Code of Federal Regulations — Title 21 FDA / Title 40 EPA — matched to this product's category. These are the ACTUAL regulatory text of the requirements. When the packaging violates or omits a requirement described in one of these sections, cite the EXACT section (e.g. "21 CFR 101.9") in regulationRef and reference it in the description. Prefer these real citations over generic ones whenever a matching section is listed below.):\n${cfrRegulations}\n`
    : ""
}
Perform:
1. OCR field extraction: pull structured fields from the artwork text.
2. Compliance engines: run ALL detection engines described above and flag missing mandatory elements (net contents, ingredients, warnings, country of origin, allergen statements, nutrition facts, hazard/precautionary statements, EPA registration where applicable).
3. Produce findings. Each finding has:
   - findingClass: one of "issue" (a real violation / red), "warning" (risky but not a hard violation / yellow), "passed" (a mandatory element that IS present and correct / green), or "recommendation" (an optional improvement / purple).
   - severity: critical|major|minor|informational (use informational for passed/recommendation).
   - engine: the detection engine name from the list above.
   - title, description.
   - detectedText (the offending or relevant copy, or null if it is a missing element).
   - suggestedText (a corrected version, or null).
   - recommendation, regulationRef (agency + rule code/section when possible).
   - confidence: integer 0-100 for how certain you are.
   - claimFlags: array; for marketing/regulatory claims list which review authorities must sign off, any of ["EPA","FDA","FTC","Legal"]; otherwise [].
   - page: 0 (single-page artwork).
4. Include at least 2 "passed" findings for mandatory elements that are correctly present, and 1-2 "recommendation" findings, in addition to the issues/warnings.
5. For each finding, provide an approximate normalized bounding box {x,y,w,h} with values 0..1 for where on the artwork it appears (top for branding/claims, middle for ingredients, bottom for net weight/manufacturer). Spread boxes out; do not overlap them all.
6. Assign an overall letter grade (A-F), a riskScore 0-100 (higher = riskier), and complianceStatus of "Passed", "Failed", or "Needs Review". Critical issues push toward Failed and high risk.
7. Detect the best-fit product category.
8. Provide 3-6 prioritized recommendations and a 1-2 sentence executive summary.

Respond with JSON of shape:
{"category":string,"grade":string,"riskScore":number,"complianceStatus":string,"summary":string,"ocr":{"productName":string|null,"ingredients":string|null,"directions":string|null,"warnings":string|null,"claims":string[],"marketingCopy":string|null,"nutritionFacts":string|null,"allergenStatements":string|null,"netWeight":string|null,"countryOfOrigin":string|null,"manufacturerInfo":string|null,"expirationDate":string|null,"epaRegistrationNumbers":string|null,"hazardStatements":string|null},"recommendations":string[],"violations":[{"severity":string,"findingClass":string,"engine":string,"title":string,"description":string,"regulationRef":string|null,"recommendation":string|null,"detectedText":string|null,"suggestedText":string|null,"confidence":number,"claimFlags":string[],"page":number,"bbox":{"x":number,"y":number,"w":number,"h":number}|null}]}`;

  const { result, orchestration } = await runTiered<AnalysisResult>({
    workload: "packaging_analysis",
    assess: (r) => {
      const confs = r.violations
        .map((v) => v.confidence)
        .filter((c): c is number => c != null);
      const confidence = confs.length
        ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length)
        : null;
      const risky = r.riskScore >= 70 || r.complianceStatus === "Failed";
      return {
        confidence,
        risky,
        reason: risky
          ? `High-risk result (risk score ${r.riskScore})`
          : undefined,
      };
    },
    run: async ({ client, model, tier }) => {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: tier === "reasoning" ? 16384 : 8192,
      });

      const parsed = safeParse(response.choices[0]?.message?.content ?? "{}");

      const violations: AnalyzedViolation[] = Array.isArray(parsed.violations)
        ? parsed.violations.map((v: any) => {
        const findingClass: FindingClass = VALID_CLASS.has(v?.findingClass)
          ? v.findingClass
          : "issue";
        const severity = VALID_SEVERITY.has(v?.severity)
          ? v.severity
          : findingClass === "passed" || findingClass === "recommendation"
            ? "informational"
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
        const claimFlags: string[] = Array.isArray(v?.claimFlags)
          ? v.claimFlags
              .map((f: any) => String(f))
              .filter((f: string) => VALID_FLAGS.has(f))
          : [];
        const confidence =
          typeof v?.confidence === "number"
            ? Math.max(0, Math.min(100, Math.round(v.confidence)))
            : null;
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
          findingClass,
          confidence,
          claimFlags,
          page: Number.isInteger(v?.page) ? v.page : 0,
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
        result: {
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
        },
        usage: readUsage(response.usage),
      };
    },
  });

  return { ...result, orchestration };
}

/**
 * OCR: transcribe all visible text from a packaging artwork image using the
 * active multimodal AI engine. Accepts a base64 data URL.
 */
export async function extractTextFromImage(
  imageDataUrl: string,
): Promise<string> {
  const { client, model } = await resolveAiClientForTier("fast");

  const system = `You are a precise OCR engine for retail product packaging artwork. Transcribe ALL text visible in the image verbatim — brand names, product names, ingredient lists, warnings, directions, nutrition facts, net weight, marketing claims, country of origin, manufacturer info, barcodes labels, and any fine print. Preserve the reading order roughly top-to-bottom, left-to-right. Keep original spelling exactly as printed, including any misspellings (do NOT correct them). Do not add commentary, headings, or explanations. If no text is legible, respond with an empty string. Do not use emojis.`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Transcribe every piece of text on this packaging artwork, verbatim.",
          },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    max_completion_tokens: 4096,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

export type ExtractedPackageFields = {
  productName: string;
  brand: string;
  upc: string;
  netWeight: string;
  country: string;
};

/**
 * Best-effort structured field extraction from a packaging artwork image, used
 * to pre-fill the upload form. Returns empty strings for any field that cannot
 * be confidently read (never throws for a missing field). UPC and brand are the
 * least reliable to read, so they are only filled when clearly printed.
 * Accepts a base64 data URL.
 */
export async function extractPackageFieldsFromImage(
  imageDataUrl: string,
): Promise<ExtractedPackageFields> {
  const { client, model } = await resolveAiClientForTier("fast");

  const system = `You extract structured metadata fields from a single retail product packaging artwork image, to pre-fill a data-entry form. Respond ONLY with valid minified JSON. Do not use emojis.

Extract these fields, reading ONLY what is actually printed on the artwork (do not guess or invent values):
- "productName": the product's name/title as shown on the principal display panel.
- "brand": the brand or manufacturer brand name. This is often a logo and can be hard to read — only fill it when you are confident.
- "upc": the 12-digit UPC number printed as digits beneath or beside the barcode. Only include the digits (no spaces). Barcodes are hard to read — only fill this when the printed digits are clearly legible; otherwise leave it empty.
- "netWeight": the net quantity / net weight statement exactly as printed (e.g. "16 oz (454g)", "500 mL").
- "country": the country of origin / country statement if printed (e.g. "USA", "Made in China").

Rules:
- For any field you cannot confidently read, return an empty string "".
- Preserve the printed spelling and casing.
- Respond with JSON of shape: {"productName":string,"brand":string,"upc":string,"netWeight":string,"country":string}`;

  let parsed: any = {};
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the structured package metadata fields from this packaging artwork. Leave any field you cannot confidently read as an empty string.",
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
    });
    parsed = safeParse(response.choices[0]?.message?.content ?? "{}");
  } catch {
    parsed = {};
  }

  const clean = (v: unknown): string =>
    typeof v === "string" ? v.trim() : "";
  const upc = clean(parsed?.upc).replace(/[^0-9]/g, "");

  return {
    productName: clean(parsed?.productName),
    brand: clean(parsed?.brand),
    upc,
    netWeight: clean(parsed?.netWeight),
    country: clean(parsed?.country),
  };
}

export type CopilotCitation = {
  source: string;
  section: string | null;
  text: string | null;
};

export async function askCompliancePilot(
  pkg: PackageRow,
  violations: {
    severity: string;
    engine: string;
    title: string;
    description: string;
    regulationRef: string | null;
  }[],
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

  const { client, model } = await resolveAiClientForTier("standard");
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

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

export type ComparedChange = {
  changeType: "added" | "removed" | "changed" | "unchanged";
  category: "claim" | "warning" | "ingredient" | "regulatory" | "copy" | "other";
  field: string | null;
  before: string | null;
  after: string | null;
  note: string | null;
};

const VALID_CHANGE_TYPE = new Set(["added", "removed", "changed", "unchanged"]);
const VALID_CATEGORY = new Set([
  "claim",
  "warning",
  "ingredient",
  "regulatory",
  "copy",
  "other",
]);

export async function compareVersions(
  packageName: string,
  labelA: string,
  textA: string,
  labelB: string,
  textB: string,
): Promise<{ summary: string; changes: ComparedChange[] }> {
  const system = `You are a packaging copy diff analyst. You compare two revisions of packaging artwork copy and produce a precise, structured change list a compliance reviewer can act on. Respond ONLY with valid minified JSON. Do not use emojis.`;

  const user = `Compare two versions of the packaging copy for "${packageName}".

VERSION A (${labelA}):
"""
${textA || "(empty)"}
"""

VERSION B (${labelB}):
"""
${textB || "(empty)"}
"""

Identify what changed from A to B. For each meaningful item output:
- changeType: added|removed|changed|unchanged
- category: claim|warning|ingredient|regulatory|copy|other
- field: a short label for the element (e.g. "Net weight", "Marketing claim", "Allergen statement") or null
- before: the A text (or null)
- after: the B text (or null)
- note: a one-line compliance-relevant note about the change (or null)

Focus on compliance-significant changes (claims, warnings, ingredients, regulatory elements). Include a few "unchanged" key elements for context. Also give a 1-2 sentence summary.

Respond with JSON: {"summary":string,"changes":[{"changeType":string,"category":string,"field":string|null,"before":string|null,"after":string|null,"note":string|null}]}`;

  const { client, model } = await resolveAiClientForTier("fast");
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 3072,
  });

  const parsed = safeParse(response.choices[0]?.message?.content ?? "{}");
  const changes: ComparedChange[] = Array.isArray(parsed?.changes)
    ? parsed.changes.map((c: any) => ({
        changeType: VALID_CHANGE_TYPE.has(c?.changeType)
          ? c.changeType
          : "changed",
        category: VALID_CATEGORY.has(c?.category) ? c.category : "other",
        field: c?.field ?? null,
        before: c?.before ?? null,
        after: c?.after ?? null,
        note: c?.note ?? null,
      }))
    : [];

  return {
    summary: String(parsed?.summary ?? "No summary available."),
    changes,
  };
}
