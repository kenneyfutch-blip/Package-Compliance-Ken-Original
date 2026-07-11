// Dataset-specific helpers over the low-level openFDA client. Each function
// knows the shape of one openFDA dataset and returns normalized, typed data.

import {
  fdaFetch,
  anyField,
  allOf,
  quote,
  formatFdaDate,
  type FdaResult,
} from "./client";

// ---------------------------------------------------------------------------
// Enforcement (recalls) — food / drug / device each have their own dataset.
// ---------------------------------------------------------------------------

export type RecallCategory = "food" | "drug" | "device";
export const RECALL_CATEGORIES: RecallCategory[] = ["food", "drug", "device"];

export interface FdaRecall {
  recallNumber: string;
  category: RecallCategory;
  status: string;
  classification: string;
  productDescription: string;
  reason: string;
  recallingFirm: string;
  distributionPattern: string;
  location: string;
  initiationDate: string | null;
  reportDate: string | null;
}

interface OpenFdaEnforcement {
  recall_number?: string;
  status?: string;
  classification?: string;
  product_description?: string;
  reason_for_recall?: string;
  recalling_firm?: string;
  distribution_pattern?: string;
  city?: string;
  state?: string;
  country?: string;
  recall_initiation_date?: string;
  report_date?: string;
}

function mapRecall(r: OpenFdaEnforcement, category: RecallCategory): FdaRecall {
  return {
    recallNumber: r.recall_number ?? "",
    category,
    status: r.status ?? "Unknown",
    classification: r.classification ?? "",
    productDescription: r.product_description ?? "",
    reason: r.reason_for_recall ?? "",
    recallingFirm: r.recalling_firm ?? "",
    distributionPattern: r.distribution_pattern ?? "",
    location: [r.city, r.state, r.country].filter(Boolean).join(", "),
    initiationDate: formatFdaDate(r.recall_initiation_date),
    reportDate: formatFdaDate(r.report_date),
  };
}

export async function fetchRecalls(opts: {
  category: RecallCategory;
  search?: string;
  limit?: number;
}): Promise<FdaResult<FdaRecall>> {
  const term = opts.search?.trim();
  const search = term
    ? anyField(
        ["product_description", "recalling_firm", "reason_for_recall"],
        term,
      )
    : undefined;

  const { results, total } = await fdaFetch<OpenFdaEnforcement>({
    dataset: `${opts.category}/enforcement`,
    search,
    limit: opts.limit ?? 20,
    sort: "report_date:desc",
  });

  return { results: results.map((r) => mapRecall(r, opts.category)), total };
}

// ---------------------------------------------------------------------------
// Drug labeling (SPL) — warnings, boxed warnings, indications.
// ---------------------------------------------------------------------------

export interface FdaDrugLabel {
  brandName: string;
  genericName: string;
  boxedWarning: string | null;
  warnings: string[];
  indications: string | null;
}

interface OpenFdaLabel {
  openfda?: { brand_name?: string[]; generic_name?: string[] };
  boxed_warning?: string[];
  warnings?: string[];
  warnings_and_cautions?: string[];
  do_not_use?: string[];
  indications_and_usage?: string[];
}

function firstSentence(text: string, max = 320): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean;
}

function mapLabel(r: OpenFdaLabel): FdaDrugLabel {
  const warnings = [
    ...(r.warnings ?? []),
    ...(r.warnings_and_cautions ?? []),
    ...(r.do_not_use ?? []),
  ]
    .map((w) => firstSentence(w))
    .filter(Boolean)
    .slice(0, 4);

  return {
    brandName: r.openfda?.brand_name?.[0] ?? "",
    genericName: r.openfda?.generic_name?.[0] ?? "",
    boxedWarning: r.boxed_warning?.[0] ? firstSentence(r.boxed_warning[0]) : null,
    warnings,
    indications: r.indications_and_usage?.[0]
      ? firstSentence(r.indications_and_usage[0])
      : null,
  };
}

export async function fetchDrugLabels(
  term: string | undefined,
  limit = 3,
): Promise<FdaResult<FdaDrugLabel>> {
  const t = term?.trim();
  const search = t
    ? anyField(["openfda.brand_name", "openfda.generic_name"], t)
    : "_exists_:warnings";

  const { results, total } = await fdaFetch<OpenFdaLabel>({
    dataset: "drug/label",
    search,
    limit,
  });
  return { results: results.map(mapLabel), total };
}

// ---------------------------------------------------------------------------
// Adverse events (CAERS via food/event) — covers foods, dietary supplements,
// and cosmetics. There is no dedicated openFDA cosmetic dataset; cosmetics ride
// on food/event filtered by industry.
// ---------------------------------------------------------------------------

export interface FdaReactionCount {
  term: string;
  count: number;
}

export interface AdverseEventSummary {
  total: number;
  topReactions: FdaReactionCount[];
}

interface OpenFdaCount {
  term?: string;
  count?: number;
}

export async function fetchAdverseEvents(opts: {
  industry?: string;
  term?: string;
}): Promise<AdverseEventSummary> {
  const term = opts.term?.trim();
  const clauses: (string | undefined)[] = [];
  if (opts.industry) {
    clauses.push(`products.industry_name:${quote(opts.industry)}`);
  }
  if (term) clauses.push(anyField(["products.name_brand"], term));
  const search = clauses.length ? allOf(...clauses) : undefined;

  // One faceted count for the top reactions, one limit=1 call for the total.
  const [reactions, totalResult] = await Promise.all([
    fdaFetch<OpenFdaCount>({
      dataset: "food/event",
      search,
      count: "reactions.exact",
    }),
    fdaFetch<unknown>({ dataset: "food/event", search, limit: 1 }),
  ]);

  return {
    total: totalResult.total,
    topReactions: reactions.results
      .slice(0, 6)
      .map((r) => ({ term: r.term ?? "", count: r.count ?? 0 }))
      .filter((r) => r.term),
  };
}
