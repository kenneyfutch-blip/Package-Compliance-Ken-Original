// Low-level client for the public eCFR (Electronic Code of Federal Regulations)
// API (https://www.ecfr.gov/developers/documentation/api/v1). eCFR is public
// federal data and needs no API key.
//
// This module deliberately fetches ONE CFR part at a time (verified sub-MB,
// sub-second) — never a whole title, which is far too large. Higher-level
// parsing, category routing, and per-package aggregation live in sibling files.

const BASE_URL = "https://www.ecfr.gov";

// Part XML can be several hundred KB, so give it a generous but bounded timeout;
// titles.json is tiny.
const PART_TIMEOUT_MS = Number(process.env.ECFR_PART_TIMEOUT_MS) || 30_000;
const TITLES_TIMEOUT_MS = Number(process.env.ECFR_TITLES_TIMEOUT_MS) || 12_000;

// Thrown when eCFR is reachable-but-failing (5xx, malformed body, network).
export class EcfrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcfrUnavailableError";
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json, application/xml, text/xml" },
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface EcfrTitleMeta {
  number: number;
  name: string;
  latestIssueDate: string | null;
  upToDateAsOf: string | null;
  reserved: boolean;
}

interface RawTitle {
  number?: number;
  name?: string;
  latest_issue_date?: string | null;
  up_to_date_as_of?: string | null;
  reserved?: boolean;
}

// Short-lived cache for the titles list so a sync run + a status probe don't
// double-fetch. Never cached on failure.
let titlesCache: { at: number; value: EcfrTitleMeta[] } | null = null;
const TITLES_CACHE_TTL_MS = 5 * 60_000;

export async function fetchTitles(): Promise<EcfrTitleMeta[]> {
  if (titlesCache && Date.now() - titlesCache.at < TITLES_CACHE_TTL_MS) {
    return titlesCache.value;
  }
  let resp: globalThis.Response;
  try {
    resp = await fetchWithTimeout(
      `${BASE_URL}/api/versioner/v1/titles.json`,
      TITLES_TIMEOUT_MS,
    );
  } catch (err) {
    throw new EcfrUnavailableError(
      `eCFR titles request errored: ${(err as Error).message}`,
    );
  }
  if (!resp.ok) {
    throw new EcfrUnavailableError(`eCFR titles request failed (${resp.status})`);
  }
  let body: { titles?: RawTitle[] };
  try {
    body = (await resp.json()) as { titles?: RawTitle[] };
  } catch {
    throw new EcfrUnavailableError("eCFR titles returned a malformed response");
  }
  const value = (body.titles ?? []).map((t) => ({
    number: Number(t.number),
    name: String(t.name ?? ""),
    latestIssueDate: t.latest_issue_date ?? null,
    upToDateAsOf: t.up_to_date_as_of ?? null,
    reserved: Boolean(t.reserved),
  }));
  titlesCache = { at: Date.now(), value };
  return value;
}

// Resolve the edition (issue) date to fetch a title's content from. eCFR content
// is keyed by an issue date; the title's own latest issue date is the correct one.
export async function resolveTitleDate(title: number): Promise<string | null> {
  const titles = await fetchTitles();
  const meta = titles.find((t) => t.number === title);
  return meta?.latestIssueDate ?? meta?.upToDateAsOf ?? null;
}

// Fetch the full XML for a single CFR part on a given edition date. The part is
// allowlisted by the caller (router) so user input can never influence the URL.
export async function fetchPartXml(
  title: number,
  part: string,
  date: string,
): Promise<string> {
  const url = `${BASE_URL}/api/versioner/v1/full/${encodeURIComponent(
    date,
  )}/title-${encodeURIComponent(String(title))}.xml?part=${encodeURIComponent(part)}`;
  let resp: globalThis.Response;
  try {
    resp = await fetchWithTimeout(url, PART_TIMEOUT_MS);
  } catch (err) {
    throw new EcfrUnavailableError(
      `eCFR part request errored: ${(err as Error).message}`,
    );
  }
  if (!resp.ok) {
    throw new EcfrUnavailableError(
      `eCFR part request failed (${resp.status}) for ${title} CFR ${part}`,
    );
  }
  const xml = await resp.text();
  if (!xml || !xml.includes("<DIV")) {
    throw new EcfrUnavailableError(
      `eCFR part ${title} CFR ${part} returned no content`,
    );
  }
  return xml;
}

// Lightweight reachability probe for the admin status panel. Never throws.
export async function pingEcfr(): Promise<boolean> {
  try {
    const resp = await fetchWithTimeout(
      `${BASE_URL}/api/versioner/v1/titles.json`,
      TITLES_TIMEOUT_MS,
    );
    return resp.ok;
  } catch {
    return false;
  }
}

// eCFR is public data with no key; it is always "configured".
export function isEcfrConfigured(): boolean {
  return true;
}

// Public deep link to a section on ecfr.gov.
export function sectionUrl(title: number, section: string): string {
  return `${BASE_URL}/current/title-${title}/section-${section}`;
}
