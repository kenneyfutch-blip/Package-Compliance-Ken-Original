// Thin server-side client for the openFDA API (https://open.fda.gov/apis/).
// The API key is read from the environment and never leaves the server — the
// browser talks only to our own /fda proxy route.

const BASE_URL = "https://api.fda.gov";

// openFDA exposes a separate enforcement (recall) dataset per product family.
const ENFORCEMENT_DATASETS = {
  food: "food",
  drug: "drug",
  device: "device",
} as const;

export type FdaCategory = keyof typeof ENFORCEMENT_DATASETS;

export const FDA_CATEGORIES: FdaCategory[] = ["food", "drug", "device"];

export class FdaNotConfiguredError extends Error {
  constructor() {
    super("OPENFDA_API_KEY is not configured");
    this.name = "FdaNotConfiguredError";
  }
}

export interface FdaRecall {
  recallNumber: string;
  category: FdaCategory;
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

export interface RecallLookup {
  results: FdaRecall[];
  total: number;
}

interface OpenFdaEnforcementResult {
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

interface OpenFdaResponse {
  meta?: { results?: { total?: number } };
  results?: OpenFdaEnforcementResult[];
  error?: { code?: string; message?: string };
}

// openFDA returns dates as YYYYMMDD; normalize to ISO-ish YYYY-MM-DD.
function formatDate(raw?: string): string | null {
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

function mapResult(r: OpenFdaEnforcementResult, category: FdaCategory): FdaRecall {
  const location = [r.city, r.state, r.country].filter(Boolean).join(", ");
  return {
    recallNumber: r.recall_number ?? "",
    category,
    status: r.status ?? "Unknown",
    classification: r.classification ?? "",
    productDescription: r.product_description ?? "",
    reason: r.reason_for_recall ?? "",
    recallingFirm: r.recalling_firm ?? "",
    distributionPattern: r.distribution_pattern ?? "",
    location,
    initiationDate: formatDate(r.recall_initiation_date),
    reportDate: formatDate(r.report_date),
  };
}

export interface RecallQuery {
  category: FdaCategory;
  search?: string;
  limit?: number;
}

export async function fetchRecalls({
  category,
  search,
  limit = 20,
}: RecallQuery): Promise<RecallLookup> {
  const apiKey = process.env.OPENFDA_API_KEY;
  if (!apiKey) throw new FdaNotConfiguredError();

  const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);

  const params: string[] = [
    `api_key=${encodeURIComponent(apiKey)}`,
    `limit=${cappedLimit}`,
    "sort=report_date:desc",
  ];

  const term = search?.trim();
  if (term) {
    // Phrase-match the term across the most useful free-text fields (OR).
    const phrase = `%22${encodeURIComponent(term)}%22`;
    params.push(
      `search=(product_description:${phrase}+OR+recalling_firm:${phrase}+OR+reason_for_recall:${phrase})`,
    );
  }

  const dataset = ENFORCEMENT_DATASETS[category];
  const url = `${BASE_URL}/${dataset}/enforcement.json?${params.join("&")}`;

  const resp = await fetch(url);

  // openFDA returns 404 with a NOT_FOUND error body when there are zero matches.
  if (resp.status === 404) {
    return { results: [], total: 0 };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`openFDA request failed (${resp.status}): ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as OpenFdaResponse;
  if (data.error) {
    if (data.error.code === "NOT_FOUND") return { results: [], total: 0 };
    throw new Error(`openFDA error: ${data.error.message ?? data.error.code}`);
  }

  const results = (data.results ?? []).map((r) => mapResult(r, category));
  return { results, total: data.meta?.results?.total ?? results.length };
}
