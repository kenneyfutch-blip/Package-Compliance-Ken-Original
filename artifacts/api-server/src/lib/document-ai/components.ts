import type { ExtractedComponent } from "@workspace/db";
import { DOCUMENT_COMPONENT_TYPES } from "@workspace/db";

// Normalize an ML entity type string (from a custom extractor) onto our
// canonical taxonomy. Falls back to a title-cased version of the raw type.
export function mapEntityType(raw: string): string {
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  for (const type of DOCUMENT_COMPONENT_TYPES) {
    if (type.toLowerCase().replace(/[\s_-]+/g, "") === key) return type;
  }
  const aliases: Record<string, string> = {
    productname: "Product Name",
    ingredient: "Ingredients",
    ingredients: "Ingredients",
    nutrition: "Nutrition Facts",
    nutritionfacts: "Nutrition Facts",
    warning: "Warnings",
    warnings: "Warnings",
    direction: "Directions",
    directions: "Directions",
    claim: "Claims",
    claims: "Claims",
    allergen: "Allergen Statements",
    allergens: "Allergen Statements",
    manufacturer: "Manufacturer Information",
    countryoforigin: "Country Of Origin",
    origin: "Country Of Origin",
    netweight: "Net Weight",
    netcontents: "Net Weight",
    lot: "Lot Codes",
    lotcode: "Lot Codes",
    expiration: "Expiration Dates",
    expirationdate: "Expiration Dates",
    epa: "EPA Registration Numbers",
    epareg: "EPA Registration Numbers",
    hazard: "Hazard Statements",
    barcode: "Barcode Regions",
    upc: "Barcode Regions",
  };
  return aliases[key] ?? raw.trim() ?? "Unknown";
}

type Pattern = { type: string; regex: RegExp };

// Deterministic pattern extraction over the OCR text. This is still
// "extraction" (no LLM reasoning) — it surfaces the structured, pattern-based
// components that Layout Parser does not return as entities.
const PATTERNS: Pattern[] = [
  {
    type: "Net Weight",
    regex:
      /\bnet\s*(?:wt\.?|weight|contents?)\s*[:.]?\s*([\d.,]+\s*(?:oz|g|kg|lb|lbs|ml|l|fl\.?\s*oz|gal|ct|count)\b[^\n]*)/gi,
  },
  {
    type: "EPA Registration Numbers",
    regex: /\bEPA\s*Reg(?:istration)?\.?\s*(?:No\.?|Number)?\s*[:#]?\s*([\d]{2,7}-[\d]{1,7}(?:-[\d]{1,7})?)/gi,
  },
  {
    type: "Lot Codes",
    regex: /\bLot\s*(?:No\.?|Code|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/gi,
  },
  {
    type: "Expiration Dates",
    regex:
      /\b(?:EXP(?:IRES?|IRATION)?|Best\s*(?:By|Before)|Use\s*By)\.?\s*(?:date)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\/.\- ]{4,20})/gi,
  },
  {
    type: "Barcode Regions",
    regex: /\b(\d{12,13})\b/g,
  },
];

export function extractHeuristicComponents(
  text: string,
  existing: ExtractedComponent[],
): ExtractedComponent[] {
  if (!text) return [];
  // Do not duplicate a component type that an ML entity already provided.
  const covered = new Set(existing.map((c) => c.type));
  const out: ExtractedComponent[] = [];
  const seen = new Set<string>();

  for (const { type, regex } of PATTERNS) {
    if (covered.has(type)) continue;
    let match: RegExpExecArray | null;
    // Cap matches per type to avoid runaway output on large documents.
    let count = 0;
    while ((match = regex.exec(text)) !== null && count < 5) {
      const value = (match[1] ?? "").trim();
      if (!value) continue;
      const dedupeKey = `${type}:${value.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        type,
        text: value,
        confidence: null,
        page: null,
        bbox: null,
        source: "heuristic",
      });
      count++;
    }
  }
  return out;
}
