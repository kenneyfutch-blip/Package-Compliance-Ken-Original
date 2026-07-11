// Orchestrates the applicable FDA sources for a package into a single
// "FDA Intelligence" payload for the review workspace. Designed to degrade
// gracefully: an FDA outage or a category with no FDA coverage never throws —
// the review can always continue on internal standards.

import type { PackageRow } from "@workspace/db";
import { FdaNotConfiguredError, isFdaConfigured } from "./client";
import {
  fetchRecalls,
  fetchDrugLabels,
  fetchAdverseEvents,
  type FdaRecall,
} from "./datasets";
import {
  detectFdaCategory,
  sourcesForCategory,
  referencesForCategory,
  linksForCategory,
  categoryLabel,
  type FdaCategory,
  type FdaSource,
  type FdaReference,
  type FdaLink,
} from "./router";

const DISCLAIMER =
  "Data provided by openFDA (U.S. Food & Drug Administration). openFDA is not for clinical use; verify against primary sources before making compliance decisions.";

export interface FdaFinding {
  source: string;
  title: string;
  detail: string;
  severity?: string;
  date?: string | null;
  url?: string | null;
}

export interface FdaLabelExample {
  title: string;
  description: string;
  url?: string | null;
}

export interface FdaIntelligence {
  detectedCategory: FdaCategory | null;
  categoryLabel: string;
  searchTerm: string | null;
  applicableSources: FdaSource[];
  warnings: FdaFinding[];
  findings: FdaFinding[];
  labelExamples: FdaLabelExample[];
  references: FdaReference[];
  sourceLinks: FdaLink[];
  available: boolean;
  degraded: boolean;
  message: string | null;
  disclaimer: string;
}

function emptyIntelligence(
  overrides: Partial<FdaIntelligence>,
): FdaIntelligence {
  return {
    detectedCategory: null,
    categoryLabel: "Uncategorized",
    searchTerm: null,
    applicableSources: [],
    warnings: [],
    findings: [],
    labelExamples: [],
    references: [],
    sourceLinks: [],
    available: true,
    degraded: false,
    message: null,
    disclaimer: DISCLAIMER,
    ...overrides,
  };
}

function searchTermFor(pkg: PackageRow): string | null {
  return (
    pkg.brand?.trim() ||
    pkg.ocr?.productName?.trim() ||
    pkg.name?.trim() ||
    null
  );
}

const RECALL_SEARCH_URL =
  "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts";

function recallToFinding(source: string, r: FdaRecall): FdaFinding {
  const isCritical = /class i(\b|$)/i.test(r.classification) && !/class ii/i.test(r.classification);
  return {
    source,
    title: r.productDescription || r.recallingFirm || "Recall",
    detail: [r.reason, r.recallingFirm && `Firm: ${r.recallingFirm}`, r.classification]
      .filter(Boolean)
      .join(" — "),
    severity: isCritical ? "critical" : /class ii(\b|$)/i.test(r.classification) ? "major" : "info",
    date: r.reportDate,
    url: RECALL_SEARCH_URL,
  };
}

export async function gatherFdaIntelligence(
  pkg: PackageRow,
): Promise<FdaIntelligence> {
  if (!isFdaConfigured()) {
    return emptyIntelligence({
      available: false,
      message: "FDA integration is not configured.",
    });
  }

  const { category, label } = detectFdaCategory(pkg);
  if (!category) {
    return emptyIntelligence({
      categoryLabel: label,
      message:
        "No FDA regulatory source maps to this product category. It may fall under EPA or CPSC, which are planned in a later phase.",
    });
  }

  const term = searchTermFor(pkg);
  const sources = sourcesForCategory(category);
  const sourceLabel = (id: string) =>
    sources.find((s) => s.id === id)?.label ?? id;

  const warnings: FdaFinding[] = [];
  const findings: FdaFinding[] = [];
  const labelExamples: FdaLabelExample[] = [];

  // Build the set of dataset tasks for this category, tagged by source id.
  const tasks: { id: string; run: () => Promise<void> }[] = [];

  for (const source of sources) {
    switch (source.id) {
      case "food_enforcement":
      case "drug_enforcement":
      case "device_enforcement": {
        const cat =
          source.id === "food_enforcement"
            ? "food"
            : source.id === "drug_enforcement"
              ? "drug"
              : "device";
        tasks.push({
          id: source.id,
          run: async () => {
            const { results } = await fetchRecalls({
              category: cat,
              search: term ?? undefined,
              limit: 5,
            });
            for (const r of results) {
              const finding = recallToFinding(sourceLabel(source.id), r);
              if (/undeclared|allergen|misbrand|mislabel/i.test(r.reason)) {
                warnings.push(finding);
              } else {
                findings.push(finding);
              }
            }
          },
        });
        break;
      }
      case "drug_label": {
        tasks.push({
          id: source.id,
          run: async () => {
            const { results } = await fetchDrugLabels(term ?? undefined, 3);
            for (const label of results) {
              if (label.boxedWarning) {
                warnings.push({
                  source: sourceLabel(source.id),
                  title: `Boxed warning — ${label.brandName || label.genericName || "labeled drug"}`,
                  detail: label.boxedWarning,
                  severity: "critical",
                });
              }
              for (const w of label.warnings) {
                warnings.push({
                  source: sourceLabel(source.id),
                  title: `Warning — ${label.brandName || label.genericName || "labeled drug"}`,
                  detail: w,
                  severity: "major",
                });
              }
              if (label.brandName || label.indications) {
                labelExamples.push({
                  title: label.brandName || label.genericName || "Drug label",
                  description: label.indications ?? "Approved product labeling on file with the FDA.",
                });
              }
            }
          },
        });
        break;
      }
      case "food_event":
      case "cosmetic_event": {
        const industry =
          source.id === "cosmetic_event" ? "Cosmetics" : undefined;
        tasks.push({
          id: source.id,
          run: async () => {
            const summary = await fetchAdverseEvents({
              industry,
              term: term ?? undefined,
            });
            if (summary.total > 0) {
              findings.push({
                source: sourceLabel(source.id),
                title: `${summary.total.toLocaleString()} adverse-event report${summary.total === 1 ? "" : "s"} on record`,
                detail: summary.topReactions.length
                  ? `Most reported reactions: ${summary.topReactions.map((r) => `${r.term.toLowerCase()} (${r.count})`).join(", ")}.`
                  : "Consumer adverse-event reports exist for matching products.",
                severity: "info",
              });
            }
          },
        });
        break;
      }
    }
  }

  const outcomes = await Promise.allSettled(tasks.map((t) => t.run()));
  const failed = outcomes.filter((o) => o.status === "rejected").length;
  const notConfigured = outcomes.some(
    (o) => o.status === "rejected" && (o as PromiseRejectedResult).reason instanceof FdaNotConfiguredError,
  );

  if (notConfigured) {
    return emptyIntelligence({
      available: false,
      message: "FDA integration is not configured.",
    });
  }

  const allFailed = tasks.length > 0 && failed === tasks.length;

  // Rank warnings/findings so the most severe surface first.
  const rank: Record<string, number> = { critical: 0, major: 1, info: 2 };
  const bySeverity = (a: FdaFinding, b: FdaFinding) =>
    (rank[a.severity ?? "info"] ?? 2) - (rank[b.severity ?? "info"] ?? 2);
  warnings.sort(bySeverity);
  findings.sort(bySeverity);

  return {
    detectedCategory: category,
    categoryLabel: categoryLabel(category),
    searchTerm: term,
    applicableSources: sources,
    warnings: warnings.slice(0, 12),
    findings: findings.slice(0, 12),
    labelExamples: labelExamples.slice(0, 6),
    references: referencesForCategory(category),
    sourceLinks: linksForCategory(category),
    available: !allFailed,
    degraded: failed > 0 && !allFailed,
    message: allFailed
      ? "FDA source temporarily unavailable. Review can continue on internal standards."
      : null,
    disclaimer: DISCLAIMER,
  };
}
