import type {
  Regulation,
  PackageRow,
  ClaimReviewFlags,
  GlossaryEntryRow,
} from "@workspace/db";
import {
  runTiered,
  readUsage,
  WORKLOAD_LABELS,
  type AiOrchestration,
} from "./ai-orchestration";
import { cachedAiCall } from "./cache/ai-cache";

// Bump when the language-review prompt changes to invalidate cached results.
const LANGUAGE_PROMPT_VERSION = 1;

export type LanguageFinding = {
  issueType:
    | "Spelling"
    | "Grammar"
    | "Context"
    | "Regulatory"
    | "Marketing Claim"
    | "Brand Language";
  severity: "critical" | "major" | "minor" | "informational";
  originalText: string | null;
  suggestedText: string | null;
  reason: string | null;
  regulationReference: string | null;
  confidenceScore: number;
  claimRiskScore: number | null;
  reviewFlags: ClaimReviewFlags | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
};

export type LanguageReviewResult = {
  score: number;
  confidence: number;
  summary: string;
  findings: LanguageFinding[];
  orchestration?: AiOrchestration;
};

const VALID_ISSUE_TYPES = new Set([
  "Spelling",
  "Grammar",
  "Context",
  "Regulatory",
  "Marketing Claim",
  "Brand Language",
]);

const VALID_SEVERITY = new Set(["critical", "major", "minor", "informational"]);

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

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function clampUnit(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

/**
 * Run the AI Language Review Engine against a package's extracted copy.
 * This is an AI-powered packaging language reviewer — not a spell checker.
 * It evaluates spelling, grammar, contextual wording, regulatory language,
 * marketing claims, and brand language, and returns a Language Quality Score.
 */
export async function analyzeLanguage(
  pkg: PackageRow,
  regulations: Regulation[],
  approvedLanguage: GlossaryEntryRow[] = [],
): Promise<LanguageReviewResult> {
  const regContext = regulations
    .map(
      (r) =>
        `- [${r.agency} ${r.ruleCode}] ${r.title} (${r.category})${r.section ? ` §${r.section}` : ""}: ${r.summary}`,
    )
    .join("\n");

  // The organization's editable Approved Language & Glossary library. These are
  // authoritative reference entries — required statements, pre-approved claims,
  // allergen/warning phrasings, defined terms, and prohibited wording — that the
  // engine must reason against so it flags deviations from approved wording and
  // suggests the exact approved value.
  const glossaryContext = approvedLanguage
    .map(
      (g) =>
        `- [${g.category}] "${g.term}" => "${g.approvedValue}"${g.regulatoryReference ? ` (ref: ${g.regulatoryReference})` : ""}${g.notes ? ` — ${g.notes}` : ""}`,
    )
    .join("\n");

  const system = `You are an enterprise AI Language Review Engine for retail product packaging at a major US discount retailer (Dollar Tree). You review packaging copy, marketing language, and compliance language BEFORE production. You are NOT a traditional spell checker — you reason about product category, packaging purpose, marketing intent, and regulatory context. Respond ONLY with valid minified JSON. Do not use emojis.

Run ALL SIX language review layers and label each finding's "issueType" with the exact matching value:
1. "Spelling" — misspelled words, typographical errors, packaging copy errors (e.g. "Ingrediants"->"Ingredients", "Nutriton"->"Nutrition", "Refridgerate"->"Refrigerate", "Recylable"->"Recyclable").
2. "Grammar" — grammar errors, sentence-structure issues, punctuation, pluralization/agreement (e.g. "Keep product away childrens."->"Keep product away from children.").
3. "Context" — words spelled correctly but wrong for the context; reason about product category and intent (e.g. "Hair Die"->"Hair Dye" [hair color product]; "Big Summer Sail"->"Big Summer Sale" [retail promotion]; their/there/they're). ALWAYS explain the reasoning.
4. "Regulatory" — language that violates FDA/EPA/FTC/USDA/CPSC or internal SOPs: missing mandatory statements, improper warnings, missing allergen language, non-compliant text (e.g. ingredient "Contains Soy Lecithin" but no allergen declaration -> add "Contains: Soy", severity critical).
5. "Marketing Claim" — regulated claim language such as "Natural", "Organic", "Clinically Proven", "Doctor Recommended", "Safe", "Non Toxic", "Healthy", "Chemical Free", "Kills 99.9% of Germs", "Eco Friendly", "Environmentally Friendly". For each, set reviewFlags to indicate which authorities must review (fda/epa/ftc/legal) and set claimRiskScore (0-100).
6. "Brand Language" — copy that violates Dollar Tree packaging standards, internal approved terminology, or vendor requirements: unapproved copy, brand violations, wording that requires approval.

For each finding provide: issueType, severity (critical|major|minor|informational), originalText (the offending text, or null if a missing element), suggestedText (the corrected text, or null), reason (why it is wrong), regulationReference (agency + rule when applicable, else null), confidenceScore (0-1), claimRiskScore (0-100 for Marketing Claim findings else null), reviewFlags ({"fda":bool,"epa":bool,"ftc":bool,"legal":bool} for Marketing Claim findings else null), and an approximate normalized bbox {x,y,w,h} (0-1) locating the text on the artwork (top for branding/claims, middle for ingredients, bottom for net weight/manufacturer).

Then compute a Language Quality Score (0-100): 100=Excellent, 90-99=Minor Issues, 80-89=Needs Review, 70-79=Significant Issues, below 70=High Risk. Critical findings must pull the score well below 70. Provide an overall confidence (0-1) and a concise 1-2 sentence summary.`;

  const user = `Review the language of this product packaging copy.

PRODUCT METADATA:
- Name: ${pkg.name}
- Brand: ${pkg.brand}
- Vendor: ${pkg.vendor}
- SKU: ${pkg.sku}
- Declared category: ${pkg.category}
- Product type: ${pkg.productType ?? "unknown"}
- Country of sale: ${pkg.country ?? "USA"}

PACKAGING ARTWORK TEXT (extracted copy):
"""
${pkg.extractedText ?? "(no artwork text provided; infer typical requirements for this product category and flag missing mandatory language)"}
"""

APPLICABLE REGULATIONS KNOWLEDGE BASE:
${regContext || "(none provided; rely on standard US packaging regulations)"}

ORGANIZATION APPROVED LANGUAGE & GLOSSARY:
${glossaryContext || "(none provided)"}
When packaging copy conflicts with an approved value above, flag it and set suggestedText to the exact approved value. Treat "Required Statement" entries as mandatory (flag as Regulatory when missing), "Prohibited Language" as never allowed, and "Defined Term"/"Approved Claim"/"Brand Language" entries as the authoritative wording. Cite the entry's regulatory reference when present.

Respond with JSON of shape:
{"score":number,"confidence":number,"summary":string,"findings":[{"issueType":string,"severity":string,"originalText":string|null,"suggestedText":string|null,"reason":string|null,"regulationReference":string|null,"confidenceScore":number,"claimRiskScore":number|null,"reviewFlags":{"fda":boolean,"epa":boolean,"ftc":boolean,"legal":boolean}|null,"bbox":{"x":number,"y":number,"w":number,"h":number}|null}]}`;

  const compute = async (): Promise<LanguageReviewResult> => {
    const { result, orchestration } = await runTiered<LanguageReviewResult>({
    workload: "language_review",
    context: {
      organizationId: pkg.organizationId,
      reviewType: WORKLOAD_LABELS.language_review,
    },
    riskScoreOf: (r) =>
      typeof r.score === "number" ? Math.max(0, Math.min(100, 100 - r.score)) : null,
    assess: (r) => {
      const risky = r.score < 70;
      return {
        confidence: Math.round((r.confidence ?? 0.8) * 100),
        risky,
        reason: risky ? `High-risk language score (${r.score})` : undefined,
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

      const findings: LanguageFinding[] = Array.isArray(parsed.findings)
        ? parsed.findings.map((f: any): LanguageFinding => {
        const issueType = VALID_ISSUE_TYPES.has(f?.issueType)
          ? f.issueType
          : "Context";
        const severity = VALID_SEVERITY.has(f?.severity) ? f.severity : "minor";
        let bbox = null;
        if (
          f?.bbox &&
          typeof f.bbox.x === "number" &&
          typeof f.bbox.y === "number"
        ) {
          bbox = {
            x: clampUnit(f.bbox.x, 0.1),
            y: clampUnit(f.bbox.y, 0.1),
            w: Math.max(0.02, clampUnit(f.bbox.w, 0.2)),
            h: Math.max(0.02, clampUnit(f.bbox.h, 0.08)),
          };
        }
        const isClaim = issueType === "Marketing Claim";
        let reviewFlags: ClaimReviewFlags | null = null;
        if (isClaim && f?.reviewFlags && typeof f.reviewFlags === "object") {
          reviewFlags = {
            fda: Boolean(f.reviewFlags.fda),
            epa: Boolean(f.reviewFlags.epa),
            ftc: Boolean(f.reviewFlags.ftc),
            legal: Boolean(f.reviewFlags.legal),
          };
        }
        return {
          issueType,
          severity,
          originalText: f?.originalText ?? null,
          suggestedText: f?.suggestedText ?? null,
          reason: f?.reason ?? null,
          regulationReference: f?.regulationReference ?? null,
          confidenceScore: clampUnit(f?.confidenceScore, 0.75),
          claimRiskScore: isClaim ? clampInt(f?.claimRiskScore, 0, 100, 50) : null,
          reviewFlags,
          bbox,
        };
      })
    : [];

      return {
        result: {
          score: clampInt(
            parsed?.score,
            0,
            100,
            findings.length === 0 ? 100 : 80,
          ),
          confidence: clampUnit(parsed?.confidence, 0.8),
          summary: String(parsed?.summary ?? ""),
          findings,
        },
        usage: readUsage(response.usage),
      };
    },
    });

    return { ...result, orchestration };
  };

  return cachedAiCall<LanguageReviewResult>({
    orgId: pkg.organizationId,
    workload: "language_review",
    promptVersion: LANGUAGE_PROMPT_VERSION,
    keyParts: [system, user],
    compute,
  });
}
