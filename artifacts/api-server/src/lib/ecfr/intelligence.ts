// Per-package eCFR intelligence: recall the synced CFR sections most relevant to
// a package by detected category + semantic similarity to its artwork text.
// Reads only local synced content — never fetches eCFR live — and degrades
// gracefully: an unsynced or empty store returns a valid payload, never throws.

import type { PackageRow } from "@workspace/db";
import { retrieveEcfrSections } from "./engine";
import {
  detectEcfrCategory,
  ecfrCategoryLabel,
  tagsForCategory,
  type EcfrCategory,
} from "./router";

const DISCLAIMER =
  "Regulatory text from the Electronic Code of Federal Regulations (eCFR), an official U.S. government source. Content is synced periodically; verify against the current eCFR before making final compliance decisions.";

export interface EcfrSectionMatch {
  citation: string;
  heading: string;
  snippet: string;
  url: string | null;
  title: number;
  part: string;
  editionDate: string | null;
  similarity: number;
}

export interface EcfrIntelligence {
  detectedCategory: EcfrCategory | null;
  categoryLabel: string;
  searchTerm: string | null;
  sections: EcfrSectionMatch[];
  available: boolean;
  message: string | null;
  disclaimer: string;
}

// Build the text used to recall relevant sections for a package under review.
function packageQueryText(pkg: PackageRow): string {
  const parts = [pkg.category, pkg.productType ?? "", pkg.name];
  if (pkg.ocr?.claims?.length) parts.push(pkg.ocr.claims.join(". "));
  if (pkg.extractedText) parts.push(pkg.extractedText.slice(0, 2000));
  return parts.filter(Boolean).join(". ");
}

// Trim a section body to a short relevance snippet.
function snippetOf(text: string, max = 320): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

export async function gatherEcfrIntelligence(
  pkg: PackageRow,
): Promise<EcfrIntelligence> {
  const { category, label } = detectEcfrCategory(pkg);
  const queryText = packageQueryText(pkg);
  const searchTerm =
    pkg.brand?.trim() || pkg.ocr?.productName?.trim() || pkg.name?.trim() || null;

  let recalled;
  try {
    recalled = await retrieveEcfrSections({
      queryText,
      categoryTags: category ? tagsForCategory(category) : null,
      limit: 8,
    });
    // When a category is detected but nothing matched within it (e.g. that part
    // is not yet synced), fall back to a broad semantic recall so the tab is not
    // needlessly empty.
    if (recalled.length === 0 && category) {
      recalled = await retrieveEcfrSections({ queryText, limit: 6 });
    }
  } catch {
    return {
      detectedCategory: category,
      categoryLabel: category ? ecfrCategoryLabel(category) : label,
      searchTerm,
      sections: [],
      available: false,
      message:
        "eCFR content is not available yet. Run a sync from the Integrations page.",
      disclaimer: DISCLAIMER,
    };
  }

  const sections: EcfrSectionMatch[] = recalled.map((s) => ({
    citation: s.citation,
    heading: s.heading,
    snippet: snippetOf(s.text),
    url: s.url,
    title: s.title,
    part: s.part,
    editionDate: s.editionDate,
    similarity: Number(s.similarity.toFixed(3)),
  }));

  return {
    detectedCategory: category,
    categoryLabel: category ? ecfrCategoryLabel(category) : label,
    searchTerm,
    sections,
    available: true,
    message:
      sections.length === 0
        ? "No synced eCFR sections match this product yet. Content may not be synced."
        : null,
    disclaimer: DISCLAIMER,
  };
}

// Render relevant sections as a compact prompt block for the AI analysis. Used
// so AI-generated violations can cite real CFR sections from synced content.
export function formatEcfrForPrompt(sections: EcfrSectionMatch[]): string {
  if (sections.length === 0) return "";
  return sections
    .map(
      (s, i) =>
        `${i + 1}. [${s.citation}] ${s.heading}: ${s.snippet.replace(/\s+/g, " ").slice(0, 500)}`,
    )
    .join("\n");
}
