// Category router for eCFR: maps a product category to the CFR title + parts
// whose synced content applies, and detects a package's category from its fields
// and OCR text. Only a curated set of labeling-relevant parts is covered — full
// titles are never mirrored.

import type { PackageRow } from "@workspace/db";

export type EcfrCategory =
  | "food"
  | "supplement"
  | "drug"
  | "cosmetic"
  | "pesticide";

export interface CuratedPart {
  title: number; // CFR title number
  part: string; // CFR part number
  category: EcfrCategory;
  label: string;
}

// The curated parts synced locally. Additional parts can be added here later.
// Title 21 = FDA (food, cosmetics, OTC drugs, supplements); Title 40 = EPA
// (pesticides, disinfectants, antimicrobials).
export const CURATED_PARTS: CuratedPart[] = [
  { title: 21, part: "101", category: "food", label: "Food Labeling" },
  {
    title: 21,
    part: "111",
    category: "supplement",
    label: "Dietary Supplement CGMP",
  },
  { title: 21, part: "201", category: "drug", label: "Drug Labeling" },
  { title: 21, part: "701", category: "cosmetic", label: "Cosmetic Labeling" },
  {
    title: 40,
    part: "156",
    category: "pesticide",
    label: "Pesticide Labeling Requirements",
  },
  {
    title: 40,
    part: "152",
    category: "pesticide",
    label: "Pesticide Registration Procedures",
  },
];

const CATEGORY_LABELS: Record<EcfrCategory, string> = {
  food: "Food (Title 21)",
  supplement: "Dietary Supplement (Title 21)",
  drug: "OTC Drug (Title 21)",
  cosmetic: "Cosmetic (Title 21)",
  pesticide: "Pesticide / Antimicrobial (Title 40)",
};

export function ecfrCategoryLabel(category: EcfrCategory): string {
  return CATEGORY_LABELS[category];
}

// Keyword heuristics, most specific first. Pesticide/EPA is checked before food
// so a "disinfectant spray" routes to Title 40 rather than food.
const KEYWORD_RULES: { category: EcfrCategory; patterns: RegExp }[] = [
  {
    category: "pesticide",
    patterns:
      /\b(pesticide|insecticide|herbicide|fungicide|disinfectant|antimicrobial|sanitiz(er|ing)|germicid|bleach|repellent|weed killer|bug spray|roach|ant killer|epa reg|kills? \d|antibacterial)\b/i,
  },
  {
    category: "supplement",
    patterns:
      /\b(supplement|vitamin|dietary|probiotic|herbal|nutraceutical|multivitamin|gummies?)\b/i,
  },
  {
    category: "drug",
    patterns:
      /\b(drug|otc|over[-\s]?the[-\s]?counter|medic(ine|ation)|pharmac|analgesic|antacid|ibuprofen|acetaminophen|aspirin|cough|cold|allergy relief|drug facts|active ingredient)\b/i,
  },
  {
    category: "cosmetic",
    patterns:
      /\b(cosmetic|beauty|makeup|make[-\s]?up|skincare|skin care|lotion|shampoo|conditioner|fragrance|perfume|nail|lipstick|mascara|personal care|deodorant|sunscreen)\b/i,
  },
  {
    category: "food",
    patterns:
      /\b(food|snack|beverage|drink|candy|grocery|cereal|sauce|frozen|dairy|meat|bakery|confection|nutrition facts|edible|seasoning)\b/i,
  },
];

export interface EcfrCategoryDetection {
  category: EcfrCategory | null;
  label: string;
}

export function detectEcfrCategory(pkg: PackageRow): EcfrCategoryDetection {
  const haystack = [
    pkg.category,
    pkg.productType,
    pkg.packageType,
    pkg.name,
    pkg.ocr?.productName,
    pkg.ocr?.ingredients,
    pkg.ocr?.claims?.join(" "),
    pkg.ocr?.directions,
    pkg.extractedText?.slice(0, 2000),
  ]
    .filter(Boolean)
    .join(" ");

  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.test(haystack)) {
      return {
        category: rule.category,
        label: CATEGORY_LABELS[rule.category],
      };
    }
  }
  return { category: null, label: pkg.category ?? "Uncategorized" };
}

// The category tags whose sections apply to a detected category. Supplements
// pull in both the supplement CGMP part and general food labeling.
export function tagsForCategory(category: EcfrCategory): EcfrCategory[] {
  if (category === "supplement") return ["supplement", "food"];
  return [category];
}

export const ALL_ECFR_CATEGORIES: EcfrCategory[] = [
  "food",
  "supplement",
  "drug",
  "cosmetic",
  "pesticide",
];
