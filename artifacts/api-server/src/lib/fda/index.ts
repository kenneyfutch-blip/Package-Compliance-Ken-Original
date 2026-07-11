// Public surface of the FDA regulatory-intelligence service layer.
export {
  FdaNotConfiguredError,
  FdaUnavailableError,
  isFdaConfigured,
  pingFda,
  clearFdaCache,
} from "./client";
export {
  fetchRecalls,
  fetchDrugLabels,
  fetchAdverseEvents,
  RECALL_CATEGORIES,
  type RecallCategory,
  type FdaRecall,
  type FdaDrugLabel,
  type AdverseEventSummary,
} from "./datasets";
export {
  detectFdaCategory,
  sourcesForCategory,
  referencesForCategory,
  linksForCategory,
  categoryLabel,
  fdaCatalog,
  ALL_FDA_CATEGORIES,
  type FdaCategory,
  type FdaSource,
  type FdaSourceId,
  type FdaReference,
  type FdaLink,
  type FdaCatalogEntry,
} from "./router";
export {
  gatherFdaIntelligence,
  type FdaIntelligence,
  type FdaFinding,
  type FdaLabelExample,
} from "./intelligence";
