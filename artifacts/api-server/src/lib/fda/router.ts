// Category router: given a package, decide which FDA regulatory category
// applies and which openFDA datasets ("sources") should be consulted. Users
// never pick datasets manually — the system determines applicable regulations.

import type { PackageRow } from "@workspace/db";

export type FdaCategory = "food" | "supplement" | "drug" | "cosmetic" | "device";

export interface FdaSource {
  id: FdaSourceId;
  label: string;
  description: string;
}

export type FdaSourceId =
  | "food_enforcement"
  | "food_event"
  | "drug_label"
  | "drug_enforcement"
  | "device_enforcement"
  | "cosmetic_event";

export interface FdaReference {
  code: string;
  title: string;
}

export interface FdaLink {
  label: string;
  url: string;
}

const CATEGORY_LABELS: Record<FdaCategory, string> = {
  food: "Food",
  supplement: "Dietary Supplement",
  drug: "OTC Drug",
  cosmetic: "Cosmetic",
  device: "Medical Device",
};

// Keyword heuristics applied to the package category / product type / OCR text.
// Order matters: more specific categories are checked first.
const KEYWORD_RULES: { category: FdaCategory; patterns: RegExp }[] = [
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
    category: "device",
    patterns:
      /\b(device|medical device|thermometer|glucose|bandage|first aid|syringe|contact lens|blood pressure)\b/i,
  },
  {
    category: "food",
    patterns:
      /\b(food|snack|beverage|drink|candy|grocery|cereal|sauce|frozen|dairy|meat|bakery|confection|nutrition facts|edible|seasoning)\b/i,
  },
];

export interface CategoryDetection {
  category: FdaCategory | null;
  label: string;
}

export function detectFdaCategory(pkg: PackageRow): CategoryDetection {
  const haystack = [
    pkg.category,
    pkg.productType,
    pkg.packageType,
    pkg.name,
    pkg.ocr?.productName,
    pkg.ocr?.ingredients,
    pkg.ocr?.claims?.join(" "),
    pkg.ocr?.directions,
  ]
    .filter(Boolean)
    .join(" ");

  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.test(haystack)) {
      return { category: rule.category, label: CATEGORY_LABELS[rule.category] };
    }
  }
  return { category: null, label: pkg.category ?? "Uncategorized" };
}

const SOURCE_DEFS: Record<FdaSourceId, FdaSource> = {
  food_enforcement: {
    id: "food_enforcement",
    label: "FDA Food Enforcement (Recalls)",
    description: "Food recall & enforcement actions.",
  },
  food_event: {
    id: "food_event",
    label: "FDA CAERS Adverse Events",
    description: "Consumer adverse-event reports for foods, supplements & cosmetics.",
  },
  drug_label: {
    id: "drug_label",
    label: "FDA Drug Labeling",
    description: "Structured product labeling — warnings & indications.",
  },
  drug_enforcement: {
    id: "drug_enforcement",
    label: "FDA Drug Enforcement (Recalls)",
    description: "Drug recall & enforcement actions.",
  },
  device_enforcement: {
    id: "device_enforcement",
    label: "FDA Device Enforcement (Recalls)",
    description: "Medical device recall & enforcement actions.",
  },
  cosmetic_event: {
    id: "cosmetic_event",
    label: "FDA CAERS Adverse Events (Cosmetics)",
    description: "Consumer adverse-event reports for cosmetics.",
  },
};

const CATEGORY_SOURCES: Record<FdaCategory, FdaSourceId[]> = {
  food: ["food_enforcement", "food_event"],
  supplement: ["food_enforcement", "food_event"],
  drug: ["drug_label", "drug_enforcement"],
  cosmetic: ["cosmetic_event"],
  device: ["device_enforcement"],
};

export function sourcesForCategory(category: FdaCategory): FdaSource[] {
  return CATEGORY_SOURCES[category].map((id) => SOURCE_DEFS[id]);
}

const CATEGORY_REFERENCES: Record<FdaCategory, FdaReference[]> = {
  food: [
    { code: "21 CFR 101", title: "Food Labeling — general requirements" },
    { code: "21 CFR 101.9", title: "Nutrition Facts labeling" },
    { code: "FALCPA §403(w)", title: "Food Allergen Labeling" },
  ],
  supplement: [
    { code: "21 CFR 101.36", title: "Supplement Facts labeling" },
    { code: "DSHEA", title: "Dietary Supplement Health & Education Act" },
  ],
  drug: [
    { code: "21 CFR 201", title: "Drug labeling" },
    { code: "21 CFR 201.66", title: "OTC Drug Facts panel" },
    { code: "21 CFR 330", title: "OTC drug monograph requirements" },
  ],
  cosmetic: [
    { code: "21 CFR 700", title: "Cosmetics — general" },
    { code: "21 CFR 701", title: "Cosmetic labeling" },
    { code: "FPLA", title: "Fair Packaging & Labeling Act" },
  ],
  device: [
    { code: "21 CFR 801", title: "Medical device labeling" },
    { code: "21 CFR 807", title: "Establishment registration & listing" },
  ],
};

export function referencesForCategory(category: FdaCategory): FdaReference[] {
  return CATEGORY_REFERENCES[category];
}

const SOURCE_LINKS: Record<FdaSourceId, FdaLink> = {
  food_enforcement: {
    label: "openFDA — Food Enforcement",
    url: "https://open.fda.gov/apis/food/enforcement/",
  },
  food_event: {
    label: "openFDA — Food Events (CAERS)",
    url: "https://open.fda.gov/apis/food/event/",
  },
  drug_label: {
    label: "openFDA — Drug Labeling",
    url: "https://open.fda.gov/apis/drug/label/",
  },
  drug_enforcement: {
    label: "openFDA — Drug Enforcement",
    url: "https://open.fda.gov/apis/drug/enforcement/",
  },
  device_enforcement: {
    label: "openFDA — Device Enforcement",
    url: "https://open.fda.gov/apis/device/enforcement/",
  },
  cosmetic_event: {
    label: "openFDA — Food Events (CAERS)",
    url: "https://open.fda.gov/apis/food/event/",
  },
};

export function linksForCategory(category: FdaCategory): FdaLink[] {
  const seen = new Set<string>();
  const links: FdaLink[] = [];
  for (const id of CATEGORY_SOURCES[category]) {
    const link = SOURCE_LINKS[id];
    if (!seen.has(link.url)) {
      seen.add(link.url);
      links.push(link);
    }
  }
  return links;
}

export function categoryLabel(category: FdaCategory): string {
  return CATEGORY_LABELS[category];
}

export const ALL_FDA_CATEGORIES: FdaCategory[] = [
  "food",
  "supplement",
  "drug",
  "cosmetic",
  "device",
];

export interface FdaCatalogEntry {
  category: FdaCategory;
  label: string;
  sources: FdaSource[];
  references: FdaReference[];
  links: FdaLink[];
}

// Full mapping of category -> applicable FDA datasets & references, for the
// admin "Regulatory Sources" panel.
export function fdaCatalog(): FdaCatalogEntry[] {
  return ALL_FDA_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    sources: sourcesForCategory(category),
    references: referencesForCategory(category),
    links: linksForCategory(category),
  }));
}
