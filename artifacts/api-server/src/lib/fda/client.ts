// Core server-side client for the openFDA API (https://open.fda.gov/apis/).
// The API key is read from the environment and never leaves the server — the
// browser only ever talks to our own /fda proxy routes.
//
// This module is intentionally low-level: callers pass a dataset path and a
// pre-built openFDA `search` expression (built with the helpers below). Higher
// level dataset/intelligence helpers live in sibling files.

import { logger } from "../logger";

const BASE_URL = "https://api.fda.gov";

export class FdaNotConfiguredError extends Error {
  constructor() {
    super("OPENFDA_API_KEY is not configured");
    this.name = "FdaNotConfiguredError";
  }
}

// Thrown when openFDA is reachable-but-failing (5xx, malformed body, network).
// Zero-match (404 / NOT_FOUND) is NOT an error — it resolves to empty results.
export class FdaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FdaUnavailableError";
  }
}

export function isFdaConfigured(): boolean {
  return Boolean(process.env.OPENFDA_API_KEY);
}

// Wrap a term in a URL-encoded exact phrase for openFDA search expressions.
export function quote(term: string): string {
  return `%22${encodeURIComponent(term.trim())}%22`;
}

// Build an OR expression matching `term` across several fields.
export function anyField(fields: string[], term: string): string {
  const phrase = quote(term);
  return `(${fields.map((f) => `${f}:${phrase}`).join("+OR+")})`;
}

// Join several search clauses with AND.
export function allOf(...clauses: (string | undefined | null)[]): string {
  return clauses.filter(Boolean).join("+AND+");
}

interface OpenFdaResponse<T> {
  meta?: { results?: { total?: number } };
  results?: T[];
  error?: { code?: string; message?: string };
}

export interface FdaQuery {
  // Dataset path without the .json suffix, e.g. "food/enforcement", "drug/label".
  dataset: string;
  // Pre-built, URL-encoded openFDA search expression (use quote/anyField/allOf).
  search?: string;
  limit?: number;
  sort?: string;
  // When set, returns a faceted count instead of records (openFDA `count`).
  count?: string;
}

export interface FdaResult<T> {
  results: T[];
  total: number;
}

// openFDA data changes slowly (recalls/labels update daily at most), so we cache
// successful responses in-process to stay well within rate limits and keep the
// review workspace snappy. Failures are never cached — a transient outage must
// not be pinned for the whole TTL.
const CACHE_TTL_MS = Number(process.env.FDA_CACHE_TTL_MS) || 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = Number(process.env.FDA_TIMEOUT_MS) || 8000;

// fetch with an abort-based timeout so a slow openFDA never hangs a review.
async function fetchWithTimeout(url: string): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// openFDA does not require an API key — a key only raises the rate limits. So a
// missing OR invalid key must never dark-out the feature. Once openFDA rejects
// the configured key with a 403 (API_KEY_INVALID), we remember that for the rest
// of the process and fall back to keyless requests instead of failing every call.
let apiKeyRejected = false;

// Perform an openFDA GET against a URL that does NOT yet include api_key. When a
// key is configured (and not already known-bad) it is appended; on a 403 the key
// is dropped and the request is retried keyless.
async function fetchOpenFda(urlNoKey: string): Promise<globalThis.Response> {
  const apiKey = process.env.OPENFDA_API_KEY;
  if (apiKey && !apiKeyRejected) {
    const sep = urlNoKey.includes("?") ? "&" : "?";
    const resp = await fetchWithTimeout(
      `${urlNoKey}${sep}api_key=${encodeURIComponent(apiKey)}`,
    );
    if (resp.status !== 403) return resp;
    // A 403 is only treated as a bad-key signal when openFDA actually reports an
    // invalid key — other 403s (e.g. IP-based blocks) must NOT disable keyed
    // mode. We buffer the body so a non-key 403 still flows to the caller intact.
    const body = await resp.text().catch(() => "");
    if (!/API_KEY_INVALID/i.test(body)) {
      return new Response(body, {
        status: resp.status,
        statusText: resp.statusText,
      });
    }
    apiKeyRejected = true;
    logger.warn(
      "openFDA rejected OPENFDA_API_KEY (403 API_KEY_INVALID); falling back to keyless requests. Set a valid key at https://open.fda.gov/apis/authentication/ for higher rate limits.",
    );
    return fetchWithTimeout(urlNoKey);
  }
  return fetchWithTimeout(urlNoKey);
}

interface CacheEntry {
  expires: number;
  value: FdaResult<unknown>;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): FdaResult<unknown> | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU ordering.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key: string, value: FdaResult<unknown>): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
}

export function clearFdaCache(): void {
  cache.clear();
}

// Lightweight reachability probe for the admin status panel. Returns true if
// openFDA answers a trivial query, false on any failure. Never throws.
export async function pingFda(): Promise<boolean> {
  if (!isFdaConfigured()) return false;
  try {
    const resp = await fetchOpenFda(`${BASE_URL}/food/enforcement.json?limit=1`);
    // A 404 (zero matches) still proves the service is reachable.
    return resp.ok || resp.status === 404;
  } catch {
    return false;
  }
}

// openFDA returns dates as YYYYMMDD; normalize to ISO-ish YYYY-MM-DD.
export function formatFdaDate(raw?: string | null): string | null {
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

export async function fdaFetch<T = unknown>({
  dataset,
  search,
  limit = 10,
  sort,
  count,
}: FdaQuery): Promise<FdaResult<T>> {
  if (!isFdaConfigured()) throw new FdaNotConfiguredError();

  const params: string[] = [];

  if (count) {
    params.push(`count=${encodeURIComponent(count)}`);
  } else {
    const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    params.push(`limit=${cappedLimit}`);
    if (sort) params.push(`sort=${encodeURIComponent(sort)}`);
  }
  if (search) params.push(`search=${search}`);

  const url = `${BASE_URL}/${dataset}.json?${params.join("&")}`;
  // Cache key deliberately excludes the api_key so it stays stable.
  const cacheKey = `${dataset}|${search ?? ""}|${count ?? ""}|${sort ?? ""}|${count ? "" : Math.min(Math.max(Math.trunc(limit), 1), 1000)}`;

  const cached = cacheGet(cacheKey);
  if (cached) return cached as FdaResult<T>;

  let resp: globalThis.Response;
  try {
    resp = await fetchOpenFda(url);
  } catch (err) {
    throw new FdaUnavailableError(
      `openFDA request errored: ${(err as Error).message}`,
    );
  }

  // openFDA returns 404 with a NOT_FOUND body when there are zero matches.
  if (resp.status === 404) {
    const empty = { results: [], total: 0 };
    cacheSet(cacheKey, empty);
    return empty;
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new FdaUnavailableError(
      `openFDA request failed (${resp.status}): ${body.slice(0, 200)}`,
    );
  }

  let data: OpenFdaResponse<T>;
  try {
    data = (await resp.json()) as OpenFdaResponse<T>;
  } catch {
    throw new FdaUnavailableError("openFDA returned a malformed response");
  }

  if (data.error) {
    if (data.error.code === "NOT_FOUND") {
      const empty = { results: [], total: 0 };
      cacheSet(cacheKey, empty);
      return empty;
    }
    throw new FdaUnavailableError(
      `openFDA error: ${data.error.message ?? data.error.code}`,
    );
  }

  const results = data.results ?? [];
  const value = { results, total: data.meta?.results?.total ?? results.length };
  cacheSet(cacheKey, value);
  return value as FdaResult<T>;
}
