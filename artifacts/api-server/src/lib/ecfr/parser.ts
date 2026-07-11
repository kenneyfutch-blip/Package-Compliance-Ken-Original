// Turns eCFR part XML into flat {citation, heading, text} section records.
//
// eCFR XML nests a part in <DIV5 TYPE="PART"> and each regulatory section in a
// <DIV8 N="101.9" TYPE="SECTION"> node with a <HEAD> and one or more <P> bodies.
// We do a dependency-free extraction: pull each DIV8, take its HEAD as the
// heading and the remaining tag-stripped text as the body. A dedicated XML
// library is avoided (the package firewall blocks several parsers) and the DIV8
// structure is simple and stable enough for reliable regex slicing.

import { sectionUrl } from "./client";

export interface EcfrParsedSection {
  title: number;
  part: string;
  section: string;
  citation: string;
  heading: string;
  text: string;
  url: string;
}

// Cap stored/embedded body length. Sections are occasionally enormous; the
// leading text carries the regulatory intent, and the embedder is a bag-of-words
// so trailing tables/appendices add little recall value at large cost.
const MAX_TEXT_LEN = 6000;

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(xml: string): string {
  return xml.replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Extract the inner text of the first <HEAD>…</HEAD> in a fragment.
function extractHead(fragment: string): string {
  const m = fragment.match(/<HEAD[^>]*>([\s\S]*?)<\/HEAD>/i);
  if (!m) return "";
  return normalizeWhitespace(decodeEntities(stripTags(m[1] ?? "")));
}

// Body = everything after the HEAD, tag-stripped and normalized.
function extractBody(fragment: string): string {
  const withoutHead = fragment.replace(/<HEAD[^>]*>[\s\S]*?<\/HEAD>/i, " ");
  const text = normalizeWhitespace(decodeEntities(stripTags(withoutHead)));
  return text.length > MAX_TEXT_LEN
    ? `${text.slice(0, MAX_TEXT_LEN).trimEnd()}…`
    : text;
}

// Parse every SECTION-type DIV8 in a part's XML into a record. Reserved or
// empty sections (no meaningful body) are skipped so recall never surfaces
// placeholder rows.
export function parsePartSections(
  xml: string,
  title: number,
  part: string,
): EcfrParsedSection[] {
  const out: EcfrParsedSection[] = [];
  const seen = new Set<string>();

  const divRe = /<DIV8\b([^>]*)>([\s\S]*?)<\/DIV8>/gi;
  let m: RegExpExecArray | null;
  while ((m = divRe.exec(xml)) !== null) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";

    if (!/TYPE\s*=\s*"SECTION"/i.test(attrs)) continue;

    const nMatch = attrs.match(/\bN\s*=\s*"([^"]+)"/i);
    const section = nMatch ? decodeEntities(nMatch[1] ?? "").trim() : "";
    if (!section || seen.has(section)) continue;

    const heading = extractHead(inner);
    const body = extractBody(inner);

    // Skip reserved / empty placeholders.
    if (/\[reserved\]/i.test(heading) && body.length < 20) continue;
    if (body.length < 20) continue;

    seen.add(section);
    out.push({
      title,
      part,
      section,
      citation: `${title} CFR ${section}`,
      heading: heading || `${title} CFR ${section}`,
      text: body,
      url: sectionUrl(title, section),
    });
  }

  return out;
}
