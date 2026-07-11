// eCFR sync: fetch the curated CFR parts, parse them into sections, embed, and
// idempotently store them locally. This is the ONLY place that hits the eCFR
// network; individual reviews always read the synced local content.

import { logger } from "../logger";
import { fetchPartXml, resolveTitleDate } from "./client";
import { parsePartSections } from "./parser";
import { CURATED_PARTS } from "./router";
import { ensureEcfrIndexes, replacePartSections } from "./engine";

// Background job identity + cadence. Content refreshes weekly; nothing queries
// eCFR during an individual review.
export const ECFR_SYNC_TYPE = "ecfr.sync";
export const ECFR_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface EcfrSyncResult {
  parts: number;
  partsSynced: number;
  sectionsStored: number;
  failures: { part: string; error: string }[];
  at: string;
}

// Run a full sync over all curated parts. Fails safe per-part: a fetch/parse
// error on one part is recorded and skipped (its existing rows are preserved),
// so a single unreachable part never aborts the whole sync.
export async function runEcfrSync(): Promise<EcfrSyncResult> {
  await ensureEcfrIndexes();

  // Resolve edition dates per title once.
  const titleDates = new Map<number, string | null>();
  for (const title of new Set(CURATED_PARTS.map((p) => p.title))) {
    try {
      titleDates.set(title, await resolveTitleDate(title));
    } catch (err) {
      logger.error({ err, title }, "eCFR: failed to resolve title edition date");
      titleDates.set(title, null);
    }
  }

  let partsSynced = 0;
  let sectionsStored = 0;
  const failures: { part: string; error: string }[] = [];

  for (const curated of CURATED_PARTS) {
    const label = `${curated.title} CFR ${curated.part}`;
    const date = titleDates.get(curated.title) ?? null;
    if (!date) {
      failures.push({ part: label, error: "No edition date available" });
      continue;
    }
    try {
      const xml = await fetchPartXml(curated.title, curated.part, date);
      const sections = parsePartSections(xml, curated.title, curated.part);
      if (sections.length === 0) {
        failures.push({ part: label, error: "No sections parsed" });
        continue;
      }
      const stored = await replacePartSections({
        title: curated.title,
        part: curated.part,
        category: curated.category,
        editionDate: date,
        sections,
      });
      partsSynced += 1;
      sectionsStored += stored;
      logger.info({ part: label, stored }, "eCFR: synced part");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ part: label, error: message });
      logger.error({ err, part: label }, "eCFR: part sync failed");
    }
  }

  return {
    parts: CURATED_PARTS.length,
    partsSynced,
    sectionsStored,
    failures,
    at: new Date().toISOString(),
  };
}
