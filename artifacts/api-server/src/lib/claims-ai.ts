import type { Regulation, PackageRow } from "@workspace/db";
import { TRACKED_CLAIM_TYPES, CLAIM_RISK_LEVELS } from "@workspace/db";
import {
  runTiered,
  readUsage,
  WORKLOAD_LABELS,
  type AiOrchestration,
} from "./ai-orchestration";
import { cachedAiCall } from "./cache/ai-cache";
import { UNTRUSTED_DATA_DIRECTIVE, wrapUntrusted } from "./prompt-safety";

// Bump when the claims prompt changes to invalidate cached results.
const CLAIMS_PROMPT_VERSION = 1;

export type ClaimRiskLevel = (typeof CLAIM_RISK_LEVELS)[number];

export type ClaimFinding = {
  claimType: string;
  claimText: string | null;
  jurisdiction: string | null;
  riskLevel: ClaimRiskLevel;
  regulationReference: string | null;
  remediation: string | null;
  confidence: number; // 0-100
};

export type ClaimsAnalysisResult = {
  summary: string;
  confidence: number; // 0-1
  findings: ClaimFinding[];
  orchestration?: AiOrchestration;
};

const VALID_RISK = new Set<string>(CLAIM_RISK_LEVELS);

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

// Numeric ordering so the aggregate can compute the highest risk band present
// and the orchestrator can decide whether High/Critical escalation must fire.
export const RISK_RANK: Record<ClaimRiskLevel, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

/**
 * Run the Claims Compliance Engine against a package's extracted copy.
 *
 * It detects marketing/label claims (Organic, Natural, Clean, Healthy,
 * Sustainable, Eco-Friendly, Recyclable, Biodegradable, Compostable, Non-GMO,
 * Gluten Free, Sugar Free, and any other regulated claim it observes) and, for
 * each, determines the governing jurisdiction, the compliance risk band, the
 * applicable regulation, and a recommended remediation, plus a confidence
 * score.
 *
 * High and Critical claims escalate the run to the reasoning tier (Sol) via the
 * orchestrator for a deeper second pass.
 */
export async function analyzeClaims(
  pkg: PackageRow,
  regulations: Regulation[] = [],
): Promise<ClaimsAnalysisResult> {
  const regContext = regulations
    .map(
      (r) =>
        `- [${r.agency} ${r.ruleCode}] ${r.title} (${r.category})${r.section ? ` §${r.section}` : ""}: ${r.summary}`,
    )
    .join("\n");

  const system = `You are an enterprise AI Claims Compliance Engine for retail product packaging at a major US discount retailer (Dollar Tree). You audit every marketing and label CLAIM that appears on packaging artwork and determine whether it is substantiated and compliant BEFORE production. Respond ONLY with valid minified JSON. Do not use emojis.

${UNTRUSTED_DATA_DIRECTIVE}

Detect and evaluate product claims. Always look explicitly for these tracked claim types (use the exact label in "claimType" when one matches):
${TRACKED_CLAIM_TYPES.map((c) => `- ${c}`).join("\n")}
Also surface any OTHER regulated claim you observe (e.g. "Clinically Proven", "Chemical Free", "Doctor Recommended", "All Natural", "Made with Real X", "FDA Approved", "Kills 99.9% of Germs"), using a concise claimType label.

Only report claims that actually appear in the artwork text. Do NOT invent claims that are not present. If no claims are present, return an empty findings array.

For EACH claim you find, produce:
1. claimText — the exact wording from the artwork that constitutes the claim.
2. jurisdiction — the regulating authority or authorities that govern this claim. Reason carefully: "Organic" -> USDA (National Organic Program); "Natural"/"Clean"/"Healthy"/"Sugar Free"/"Gluten Free" on food -> FDA; environmental claims ("Eco-Friendly","Sustainable","Recyclable","Biodegradable","Compostable","Non-Toxic") -> FTC Green Guides (and EPA where relevant); comparative/advertising or unsubstantiated benefit claims -> FTC. Use "FDA / FTC" style when more than one applies.
3. riskLevel — one of exactly: Low, Medium, High, Critical.
   - Low: claim is generally permitted / well substantiated with typical qualifiers.
   - Medium: claim is regulated and needs a qualifier, disclosure, or substantiation on file.
   - High: claim is likely non-compliant or misleading without specific substantiation/certification (e.g. "Organic" without USDA certification, unqualified "Biodegradable"/"Compostable", "Healthy" not meeting FDA nutrient criteria).
   - Critical: claim is prohibited, deceptive, or exposes the retailer to enforcement/recall/litigation (e.g. unsubstantiated health/disease claims, "FDA Approved" when false, "Non-Toxic" on a hazardous product).
4. regulationReference — the specific rule/citation that governs the claim (e.g. "USDA 7 CFR Part 205", "FTC Green Guides 16 CFR 260", "FDA 21 CFR 101.65"). Use the regulations knowledge base below when it applies; otherwise cite the standard governing rule.
5. remediation — the concrete action to make the claim compliant (add a qualifier, obtain certification, remove the claim, add substantiation, etc.).
6. confidence — 0-100 integer: your confidence in this assessment.

Then provide an overall "confidence" (0-1) and a concise 1-2 sentence "summary" of the claims risk on this package.`;

  const user = `Audit the product claims on this packaging.

PRODUCT METADATA:
- Name: ${pkg.name}
- Brand: ${pkg.brand}
- Vendor: ${pkg.vendor}
- SKU: ${pkg.sku}
- Declared category: ${pkg.category}
- Product type: ${pkg.productType ?? "unknown"}
- Country of sale: ${pkg.country ?? "USA"}

PACKAGING ARTWORK TEXT (extracted copy):
${pkg.extractedText ? wrapUntrusted("packaging-artwork-text", pkg.extractedText) : '"""(no artwork text provided; if no claims can be identified, return an empty findings array)"""'}

APPLICABLE REGULATIONS KNOWLEDGE BASE:
${regContext || "(none provided; rely on standard US claim-substantiation rules: USDA NOP, FTC Green Guides, FDA labeling)"}

Respond with JSON of shape:
{"summary":string,"confidence":number,"findings":[{"claimType":string,"claimText":string|null,"jurisdiction":string|null,"riskLevel":"Low"|"Medium"|"High"|"Critical","regulationReference":string|null,"remediation":string|null,"confidence":number}]}`;

  const compute = async (): Promise<ClaimsAnalysisResult> => {
    const { result, orchestration } = await runTiered<ClaimsAnalysisResult>({
      workload: "claims_review",
      context: {
        organizationId: pkg.organizationId,
        reviewType: WORKLOAD_LABELS.claims_review,
      },
      // Map the run's worst claim to a 0-100 compliance risk score for telemetry.
      riskScoreOf: (r) => {
        if (r.findings.length === 0) return 0;
        const worst = Math.max(...r.findings.map((f) => RISK_RANK[f.riskLevel]));
        return { 1: 25, 2: 55, 3: 80, 4: 100 }[worst] ?? null;
      },
      // Escalate to the reasoning tier (Sol) when any claim is High or Critical,
      // or when overall confidence is low.
      assess: (r) => {
        const worst = r.findings.reduce(
          (m, f) => Math.max(m, RISK_RANK[f.riskLevel]),
          0,
        );
        const risky = worst >= RISK_RANK.High;
        return {
          confidence: Math.round((r.confidence ?? 0.8) * 100),
          risky,
          reason: risky
            ? `High/Critical claim detected (escalating to reasoning tier)`
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

        const findings: ClaimFinding[] = Array.isArray(parsed.findings)
          ? parsed.findings
              .map((f: any): ClaimFinding | null => {
                const claimType =
                  typeof f?.claimType === "string" && f.claimType.trim()
                    ? f.claimType.trim()
                    : null;
                if (!claimType) return null;
                const riskLevel: ClaimRiskLevel = VALID_RISK.has(f?.riskLevel)
                  ? f.riskLevel
                  : "Medium";
                return {
                  claimType,
                  claimText: f?.claimText ?? null,
                  jurisdiction: f?.jurisdiction ?? null,
                  riskLevel,
                  regulationReference: f?.regulationReference ?? null,
                  remediation: f?.remediation ?? null,
                  confidence: clampInt(f?.confidence, 0, 100, 70),
                };
              })
              .filter((f: ClaimFinding | null): f is ClaimFinding => f !== null)
          : [];

        return {
          result: {
            summary: String(parsed?.summary ?? ""),
            confidence: clampUnit(parsed?.confidence, 0.8),
            findings,
          },
          usage: readUsage(response.usage),
        };
      },
    });

    return { ...result, orchestration };
  };

  return cachedAiCall<ClaimsAnalysisResult>({
    orgId: pkg.organizationId,
    workload: "claims_review",
    promptVersion: CLAIMS_PROMPT_VERSION,
    keyParts: [system, user],
    compute,
  });
}
