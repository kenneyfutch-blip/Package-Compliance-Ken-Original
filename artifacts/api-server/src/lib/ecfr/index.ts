// Public surface of the eCFR regulatory-data service layer.
export {
  EcfrUnavailableError,
  isEcfrConfigured,
  pingEcfr,
  fetchTitles,
  resolveTitleDate,
  fetchPartXml,
  sectionUrl,
  type EcfrTitleMeta,
} from "./client";
export { parsePartSections, type EcfrParsedSection } from "./parser";
export {
  CURATED_PARTS,
  ALL_ECFR_CATEGORIES,
  detectEcfrCategory,
  ecfrCategoryLabel,
  tagsForCategory,
  type EcfrCategory,
  type CuratedPart,
} from "./router";
export {
  ensureEcfrIndexes,
  replacePartSections,
  retrieveEcfrSections,
  getEcfrStoredMeta,
  type EcfrRecalledSection,
  type EcfrStoredMeta,
  type EcfrTitleCount,
} from "./engine";
export { runEcfrSync, type EcfrSyncResult } from "./sync";
export {
  gatherEcfrIntelligence,
  formatEcfrForPrompt,
  type EcfrIntelligence,
  type EcfrSectionMatch,
} from "./intelligence";
